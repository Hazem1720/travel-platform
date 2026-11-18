import {
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
import { assertOwner } from '../common/helpers/ownership';
import { AuthUser } from '../common/types/auth-user.type';
import { Hotel, HotelDocument } from '../hotels/schemas/hotel.schema';
import { NotificationType } from '../notifications/schemas/notification.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { HotelAvailabilityService } from './hotel-availability.service';
import { LeanHotelBooking } from './hotel-hold.service';
import {
  HotelBooking,
  HotelBookingDocument,
} from './schemas/hotel-booking.schema';

export const RESERVATION_NOT_FOUND = 'Reservation not found';
export const ROOMS_RELEASED =
  'The held rooms were released before the payment arrived';

// The hotel as the confirmation page shows it.
export interface ReservationHotel {
  _id: Types.ObjectId;
  name: string;
  address: string;
  cityId: string;
  checkInTime: string;
  checkOutTime: string;
}

export type HotelBookingView = LeanHotelBooking & {
  hotel: ReservationHotel | null;
};

// HTL-17 (Memo): after payment the reservation (all its rooms) becomes
// Confirmed with an HT- reference, its Held nights become Booked and the
// user is notified. Also the confirmation page, GET /hotel-bookings/:id,
// which Hasan's HTL-20 reuses.
@Injectable()
export class HotelConfirmationService {
  private readonly logger = new Logger(HotelConfirmationService.name);

  constructor(
    @InjectModel(HotelBooking.name)
    private readonly bookings: Model<HotelBookingDocument>,
    @InjectModel(Hotel.name) private readonly hotels: Model<HotelDocument>,
    private readonly availability: HotelAvailabilityService,
    private readonly notifications: NotificationsService,
  ) {}

  // Called by the Stripe webhook through HotelPaymentHandler (PAY-01), only
  // after Stripe verified the payment. Safe to call twice: Stripe may send
  // an event again, and only the first call changes anything. 409 if the
  // reservation can no longer be confirmed (Expired, Cancelled, or its
  // nights were taken after the hold ran out), so Payments refunds it.
  async confirm(bookingId: string): Promise<void> {
    const booking = await this.findById(bookingId);
    if (!booking) throw new NotFoundException(RESERVATION_NOT_FOUND);
    if (booking.status === BookingStatus.CONFIRMED) return;
    assertTransition(booking.status, BookingStatus.CONFIRMED);

    // Every night of every room must still be this reservation's. After the
    // hold runs out, another booking may clear the expired locks and take
    // the room (lockNights), so a late payment must not confirm.
    const id = String(booking._id);
    await this.availability.confirmHeld(id);
    const expected = booking.rooms.length * booking.nights;
    if ((await this.availability.countBooked(id)) < expected) {
      await this.giveUp(booking);
      throw new ConflictException(ROOMS_RELEASED);
    }

    const confirmed = await this.markConfirmed(booking._id);
    if (!confirmed) {
      // Changed between the read and the update (for example expired).
      const now = await this.findById(bookingId);
      if (now?.status === BookingStatus.CONFIRMED) return;
      await this.availability.releaseBooking(id);
      throw new ConflictException(
        `A booking cannot change from ${now?.status} to Confirmed`,
      );
    }

    // GEN-01. A failed notification must not undo a paid reservation.
    const rooms = confirmed.rooms.length;
    await this.notifications
      .create(
        confirmed.userId,
        NotificationType.BOOKING_CONFIRMED,
        `Your hotel reservation ${confirmed.reference} is confirmed: ` +
          `${confirmed.hotelName}, ${confirmed.checkIn} to ${confirmed.checkOut}, ` +
          `${rooms} room${rooms === 1 ? '' : 's'}`,
        {
          bookingId: id,
          reference: confirmed.reference,
          hotelId: String(confirmed.hotelId),
          checkIn: confirmed.checkIn,
          checkOut: confirmed.checkOut,
        },
      )
      .catch((err: Error) =>
        this.logger.error(
          `Notification for ${confirmed.reference} failed: ${err.message}`,
        ),
      );
  }

  // GET /hotel-bookings/:id: the user's own reservation in any status, with
  // the hotel's address and check-in/check-out times. Anyone else: 404.
  async getForOwner(user: AuthUser, id: string): Promise<HotelBookingView> {
    const booking = await this.findById(id);
    assertOwner(booking?.userId, user, RESERVATION_NOT_FOUND);
    const hotel = await this.hotels
      .findById(booking!.hotelId, {
        name: 1,
        address: 1,
        cityId: 1,
        checkInTime: 1,
        checkOutTime: 1,
      })
      .lean<ReservationHotel>();
    return { ...booking!, hotel: hotel ?? null };
  }

  // Its nights are gone: free whatever is left and expire it, so it never
  // blocks anything. The money is refunded by Payments (409).
  private async giveUp(booking: LeanHotelBooking): Promise<void> {
    const res = await this.bookings.updateOne(
      { _id: booking._id, status: BookingStatus.PENDING_PAYMENT },
      { $set: { status: BookingStatus.EXPIRED, expiredAt: new Date() } },
    );
    await this.availability.releaseBooking(String(booking._id));
    this.logger.warn(
      `Reservation ${String(booking._id)} lost its held nights before ` +
        `payment${res.modifiedCount ? '; set to Expired' : ''}`,
    );
  }

  // PendingPayment -> Confirmed in one conditional update, with a new HT-
  // reference. A reference already used (unique index) gets a new one.
  private async markConfirmed(
    id: Types.ObjectId,
  ): Promise<LeanHotelBooking | null> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.bookings
          .findOneAndUpdate(
            { _id: id, status: BookingStatus.PENDING_PAYMENT },
            {
              $set: {
                status: BookingStatus.CONFIRMED,
                reference: generateBookingReference('HT'),
                confirmedAt: new Date(),
                expiresAt: null,
              },
            },
            { new: true },
          )
          .lean<LeanHotelBooking>();
      } catch (err) {
        if ((err as { code?: number }).code !== 11000 || attempt >= 4) {
          throw err;
        }
      }
    }
  }

  private findById(id: string): Promise<LeanHotelBooking | null> {
    return isValidObjectId(id)
      ? this.bookings.findById(id).lean<LeanHotelBooking>().exec()
      : Promise.resolve(null);
  }
}
