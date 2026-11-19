import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { isValidObjectId, Model, Types } from 'mongoose';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { assertOwner } from '../common/helpers/ownership';
import { AuthUser } from '../common/types/auth-user.type';
import { Flight, FlightDocument } from '../flights/schemas/flight.schema';
import { NotificationType } from '../notifications/schemas/notification.schema';
import { NotificationsService } from '../notifications/notifications.service';
import {
  PayableBooking,
  PaymentBookingType,
  PaymentHandler,
  RefundResult,
} from '../payments/payment-handler';
import { PaymentsService } from '../payments/payments.service';
import { ChangeFlightDto } from './dto/change-flight.dto';
import { BOOKING_NOT_FOUND } from './flight-confirmation.service';
import { FlightHoldService, HOLD_MINUTES } from './flight-hold.service';
import { FlightQuote, FlightQuoteService } from './flight-quote.service';
import {
  BookingSegment,
  FlightBooking,
  FlightBookingDocument,
} from './schemas/flight-booking.schema';
import {
  FlightChange,
  FlightChangeDocument,
  LeanFlightChange,
} from './schemas/flight-change.schema';
import {
  SeatAssignment,
  SeatAssignmentDocument,
} from './schemas/seat-assignment.schema';

export const CHANGE_NOT_CONFIRMED = 'Only a Confirmed booking can be changed';
export const CHANGE_DEPARTED =
  'A booking can only be changed before its flight departs';
export const CHANGE_PENDING =
  'This booking already has a change waiting for payment';
export const NOTHING_CHANGED = 'Choose a different flight or date';
export const FLIGHT_FULL =
  'Not enough seats left on the new flight; the booking is unchanged';
export const CHANGE_NO_LONGER_POSSIBLE =
  'The booking changed meanwhile; the new flight was not booked';

type LeanBooking = FlightBooking & { _id: Types.ObjectId };

const usd = (cents: number) => `$${(Math.abs(cents) / 100).toFixed(2)}`;

function fieldError(field: string, message: string) {
  return new BadRequestException({
    error: 'Bad Request',
    message: 'Validation failed',
    details: { [field]: [message] },
  });
}

