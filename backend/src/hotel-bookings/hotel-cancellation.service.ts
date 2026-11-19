import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import { BookingStatus } from '../common/enums/booking-status.enum';
import {
  CancellationTierLike,
  refundAmount,
  refundPercent,
} from '../common/helpers/cancellation-tiers';
import { assertOwner } from '../common/helpers/ownership';
import { AuthUser } from '../common/types/auth-user.type';
import { Hotel, HotelDocument } from '../hotels/schemas/hotel.schema';
import { NotificationType } from '../notifications/schemas/notification.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentBookingType, RefundResult } from '../payments/payment-handler';
import { PaymentsService } from '../payments/payments.service';
import { HotelAvailabilityService } from './hotel-availability.service';
import { RESERVATION_NOT_FOUND } from './hotel-confirmation.service';
import { LeanHotelBooking } from './hotel-hold.service';
import { HotelSearchService } from './hotel-search.service';
import {
  HotelBooking,
  HotelBookingDocument,
} from './schemas/hotel-booking.schema';

export const NOT_CONFIRMED = 'Only a Confirmed reservation can be cancelled';
export const CHECK_IN_REACHED =
  'A reservation can only be cancelled before its check-in date';
export const REFUND_CHANGED =
  'The refund amount has changed; review the cancellation again';

const DAY_MS = 24 * 60 * 60 * 1000;

// Whole days from `today` to `checkIn`, both YYYY-MM-DD.
export function daysBetween(today: string, checkIn: string): number {
  return Math.round(
    (Date.parse(`${checkIn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
      DAY_MS,
  );
}

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

interface Quote {
  booking: LeanHotelBooking;
  tiers: CancellationTierLike[];
  daysBeforeCheckIn: number;
  refundPercent: number;
  refundAmount: number;
}

// HTL-21 (Hasan): the user cancels their own Confirmed reservation, as a
// whole, before the check-in date. The refund is the hotel's tier (HTL-10)
// for the days left, counted in the hotel's local date, on the full total.
// The reservation becomes Cancelled, all its room nights are freed, the
// refund goes through PAY-03 and the user is notified (GEN-01).
@Injectable()
export class HotelCancellationService {
  private readonly logger = new Logger(HotelCancellationService.name);

  constructor(
    @InjectModel(HotelBooking.name)
    private readonly bookings: Model<HotelBookingDocument>,
    @InjectModel(Hotel.name) private readonly hotels: Model<HotelDocument>,
    private readonly search: HotelSearchService,
    private readonly availability: HotelAvailabilityService,
    private readonly payments: PaymentsService,
    private readonly notifications: NotificationsService,
  ) {}

  // GET /hotel-bookings/:id/cancellation: what cancelling now would refund.
  async preview(user: AuthUser, id: string, now: Date = new Date()) {
    const q = await this.quote(user, id, now);
    return {
      bookingId: String(q.booking._id),
      reference: q.booking.reference,
      hotelName: q.booking.hotelName,
      checkIn: q.booking.checkIn,
      checkOut: q.booking.checkOut,
      totalAmount: q.booking.totalAmount,
      daysBeforeCheckIn: q.daysBeforeCheckIn,
      refundPercent: q.refundPercent,
      refundAmount: q.refundAmount,
      currency: q.booking.currency,
      cancellationTiers: q.tiers,
    };
  }

  // POST /hotel-bookings/:id/cancel { refundAmount }: the amount the user
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
    // One conditional update, so two cancels (or a cancel and the
    // Completed job) cannot both win.
    const res = await this.bookings.updateOne(
      { _id: b._id, status: BookingStatus.CONFIRMED },
      { $set: { status: BookingStatus.CANCELLED, cancelledAt: now } },
    );
    if (res.modifiedCount === 0) throw new ConflictException(NOT_CONFIRMED);

    const label = b.reference ?? String(b._id);
    // Every room, every night: the reservation's locks all carry its id.
    await this.availability
      .releaseBooking(String(b._id))
      .catch((err: Error) =>
        this.logger.error(`HTL-21 ${label} release: ${err.message}`),
      );

    // A refund problem must not undo the cancellation: PAY-03 records a
    // Stripe failure as Failed (and tells the user) instead of throwing.
    let refund: RefundResult | null = null;
    try {
      refund = await this.payments.refund(
        PaymentBookingType.HOTEL,
        String(b._id),
        q.refundAmount,
      );
    } catch (err) {
      this.logger.error(`HTL-21 ${label} refund: ${(err as Error).message}`);
    }

    await this.notifications
      .create(
        b.userId,
        NotificationType.BOOKING_CANCELLED,
        `Your reservation ${label} at ${b.hotelName} ` +
          `(${b.checkIn} to ${b.checkOut}) is cancelled. ` +
          (q.refundAmount > 0
            ? `A refund of ${usd(q.refundAmount)} (${q.refundPercent}%) has ` +
              'been requested; you will get a separate message about it.'
            : 'No refund applies under the hotel’s cancellation policy.'),
        {
          bookingId: String(b._id),
          reference: b.reference,
          hotelId: String(b.hotelId),
          refundAmount: q.refundAmount,
        },
      )
      .catch((err: Error) =>
        this.logger.error(`HTL-21 ${label} notification: ${err.message}`),
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

  // The owner's Confirmed reservation before its check-in date, and its
  // refund. 404 for anyone else's or an unknown id; 409 otherwise.
  private async quote(user: AuthUser, id: string, now: Date): Promise<Quote> {
    const booking = isValidObjectId(id)
      ? await this.bookings.findById(id).lean<LeanHotelBooking>()
      : null;
    assertOwner(booking?.userId, user, RESERVATION_NOT_FOUND);
    const b = booking!;
    if (b.status !== BookingStatus.CONFIRMED) {
      throw new ConflictException(NOT_CONFIRMED);
    }
    const hotel = await this.hotels
      .findById(b.hotelId, { cityId: 1, cancellationTiers: 1 })
      .lean();
    const today = await this.search.today({ cityId: hotel?.cityId ?? '' }, now);
    const days = daysBetween(today, b.checkIn);
    if (days <= 0) throw new ConflictException(CHECK_IN_REACHED);
    const tiers = [...(hotel?.cancellationTiers ?? [])]
      .map(({ daysBefore, refundPercent }) => ({ daysBefore, refundPercent }))
      .sort((x, y) => y.daysBefore - x.daysBefore);
    return {
      booking: b,
      tiers,
      daysBeforeCheckIn: days,
      refundPercent: refundPercent(tiers, days),
      refundAmount: refundAmount(b.totalAmount, tiers, days),
    };
  }
}
