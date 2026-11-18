import { Injectable, NotImplementedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import { PayableBooking, PaymentHandler } from '../payments/payment-handler';
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
}
