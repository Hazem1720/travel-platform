import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model } from 'mongoose';
import { PayableBooking, PaymentHandler } from '../payments/payment-handler';
import { FlightConfirmationService } from './flight-confirmation.service';
import { FlightHoldService, LeanFlightBooking } from './flight-hold.service';
import {
  FlightBooking,
  FlightBookingDocument,
} from './schemas/flight-booking.schema';

// PAY-01 contract: what Memo's PaymentsService needs from flight bookings.
// Registered as the 'flight' handler in FlightBookingsModule.onModuleInit().
@Injectable()
export class FlightPaymentHandler implements PaymentHandler {
  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBookingDocument>,
    private readonly holds: FlightHoldService,
    private readonly confirmations: FlightConfirmationService,
  ) {}

  // Payments does the checks (owner, PendingPayment, hold, policies).
  async getPayable(bookingId: string): Promise<PayableBooking | null> {
    if (!isValidObjectId(bookingId)) return null;
    const b = await this.bookings.findById(bookingId).lean<LeanFlightBooking>();
    if (!b) return null;
    return {
      bookingId: String(b._id),
      userId: String(b.userId),
      status: b.status,
      amount: b.totalAmount,
      currency: b.currency,
      expiresAt: b.expiresAt ?? null,
      policiesAcceptedAt: b.policiesAcceptedAt ?? null,
      description: `Flight ${b.segments
        .map((s) => `${s.flightNumber} ${s.from}-${s.to}`)
        .join(', ')}`,
    };
  }

  // FLT-23: after Stripe's webhook verified the payment. Safe to call twice;
  // 409 if the booking is no longer PendingPayment (Payments refunds it).
  confirm(bookingId: string): Promise<void> {
    return this.confirmations.confirm(bookingId);
  }

  // The hold ran out: Expired and the seats released (FLT-22).
  expire(bookingId: string): Promise<void> {
    return this.holds.expire(bookingId);
  }
}
