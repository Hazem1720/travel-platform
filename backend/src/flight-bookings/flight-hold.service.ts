import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { bookableFilter } from '../flights/flight-rules';
import { Flight, FlightDocument } from '../flights/schemas/flight.schema';
import { PaymentBookingType } from '../payments/payment-handler';
import { PaymentsService } from '../payments/payments.service';
import { FlightQuoteDto } from './dto/flight-quote.dto';
import { FlightQuoteService } from './flight-quote.service';
import {
  FlightBooking,
  FlightBookingDocument,
} from './schemas/flight-booking.schema';

// FLT-22: a hold lasts 10 minutes.
export const HOLD_MINUTES = 10;
export const NOT_ENOUGH_SEATS =
  'Not enough seats left on this flight; please search again';

export type LeanFlightBooking = FlightBooking & { _id: Types.ObjectId };

// FLT-22: reserve seats atomically and create a PendingPayment booking held
// for 10 minutes. Seats move only through the conditional updates below, so
// two requests at the same moment can never take more seats than exist.
@Injectable()
export class FlightHoldService {
  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBookingDocument>,
    @InjectModel(Flight.name) private readonly flights: Model<FlightDocument>,
    private readonly quotes: FlightQuoteService,
    private readonly payments: PaymentsService,
  ) {}

  async hold(userId: string, dto: FlightQuoteDto): Promise<LeanFlightBooking> {
    // A dead hold must never block seats between two runs of the expiry job.
    await this.releaseExpiredHolds([dto.outboundFlightId, dto.returnFlightId]);

    // The same checks and the same price as the summary (FLT-21).
    const quote = await this.quotes.quote(dto);

    const reserved: { flightId: string; cabinId: string }[] = [];
    try {
      for (const s of quote.segments) {
        if (!(await this.reserve(s.flightId, s.cabinId, quote.seats))) {
          throw new ConflictException(NOT_ENOUGH_SEATS);
        }
        reserved.push(s);
      }

      const now = new Date();
      const booking = await this.bookings.create({
        userId: new Types.ObjectId(userId),
        status: BookingStatus.PENDING_PAYMENT,
        segments: quote.segments.map((s, i) => ({
          flightId: new Types.ObjectId(s.flightId),
          airlineId: new Types.ObjectId(s.airline._id),
          flightNumber: s.flightNumber,
          from: s.from.code,
          to: s.to.code,
          departureAt: new Date(s.departure.utc),
          arrivalAt: new Date(s.arrival.utc),
          cabinId: new Types.ObjectId(s.cabinId),
          cabin: s.cabin,
          seats: quote.seats,
          cabinFare: s.cabinFare,
          fares: quote.price.segments[i].fares,
          baggageFees: quote.price.segments[i].baggageFees,
          subtotal: quote.price.segments[i].subtotal,
        })),
        passengers: quote.passengers.map((p) => ({
          type: p.type,
          fullName: p.fullName,
          dateOfBirth: p.dateOfBirth,
          passportNumber: p.passportNumber,
          extraBags: p.extraBags ?? [],
        })),
        totalAmount: quote.price.total,
        currency: quote.price.currency,
        expiresAt: new Date(now.getTime() + HOLD_MINUTES * 60_000),
      });
      return booking.toObject();
    } catch (err) {
      // Round trip whose return is full, or the insert failed: give back the
      // seats already held, so nothing stays blocked.
      await Promise.all(
        reserved.map((s) => this.unreserve(s.flightId, s.cabinId, quote.seats)),
      );
      throw err;
    }
  }

  // PendingPayment -> Expired and the held seats released (GEN-11, FLT-22).
  // Only one call can win the status change, so calling it twice (the job
  // and a hold at the same moment, or a repeated Stripe event) releases the
  // seats once. Called through PaymentsService.releaseInventory().
  async expire(bookingId: string): Promise<void> {
    if (!isValidObjectId(bookingId)) return;
    const booking = await this.bookings
      .findOneAndUpdate(
        { _id: bookingId, status: BookingStatus.PENDING_PAYMENT },
        { $set: { status: BookingStatus.EXPIRED, expiredAt: new Date() } },
      )
      .lean<LeanFlightBooking>();
    if (!booking) return;
    await Promise.all(
      booking.segments.map((s) =>
        this.unreserve(String(s.flightId), String(s.cabinId), s.seats),
      ),
    );
  }

  // PendingPayment bookings whose hold has run out, optionally only on some
  // flights. Used by the expiry job and before every new hold.
  async findExpiredHolds(
    flightIds?: string[],
    now = new Date(),
  ): Promise<string[]> {
    const filter: Record<string, unknown> = {
      status: BookingStatus.PENDING_PAYMENT,
      expiresAt: { $lte: now },
    };
    if (flightIds) {
      filter['segments.flightId'] = {
        $in: flightIds.map((id) => new Types.ObjectId(id)),
      };
    }
    const due = await this.bookings
      .find(filter, { _id: 1 })
      .lean<{ _id: Types.ObjectId }[]>();
    return due.map((b) => String(b._id));
  }

  // Expires through PaymentsService, so Memo's part can also cancel the
  // Stripe PaymentIntent (conventions.md, "Hold expiry").
  async releaseExpiredHolds(flightIds?: (string | undefined)[]): Promise<void> {
    const ids = flightIds?.filter(
      (id): id is string => !!id && isValidObjectId(id),
    );
    if (ids && ids.length === 0) return;
    for (const id of await this.findExpiredHolds(ids)) {
      await this.payments.releaseInventory(PaymentBookingType.FLIGHT, id);
    }
  }

  // One atomic update: add `seats` to the cabin's heldSeats only if
  // totalSeats - bookedSeats - heldSeats is at least `seats` and the flight
  // is still bookable. MongoDB checks and changes the document in one step,
  // so of two requests for the last seat exactly one matches.
  async reserve(
    flightId: string,
    cabinId: string,
    seats: number,
  ): Promise<boolean> {
    const cabin = new Types.ObjectId(cabinId);
    const res = await this.flights.updateOne(
      {
        _id: new Types.ObjectId(flightId),
        ...bookableFilter(),
        'cabins._id': cabin,
        $expr: { $gte: [freeSeatsExpr(cabin), seats] },
      },
      { $inc: { 'cabins.$[c].heldSeats': seats } },
      { arrayFilters: [{ 'c._id': cabin }] },
    );
    return res.modifiedCount === 1;
  }

  // Gives held seats back; never below 0.
  async unreserve(
    flightId: string,
    cabinId: string,
    seats: number,
  ): Promise<void> {
    const cabin = new Types.ObjectId(cabinId);
    await this.flights.updateOne(
      { _id: new Types.ObjectId(flightId) },
      { $inc: { 'cabins.$[c].heldSeats': -seats } },
      { arrayFilters: [{ 'c._id': cabin, 'c.heldSeats': { $gte: seats } }] },
    );
  }
}

// totalSeats - bookedSeats - heldSeats of one embedded cabin, as a MongoDB
// expression (used inside $expr).
export function freeSeatsExpr(cabinId: Types.ObjectId) {
  return {
    $let: {
      vars: {
        c: {
          $arrayElemAt: [
            {
              $filter: {
                input: '$cabins',
                as: 'cabin',
                cond: { $eq: ['$$cabin._id', cabinId] },
              },
            },
            0,
          ],
        },
      },
      in: {
        $subtract: [
          '$$c.totalSeats',
          {
            $add: [
              { $ifNull: ['$$c.bookedSeats', 0] },
              { $ifNull: ['$$c.heldSeats', 0] },
            ],
          },
        ],
      },
    },
  };
}
