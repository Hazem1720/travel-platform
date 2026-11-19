import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import { Airline, AirlineDocument } from '../airlines/schemas/airline.schema';
import { BookingStatus } from '../common/enums/booking-status.enum';
import {
  CancellationTierLike,
  refundAmount,
  refundPercent,
} from '../common/helpers/cancellation-tiers';
import { assertOwner } from '../common/helpers/ownership';
import { localDaysUntil } from '../common/helpers/time-zone';
import { AuthUser } from '../common/types/auth-user.type';
import { Flight, FlightDocument } from '../flights/schemas/flight.schema';
import { NotificationType } from '../notifications/schemas/notification.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentBookingType, RefundResult } from '../payments/payment-handler';
import { PaymentsService } from '../payments/payments.service';
import { Airport } from '../reference/schemas/reference.schemas';
import { BOOKING_NOT_FOUND } from './flight-confirmation.service';
import {
  FlightBooking,
  FlightBookingDocument,
} from './schemas/flight-booking.schema';
import {
  SeatAssignment,
  SeatAssignmentDocument,
} from './schemas/seat-assignment.schema';

export const NOT_CONFIRMED = 'Only a Confirmed booking can be cancelled';
export const ALREADY_DEPARTED =
  'A booking can only be cancelled before its flight departs';
export const REFUND_CHANGED =
  'The refund amount has changed; review the cancellation again';

type LeanBooking = FlightBooking & { _id: FlightBookingDocument['_id'] };

interface Quote {
  booking: LeanBooking;
  tiers: CancellationTierLike[];
  daysBeforeDeparture: number;
  refundPercent: number;
  refundAmount: number;
}

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

