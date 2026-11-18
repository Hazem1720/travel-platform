import { Injectable, NotImplementedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { Hotel, HotelDocument } from '../hotels/schemas/hotel.schema';
import {
  BookingPolicies,
  PayableBooking,
  PaymentHandler,
} from '../payments/payment-handler';
import { HotelHoldService, LeanHotelBooking } from './hotel-hold.service';
import {
  HotelBooking,
  HotelBookingDocument,
} from './schemas/hotel-booking.schema';

// PAY-01 contract for hotels: what PaymentsService reads and calls.
// Registered as the 'hotel' handler in HotelBookingsModule.onModuleInit().
@Injectable()
export class HotelPaymentHandler implements PaymentHandler {
  constructor(
    @InjectModel(HotelBooking.name)
    private readonly bookings: Model<HotelBookingDocument>,
    @InjectModel(Hotel.name) private readonly hotels: Model<HotelDocument>,
    private readonly holds: HotelHoldService,
  ) {}

  // Payments does the checks (owner, PendingPayment, hold, policies).
  async getPayable(bookingId: string): Promise<PayableBooking | null> {
    if (!isValidObjectId(bookingId)) return null;
    const b = await this.bookings.findById(bookingId).lean<LeanHotelBooking>();
    if (!b) return null;
    return {
      bookingId: String(b._id),
      userId: String(b.userId),
      status: b.status,
      amount: b.totalAmount,
      currency: b.currency,
      expiresAt: b.expiresAt ?? null,
      policiesAcceptedAt: b.policiesAcceptedAt ?? null,
      description: `Hotel ${b.hotelName}, ${b.checkIn} to ${b.checkOut}`,
    };
  }

  // HTL-17 (phase 4): PendingPayment to Confirmed, Held nights to Booked,
  // HT- reference and notification. Built with PAY-01; until then the
  // webhook cannot call it, since createPayment answers 501.
  confirm(bookingId: string): Promise<void> {
    return Promise.reject(
      new NotImplementedException(
        `Hotel confirmation comes with HTL-17 (reservation ${bookingId})`,
      ),
    );
  }

  // HTL-18: the hold ran out, Expired and the rooms released.
  expire(bookingId: string): Promise<void> {
    return this.holds.expire(bookingId);
  }

  // PAY-02: the hotel's cancellation tiers and check-in/check-out times
  // (Rawda's HTL-09, HTL-10), as they are now. Payments checks the owner.
  async getPolicies(bookingId: string): Promise<BookingPolicies | null> {
    if (!isValidObjectId(bookingId)) return null;
    const b = await this.bookings.findById(bookingId).lean<LeanHotelBooking>();
    if (!b) return null;
    const hotel = await this.hotels
      .findById(b.hotelId, {
        name: 1,
        cancellationTiers: 1,
        checkInTime: 1,
        checkOutTime: 1,
      })
      .lean();
    return {
      bookingId: String(b._id),
      userId: String(b.userId),
      status: b.status,
      expiresAt: b.expiresAt ?? null,
      policiesAcceptedAt: b.policiesAcceptedAt ?? null,
      provider: { id: String(b.hotelId), name: hotel?.name ?? b.hotelName },
      cancellationTiers: [...(hotel?.cancellationTiers ?? [])]
        .map(({ daysBefore, refundPercent }) => ({ daysBefore, refundPercent }))
        .sort((x, y) => y.daysBefore - x.daysBefore),
      checkInTime: hotel?.checkInTime,
      checkOutTime: hotel?.checkOutTime,
    };
  }

  // PAY-02: stores the acceptance time once, only while the reservation is
  // PendingPayment and its hold has not run out. False if that no longer
  // holds (Payments answers 409).
  async acceptPolicies(bookingId: string, at: Date): Promise<boolean> {
    const res = await this.bookings.updateOne(
      {
        _id: bookingId,
        status: BookingStatus.PENDING_PAYMENT,
        expiresAt: { $gt: at },
        policiesAcceptedAt: null,
      },
      { $set: { policiesAcceptedAt: at } },
    );
    return res.modifiedCount === 1;
  }
}
