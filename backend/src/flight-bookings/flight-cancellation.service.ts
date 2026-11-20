import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { AuthUser } from '../common/types/auth-user.type';
import { effectiveStatus } from '../flights/flight-rules';
import { FlightsService } from '../flights/flights.service';
import {
  Flight,
  FlightDocument,
  FlightStatus,
} from '../flights/schemas/flight.schema';
import { NotificationType } from '../notifications/schemas/notification.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentBookingType, RefundStatus } from '../payments/payment-handler';
import { PaymentsService } from '../payments/payments.service';
import {
  FlightBooking,
  FlightBookingDocument,
} from './schemas/flight-booking.schema';

export const FLIGHT_NOT_SCHEDULED =
  'Only a Scheduled flight that has not departed can be cancelled';

interface LeanBooking {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  reference: string | null;
  totalAmount: number;
  segments: {
    flightId: Types.ObjectId;
    cabinId: Types.ObjectId;
    seats: number;
  }[];
}

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

// FLT-06 (Hasan): an airline moderator cancels one of their Scheduled
// flights. The flight becomes Cancelled (search shows only Scheduled
// flights, so it disappears from search); its unpaid holds are released;
// every Confirmed booking on it is Cancelled with a 100% refund (PAY-03) and
// its passengers are notified (GEN-01). A round trip is cancelled as a whole
// (conventions.md), so the seats of its other flight are freed too.
@Injectable()
export class FlightCancellationService {
  private readonly logger = new Logger(FlightCancellationService.name);

  constructor(
    @InjectModel(Flight.name) private readonly flights: Model<FlightDocument>,
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBookingDocument>,
    private readonly flightsService: FlightsService,
    private readonly payments: PaymentsService,
    private readonly notifications: NotificationsService,
  ) {}

  async cancel(user: AuthUser, flightId: string, now: Date = new Date()) {
    // 404 unknown, 403 another airline's (Hazem's rule for flight routes).
    const flight = await this.flightsService.getOwned(user, flightId);
    if (effectiveStatus(flight, now) !== FlightStatus.SCHEDULED) {
      throw new ConflictException(FLIGHT_NOT_SCHEDULED);
    }
    // One conditional update, so two cancels at once cannot both run.
    const res = await this.flights.updateOne(
      {
        _id: flight._id,
        status: FlightStatus.SCHEDULED,
        departureAt: { $gt: now },
      },
      { $set: { status: FlightStatus.CANCELLED } },
    );
    if (res.modifiedCount === 0) {
      throw new ConflictException(FLIGHT_NOT_SCHEDULED);
    }
    const id = new Types.ObjectId(String(flight._id));
    const route = `${flight.flightNumber} ${flight.from}-${flight.to} on ${new Date(flight.departureAt).toISOString().slice(0, 10)}`;
    const problems: string[] = [];

    // 1. Unpaid holds first: releasing one cancels its PaymentIntent; if
    // Stripe says it was paid in the meantime it becomes Confirmed and is
    // then cancelled and refunded in step 2 like the others.
    const holds = await this.bookings
      .find(
        { 'segments.flightId': id, status: BookingStatus.PENDING_PAYMENT },
        { _id: 1 },
      )
      .lean<{ _id: Types.ObjectId }[]>();
    let releasedHolds = 0;
    for (const h of holds) {
      try {
        await this.payments.releaseInventory(
          PaymentBookingType.FLIGHT,
          String(h._id),
        );
        releasedHolds++;
      } catch (err) {
        problems.push(`hold ${String(h._id)}: ${(err as Error).message}`);
      }
    }

    // 2. Confirmed bookings: Cancelled, seats back, 100% refund, notified.
    const confirmed = await this.bookings
      .find({ 'segments.flightId': id, status: BookingStatus.CONFIRMED })
      .lean<LeanBooking[]>();
    let cancelledBookings = 0;
    let refundedAmount = 0;
    for (const b of confirmed) {
      const label = b.reference ?? String(b._id);
      try {
        const won = await this.bookings.updateOne(
          { _id: b._id, status: BookingStatus.CONFIRMED },
          { $set: { status: BookingStatus.CANCELLED, cancelledAt: now } },
        );
        if (won.modifiedCount === 0) continue; // changed meanwhile
        cancelledBookings++;
        await this.releaseBookedSeats(b);
      } catch (err) {
        problems.push(`${label}: ${(err as Error).message}`);
        continue;
      }
      // A refund problem must not undo the cancellation (PAY-03 records a
      // failed Stripe refund as Failed instead of throwing).
      try {
        const refund = await this.payments.refund(
          PaymentBookingType.FLIGHT,
          String(b._id),
          b.totalAmount,
        );
        if (refund?.status === RefundStatus.FAILED) {
          // Recorded as Failed by PAY-03; an admin can retry it.
          problems.push(`${label} refund: recorded as Failed`);
        } else if (refund) {
          refundedAmount += b.totalAmount;
        }
      } catch (err) {
        problems.push(`${label} refund: ${(err as Error).message}`);
      }
      await this.notifications
        .create(
          b.userId,
          NotificationType.BOOKING_CANCELLED,
          // The refund's own outcome comes in PAY-03's separate
          // REFUND_ISSUED notification, so this one does not promise it.
          `The airline cancelled flight ${route}. Your booking ${label} is ` +
            `cancelled and a full refund of ${usd(b.totalAmount)} has been ` +
            `requested; you will get a separate message about it.`,
          {
            bookingId: String(b._id),
            reference: b.reference,
            flightId: String(id),
            refundAmount: b.totalAmount,
          },
        )
        .catch((err: Error) =>
          problems.push(`${label} notification: ${err.message}`),
        );
    }

    for (const p of problems) this.logger.error(`FLT-06 ${route}: ${p}`);
    const [view] = await this.flightsService.toViews([
      { ...flight, status: FlightStatus.CANCELLED },
    ]);
    return {
      flight: view,
      cancelledBookings,
      refundedAmount,
      releasedHolds,
      problems,
    };
  }

  // The booking's seats go back to every flight it was on (for a round
  // trip, the other flight too), never below zero.
  private async releaseBookedSeats(b: LeanBooking): Promise<void> {
    await Promise.all(
      b.segments.map((s) =>
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
    );
  }
}
