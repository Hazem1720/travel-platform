import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import {
  assertTransition,
  BookingStatus,
  generateBookingReference,
} from '../common/enums/booking-status.enum';
import { toZonedTime, ZonedTime } from '../common/helpers/time-zone';
import { Flight, FlightDocument } from '../flights/schemas/flight.schema';
import { NotificationType } from '../notifications/schemas/notification.schema';
import { NotificationsService } from '../notifications/notifications.service';
import {
  Airport,
  AirportDocument,
} from '../reference/schemas/reference.schemas';
import { LeanFlightBooking } from './flight-hold.service';
import {
  BookingSegment,
  FlightBooking,
  FlightBookingDocument,
} from './schemas/flight-booking.schema';

export const BOOKING_NOT_FOUND = 'Booking not found';
export const ETICKET_NOT_CONFIRMED =
  'The e-ticket is available once the booking is Confirmed';

// A segment as the confirmation page and the e-ticket show it: each time in
// UTC and in its airport's local time (GEN-06).
export interface BookingSegmentView
  extends Omit<BookingSegment, 'departureAt' | 'arrivalAt'> {
  departure: ZonedTime;
  arrival: ZonedTime;
}

export interface FlightBookingView extends Omit<LeanFlightBooking, 'segments'> {
  segments: BookingSegmentView[];
}

// FLT-23: after payment the booking becomes Confirmed with an FL- reference,
// its held seats become booked seats, and the user is notified. Also the
// confirmation page and the e-ticket data.
@Injectable()
export class FlightConfirmationService {
  private readonly logger = new Logger(FlightConfirmationService.name);

  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBookingDocument>,
    @InjectModel(Flight.name) private readonly flights: Model<FlightDocument>,
    @InjectModel(Airport.name)
    private readonly airports: Model<AirportDocument>,
    private readonly notifications: NotificationsService,
  ) {}

  // Called by Memo's Stripe webhook through the payment handler (PAY-01).
  // Safe to call twice for the same booking: Stripe may repeat an event,
  // and only the first call changes anything. Throws 409 if the booking is
  // no longer PendingPayment for another reason (for example Expired), so
  // Payments can refund it.
  async confirm(bookingId: string): Promise<void> {
    const booking = await this.findById(bookingId);
    if (!booking) throw new NotFoundException(BOOKING_NOT_FOUND);
    if (booking.status === BookingStatus.CONFIRMED) return;
    assertTransition(booking.status, BookingStatus.CONFIRMED);

    const confirmed = await this.markConfirmed(booking._id);
    if (!confirmed) {
      // Someone else changed it between the read and the update.
      const now = await this.findById(bookingId);
      if (now?.status === BookingStatus.CONFIRMED) return;
      throw new ConflictException(
        `A booking cannot change from ${now?.status} to Confirmed`,
      );
    }

    // Only the call that won the status change moves the seats, once.
    await Promise.all(
      confirmed.segments.map((s) =>
        this.flights.updateOne(
          { _id: s.flightId },
          {
            $inc: {
              'cabins.$[c].heldSeats': -s.seats,
              'cabins.$[c].bookedSeats': s.seats,
            },
          },
          { arrayFilters: [{ 'c._id': s.cabinId }] },
        ),
      ),
    );

    // GEN-01. A failed notification must not undo a paid booking.
    const route = confirmed.segments
      .map((s) => `${s.flightNumber} ${s.from}-${s.to}`)
      .join(', ');
    await this.notifications
      .create(
        confirmed.userId,
        NotificationType.BOOKING_CONFIRMED,
        `Your flight booking ${confirmed.reference} is confirmed: ${route}`,
        { bookingId: String(confirmed._id), reference: confirmed.reference },
      )
      .catch((err) =>
        this.logger.error(
          `Notification for ${confirmed.reference} failed: ${err.message}`,
        ),
      );
  }

  // GET /flight-bookings/:id: the owner's booking in any status (the
  // confirmation page; Hasan's FLT-25 reuses it). Anyone else: 404.
  async getForOwner(userId: string, id: string): Promise<FlightBookingView> {
    const booking = await this.findById(id);
    if (!booking || String(booking.userId) !== String(userId)) {
      throw new NotFoundException(BOOKING_NOT_FOUND);
    }
    return this.toView(booking);
  }

  // FLT-23: the e-ticket exists only for the owner's Confirmed booking.
  async getTicketData(userId: string, id: string): Promise<FlightBookingView> {
    const view = await this.getForOwner(userId, id);
    if (view.status !== BookingStatus.CONFIRMED) {
      throw new BadRequestException(ETICKET_NOT_CONFIRMED);
    }
    return view;
  }

  // PendingPayment -> Confirmed in one conditional update, with a new FL-
  // reference. A reference already used (unique index, about 1 in 2.8
  // trillion) gets a new one.
  private async markConfirmed(
    id: Types.ObjectId,
  ): Promise<LeanFlightBooking | null> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.bookings
          .findOneAndUpdate(
            { _id: id, status: BookingStatus.PENDING_PAYMENT },
            {
              $set: {
                status: BookingStatus.CONFIRMED,
                reference: generateBookingReference('FL'),
                confirmedAt: new Date(),
                expiresAt: null,
              },
            },
            { new: true },
          )
          .lean<LeanFlightBooking>();
      } catch (err) {
        if ((err as { code?: number }).code !== 11000 || attempt >= 4) {
          throw err;
        }
      }
    }
  }

  private findById(id: string): Promise<LeanFlightBooking | null> {
    return isValidObjectId(id)
      ? this.bookings.findById(id).lean<LeanFlightBooking>().exec()
      : Promise.resolve(null);
  }

  private async toView(booking: LeanFlightBooking): Promise<FlightBookingView> {
    const codes = [...new Set(booking.segments.flatMap((s) => [s.from, s.to]))];
    const airports = await this.airports
      .find({ _id: { $in: codes } }, { timeZone: 1 })
      .lean<{ _id: string; timeZone: string }[]>();
    const zone = new Map(airports.map((a) => [a._id, a.timeZone]));
    return {
      ...booking,
      segments: booking.segments.map(({ departureAt, arrivalAt, ...s }) => ({
        ...s,
        departure: toZonedTime(departureAt, zone.get(s.from) ?? 'UTC'),
        arrival: toZonedTime(arrivalAt, zone.get(s.to) ?? 'UTC'),
      })),
    };
  }
}