// FLT-27 (bonus): a user moves their Confirmed flight booking to another
// flight or date on the same route, in the same cabin, with the same
// passengers. The new flights are priced like a new booking (FLT-21), but an
// unchanged segment keeps its booked price. The new seats are held first
// (FLT-22's atomic hold), so a full flight is a 409 and nothing changes.
//  - Cheaper or the same: applied at once; the difference is refunded
//    (PAY-03).
//  - Dearer: the change waits 10 minutes for the difference, paid with
//    Stripe as payment type "flight-change" (PAY-01); Stripe's webhook
//    applies it. Not paid in time: Expired and the held seats released.
// Applying it moves the seats (held -> booked on the new flight, booked
// seats freed on the old one), frees the seats chosen with FLT-28 on the
// changed flights, and notifies the user (GEN-01). Later refunds of the
// booking (FLT-26) also draw on what was paid for its changes.
@Injectable()
export class FlightChangeService implements PaymentHandler {
  private readonly logger = new Logger(FlightChangeService.name);

  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBookingDocument>,
    @InjectModel(FlightChange.name)
    private readonly changes: Model<FlightChangeDocument>,
    @InjectModel(Flight.name) private readonly flights: Model<FlightDocument>,
    @InjectModel(SeatAssignment.name)
    private readonly seatAssignments: Model<SeatAssignmentDocument>,
    private readonly quotes: FlightQuoteService,
    private readonly holds: FlightHoldService,
    private readonly payments: PaymentsService,
    private readonly notifications: NotificationsService,
  ) {}

  // PATCH /flight-bookings/:id/change-flight
  async request(
    user: AuthUser,
    id: string,
    dto: ChangeFlightDto,
    now: Date = new Date(),
  ) {
    const booking = isValidObjectId(id)
      ? await this.bookings.findById(id).lean<LeanBooking>()
      : null;
    assertOwner(booking?.userId, user, BOOKING_NOT_FOUND);
    const b = booking!;
    if (b.status !== BookingStatus.CONFIRMED) {
      throw new ConflictException(CHANGE_NOT_CONFIRMED);
    }
    if (new Date(b.segments[0].departureAt).getTime() <= now.getTime()) {
      throw new ConflictException(CHANGE_DEPARTED);
    }

    const roundTrip = b.segments.length === 2;
    if (roundTrip && !dto.returnFlightId) {
      throw fieldError(
        'returnFlightId',
        'returnFlightId is required for a round-trip booking',
      );
    }
    if (!roundTrip && dto.returnFlightId) {
      throw fieldError('returnFlightId', 'This booking is one-way');
    }
    const ids = roundTrip
      ? [dto.outboundFlightId, dto.returnFlightId!]
      : [dto.outboundFlightId];
    const changed = ids
      .map((fid, i) => (fid === String(b.segments[i].flightId) ? -1 : i))
      .filter((i) => i >= 0);
    if (changed.length === 0) throw new BadRequestException(NOTHING_CHANGED);

    await this.clearPending(b._id, now);

    // Same checks and prices as a new booking (FLT-19, FLT-21).
    const quote = await this.quotes.quote({
      outboundFlightId: ids[0],
      returnFlightId: ids[1],
      cabin: b.segments[0].cabin,
      passengers: b.passengers.map((p) => ({
        type: p.type,
        fullName: p.fullName,
        dateOfBirth: p.dateOfBirth,
        passportNumber: p.passportNumber,
        extraBags: (p.extraBags ?? []).map((x) => ({ weightKg: x.weightKg })),
      })),
    });
    quote.segments.forEach((s, i) => {
      const old = b.segments[i];
      if (s.from.code !== old.from || s.to.code !== old.to) {
        throw fieldError(
          i === 0 ? 'outboundFlightId' : 'returnFlightId',
          `The new flight must fly ${old.from}-${old.to} like the booking`,
        );
      }
    });

    const segments = b.segments.map((old, i) =>
      changed.includes(i) ? toSegment(quote, i) : old,
    );
    const newTotal = segments.reduce((sum, s) => sum + s.subtotal, 0);
    const difference = newTotal - b.totalAmount;

    // Hold the new seats first: of two people after the last seat, one
    // gets a 409 and their booking stays as it was.
    const held: number[] = [];
    try {
      for (const i of changed) {
        const s = segments[i];
        const ok = await this.holds.reserve(
          String(s.flightId),
          String(s.cabinId),
          quote.seats,
        );
        if (!ok) throw new ConflictException(FLIGHT_FULL);
        held.push(i);
      }

      const change = (
        await this.changes.create({
          bookingId: b._id,
          userId: b.userId,
          status: BookingStatus.PENDING_PAYMENT,
          oldSegments: b.segments,
          segments,
          changed,
          seats: quote.seats,
          oldTotal: b.totalAmount,
          newTotal,
          difference,
          currency: b.currency,
          expiresAt:
            difference > 0
              ? new Date(now.getTime() + HOLD_MINUTES * 60_000)
              : null,
        })
      ).toObject() as LeanFlightChange;
      held.length = 0; // the change owns the held seats from here on

      if (difference > 0) return this.view(change, b, null);

      // Cheaper or the same: apply now, then refund the difference.
      await this.applyOrCancel(change, now);
      let refund: RefundResult | null = null;
      if (difference < 0) {
        try {
          refund = await this.payments.refund(
            PaymentBookingType.FLIGHT,
            String(b._id),
            -difference,
          );
        } catch (err) {
          this.logger.error(
            `FLT-27 ${b.reference} refund: ${(err as Error).message}`,
          );
        }
      }
      const done = await this.changes
        .findById(change._id)
        .lean<LeanFlightChange>();
      return this.view(done!, b, refund);
    } catch (err) {
      await this.release(segments, held, quote.seats);
      throw err;
    }
  }

  // A change still waiting for payment blocks a new one (409) until its
  // hold ends; an expired one is closed first (its PaymentIntent cancelled).
  private async clearPending(bookingId: Types.ObjectId, now: Date) {
    const pending = await this.changes
      .findOne({ bookingId, status: BookingStatus.PENDING_PAYMENT })
      .lean<LeanFlightChange>();
    if (!pending) return;
    if (pending.expiresAt && pending.expiresAt.getTime() > now.getTime()) {
      throw new ConflictException(CHANGE_PENDING);
    }
    await this.payments.releaseInventory(
      PaymentBookingType.FLIGHT_CHANGE,
      String(pending._id),
    );
  }

  // GEN-11 style job: changes not paid in time -> Expired, seats released
  // (through Payments, which cancels the PaymentIntent first).
  @Cron(CronExpression.EVERY_MINUTE)
  async expireUnpaid(now: Date = new Date()): Promise<number> {
    try {
      const due = await this.changes
        .find(
          {
            status: BookingStatus.PENDING_PAYMENT,
            expiresAt: { $lte: now },
          },
          { _id: 1 },
        )
        .lean<{ _id: Types.ObjectId }[]>();
      for (const c of due) {
        await this.payments.releaseInventory(
          PaymentBookingType.FLIGHT_CHANGE,
          String(c._id),
        );
      }
      return due.length;
    } catch (err) {
      this.logger.error(`FLT-27 expiry job: ${(err as Error).message}`);
      return 0;
    }
  }

  // ---- PaymentHandler for "flight-change" (PAY-01) ----

  async getPayable(changeId: string): Promise<PayableBooking | null> {
    const c = isValidObjectId(changeId)
      ? await this.changes.findById(changeId).lean<LeanFlightChange>()
      : null;
    if (!c) return null;
    const trip = c.changed.map((i) => c.segments[i].flightNumber).join(' and ');
    return {
      bookingId: String(c._id),
      userId: String(c.userId),
      status: c.status,
      amount: c.difference,
      currency: c.currency,
      expiresAt: c.expiresAt,
      // The policies were accepted for the booking itself (PAY-02).
      policiesAcceptedAt: c.createdAt ?? new Date(),
      description: `Flight change to ${trip}`,
      parentBookingId: String(c.bookingId),
    };
  }

  // Stripe confirmed the difference: apply the change. Safe to call twice.
  async confirm(changeId: string): Promise<void> {
    if (!isValidObjectId(changeId)) return;
    const c = await this.changes.findById(changeId).lean<LeanFlightChange>();
    if (!c || c.status === BookingStatus.CONFIRMED) return;
    if (c.status !== BookingStatus.PENDING_PAYMENT) {
      // Expired or cancelled before the money arrived: Payments refunds it.
      throw new ConflictException(CHANGE_NO_LONGER_POSSIBLE);
    }
    await this.applyOrCancel(c, new Date());
  }

  // Not paid in time: Expired and the new seats released. Safe to call twice.
  async expire(changeId: string): Promise<void> {
    if (!isValidObjectId(changeId)) return;
    const c = await this.changes
      .findOneAndUpdate(
        { _id: changeId, status: BookingStatus.PENDING_PAYMENT },
        { $set: { status: BookingStatus.EXPIRED } },
        { new: true },
      )
      .lean<LeanFlightChange>();
    if (c) await this.release(c.segments, c.changed, c.seats);
  }

  // ---- applying ----

  // Only one caller can move the change from PendingPayment; then the
  // booking is updated only if it is still Confirmed, before departure and
  // on the flights the change started from. Otherwise the change is
  // Cancelled, its held seats released, and a 409 thrown.
  private async applyOrCancel(c: LeanFlightChange, now: Date): Promise<void> {
    const claimed = await this.changes.updateOne(
      { _id: c._id, status: BookingStatus.PENDING_PAYMENT },
      { $set: { status: BookingStatus.CONFIRMED, appliedAt: now } },
    );
    if (claimed.modifiedCount === 0) return; // someone else did it

    const filter: Record<string, unknown> = {
      _id: c.bookingId,
      status: BookingStatus.CONFIRMED,
      totalAmount: c.oldTotal,
      'segments.0.departureAt': { $gt: now },
    };
    c.oldSegments.forEach((s, i) => {
      filter[`segments.${i}.flightId`] = s.flightId;
    });
    const res = await this.bookings.updateOne(filter, {
      $set: { segments: c.segments, totalAmount: c.newTotal },
    });
    if (res.modifiedCount === 0) {
      await this.changes.updateOne(
        { _id: c._id },
        { $set: { status: BookingStatus.CANCELLED, appliedAt: null } },
      );
      await this.release(c.segments, c.changed, c.seats);
      throw new ConflictException(CHANGE_NO_LONGER_POSSIBLE);
    }

    try {
      await this.moveSeats(c);
    } catch (err) {
      this.logger.error(
        `FLT-27 change ${String(c._id)} seats: ${(err as Error).message}`,
      );
    }
    await this.notify(c).catch((err: Error) =>
      this.logger.error(`FLT-27 notification: ${err.message}`),
    );
  }

  // New flight: held -> booked. Old flight: booked seats freed (never
  // below zero). FLT-28 seats chosen on a changed segment are freed.
  private async moveSeats(c: LeanFlightChange): Promise<void> {
    for (const i of c.changed) {
      const to = c.segments[i];
      const from = c.oldSegments[i];
      await this.flights.updateOne(
        { _id: to.flightId },
        {
          $inc: {
            'cabins.$[c].heldSeats': -c.seats,
            'cabins.$[c].bookedSeats': c.seats,
          },
        },
        {
          arrayFilters: [
            { 'c._id': to.cabinId, 'c.heldSeats': { $gte: c.seats } },
          ],
        },
      );
      await this.flights.updateOne(
        { _id: from.flightId },
        { $inc: { 'cabins.$[c].bookedSeats': -c.seats } },
        {
          arrayFilters: [
            { 'c._id': from.cabinId, 'c.bookedSeats': { $gte: c.seats } },
          ],
        },
      );
      await this.seatAssignments.deleteMany({
        bookingId: c.bookingId,
        segment: i,
      });
    }
  }

  private async release(
    segments: BookingSegment[],
    indexes: number[],
    seats: number,
  ): Promise<void> {
    await Promise.all(
      indexes.map((i) =>
        this.holds
          .unreserve(
            String(segments[i].flightId),
            String(segments[i].cabinId),
            seats,
          )
          .catch((err: Error) =>
            this.logger.error(`FLT-27 release: ${err.message}`),
          ),
      ),
    );
  }

  private async notify(c: LeanFlightChange): Promise<void> {
    const b = await this.bookings
      .findById(c.bookingId, { reference: 1 })
      .lean<{ reference: string | null }>();
    const label = b?.reference ?? String(c.bookingId);
    const trip = c.changed
      .map((i) => {
        const s = c.segments[i];
        return (
          `${s.flightNumber} ${s.from}-${s.to} on ` +
          new Date(s.departureAt).toISOString().slice(0, 10)
        );
      })
      .join(' and ');
    const money =
      c.difference > 0
        ? `You paid the fare difference of ${usd(c.difference)}.`
        : c.difference < 0
          ? `The lower fare's difference of ${usd(c.difference)} is being refunded; you will get a separate message about it.`
          : 'The fare is the same.';
    await this.notifications.create(
      c.userId,
      NotificationType.BOOKING_CHANGED,
      `Your booking ${label} now flies ${trip}. ${money}`,
      {
        bookingId: String(c.bookingId),
        changeId: String(c._id),
        difference: c.difference,
      },
    );
  }

  private view(
    c: LeanFlightChange,
    b: LeanBooking,
    refund: RefundResult | null,
  ) {
    const pending = c.status === BookingStatus.PENDING_PAYMENT;
    return {
      changeId: String(c._id),
      bookingId: String(b._id),
      reference: b.reference,
      status: c.status,
      segments: c.segments.map((s) => ({
        flightId: String(s.flightId),
        flightNumber: s.flightNumber,
        from: s.from,
        to: s.to,
        departureAt: s.departureAt,
        arrivalAt: s.arrivalAt,
        cabin: s.cabin,
        subtotal: s.subtotal,
      })),
      changedSegments: c.changed,
      oldTotal: c.oldTotal,
      newTotal: c.newTotal,
      difference: c.difference,
      currency: c.currency,
      ...(pending
        ? {
            amountDue: c.difference,
            expiresAt: c.expiresAt,
            payWith: {
              method: 'POST',
              path: '/api/payments',
              body: {
                bookingType: PaymentBookingType.FLIGHT_CHANGE,
                bookingId: String(c._id),
              },
            },
          }
        : { appliedAt: c.appliedAt, refund }),
    };
  }
}

// The booking segment for quote segment i, exactly as the hold stores it.
function toSegment(quote: FlightQuote, i: number): BookingSegment {
  const s = quote.segments[i];
  const price = quote.price.segments[i];
  return {
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
    fares: price.fares,
    baggageFees: price.baggageFees,
    subtotal: price.subtotal,
  };
}