// FLT-26 (Hasan): the user cancels their own Confirmed flight booking any
// time before departure. A round trip is cancelled as a whole with the
// outbound segment's tier (conventions.md), from its airline's tiers
// (FLT-09), counted in the departure airport's local date, on the full
// total. The booking becomes Cancelled, its seats go back on every flight
// it was on, its chosen seats (FLT-28) are freed, the refund goes through
// PAY-03 and the user is notified (GEN-01).
@Injectable()
export class FlightBookingCancellationService {
  private readonly logger = new Logger(FlightBookingCancellationService.name);

  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBookingDocument>,
    @InjectModel(Flight.name) private readonly flights: Model<FlightDocument>,
    @InjectModel(Airline.name)
    private readonly airlines: Model<AirlineDocument>,
    @InjectModel(Airport.name) private readonly airports: Model<Airport>,
    @InjectModel(SeatAssignment.name)
    private readonly seats: Model<SeatAssignmentDocument>,
    private readonly payments: PaymentsService,
    private readonly notifications: NotificationsService,
  ) {}

  // GET /flight-bookings/:id/cancellation: what cancelling now would refund.
  async preview(user: AuthUser, id: string, now: Date = new Date()) {
    const q = await this.quote(user, id, now);
    return {
      bookingId: String(q.booking._id),
      reference: q.booking.reference,
      segments: q.booking.segments.map((s) => ({
        flightNumber: s.flightNumber,
        from: s.from,
        to: s.to,
        departureAt: s.departureAt,
      })),
      totalAmount: q.booking.totalAmount,
      daysBeforeDeparture: q.daysBeforeDeparture,
      refundPercent: q.refundPercent,
      refundAmount: q.refundAmount,
      currency: q.booking.currency,
      cancellationTiers: q.tiers,
    };
  }

  // POST /flight-bookings/:id/cancel { refundAmount }: the amount the user
  // confirmed must still be right, or nothing happens (409).
  async cancel(
    user: AuthUser,
    id: string,
    confirmedRefund: number,
    now: Date = new Date(),
  ) {
    const q = await this.quote(user, id, now);
    if (q.refundAmount !== confirmedRefund) {
      throw new ConflictException(REFUND_CHANGED);
    }
    const b = q.booking;
    // One conditional update, so two cancels (or a cancel and the airline
    // cancelling the flight) cannot both win; still before departure.
    const res = await this.bookings.updateOne(
      {
        _id: b._id,
        status: BookingStatus.CONFIRMED,
        'segments.0.departureAt': { $gt: now },
      },
      { $set: { status: BookingStatus.CANCELLED, cancelledAt: now } },
    );
    if (res.modifiedCount === 0) throw new ConflictException(NOT_CONFIRMED);

    const label = b.reference ?? String(b._id);
    try {
      await this.releaseSeats(b);
    } catch (err) {
      this.logger.error(`FLT-26 ${label} seats: ${(err as Error).message}`);
    }

    // A refund problem must not undo the cancellation: PAY-03 records a
    // Stripe failure as Failed (and tells the user) instead of throwing.
    let refund: RefundResult | null = null;
    try {
      refund = await this.payments.refund(
        PaymentBookingType.FLIGHT,
        String(b._id),
        q.refundAmount,
      );
    } catch (err) {
      this.logger.error(`FLT-26 ${label} refund: ${(err as Error).message}`);
    }

    const out = b.segments[0];
    const trip = b.segments
      .map((s) => `${s.flightNumber} ${s.from}-${s.to}`)
      .join(' and ');
    await this.notifications
      .create(
        b.userId,
        NotificationType.BOOKING_CANCELLED,
        `Your booking ${label} (${trip}, departing ` +
          `${new Date(out.departureAt).toISOString().slice(0, 10)}) is ` +
          'cancelled. ' +
          (q.refundAmount > 0
            ? `A refund of ${usd(q.refundAmount)} (${q.refundPercent}%) has ` +
              'been requested; you will get a separate message about it.'
            : 'No refund applies under the airline’s cancellation policy.'),
        {
          bookingId: String(b._id),
          reference: b.reference,
          refundAmount: q.refundAmount,
        },
      )
      .catch((err: Error) =>
        this.logger.error(`FLT-26 ${label} notification: ${err.message}`),
      );

    return {
      bookingId: String(b._id),
      reference: b.reference,
      status: BookingStatus.CANCELLED,
      cancelledAt: now,
      refundPercent: q.refundPercent,
      refundAmount: q.refundAmount,
      refund,
    };
  }

  // The owner's Confirmed booking before its (outbound) departure, and its
  // refund. 404 for anyone else's or an unknown id; 409 otherwise.
  private async quote(user: AuthUser, id: string, now: Date): Promise<Quote> {
    const booking = isValidObjectId(id)
      ? await this.bookings.findById(id).lean<LeanBooking>()
      : null;
    assertOwner(booking?.userId, user, BOOKING_NOT_FOUND);
    const b = booking!;
    if (b.status !== BookingStatus.CONFIRMED) {
      throw new ConflictException(NOT_CONFIRMED);
    }
    const out = b.segments[0];
    if (new Date(out.departureAt).getTime() <= now.getTime()) {
      throw new ConflictException(ALREADY_DEPARTED);
    }
    const [airline, airport] = await Promise.all([
      this.airlines.findById(out.airlineId, { cancellationTiers: 1 }).lean(),
      this.airports.findById(out.from, { timeZone: 1 }).lean(),
    ]);
    const days = localDaysUntil(
      out.departureAt,
      airport?.timeZone ?? 'UTC',
      now,
    );
    const tiers = [...(airline?.cancellationTiers ?? [])]
      .map(({ daysBefore, refundPercent }) => ({ daysBefore, refundPercent }))
      .sort((x, y) => y.daysBefore - x.daysBefore);
    return {
      booking: b,
      tiers,
      daysBeforeDeparture: days,
      refundPercent: refundPercent(tiers, days),
      refundAmount: refundAmount(b.totalAmount, tiers, days),
    };
  }

  // Seats back on every flight of the booking (never below zero), and the
  // seats chosen with FLT-28 free for others.
  private async releaseSeats(b: LeanBooking): Promise<void> {
    await Promise.all([
      ...b.segments.map((s) =>
        this.flights.updateOne(
          { _id: s.flightId },
          { $inc: { 'cabins.$[c].bookedSeats': -s.seats } },
          {
            arrayFilters: [
              { 'c._id': s.cabinId, 'c.bookedSeats': { $gte: s.seats } },
            ],
          },
        ),
      ),
      this.seats.deleteMany({ bookingId: b._id }),
    ]);
  }
}
