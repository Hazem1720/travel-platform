import { BookingStatus } from '../common/enums/booking-status.enum';

// PAY-01 contract (team plan, B3 "Shared contracts"). The two booking flows
// meet here: FlightBookings (Aabsy, FLT-22, FLT-23) and HotelBookings (Memo,
// HTL-18, HTL-17) each register one handler, and PaymentsService calls it.
// Payments never reads a booking collection itself.

export enum PaymentBookingType {
  FLIGHT = 'flight',
  HOTEL = 'hotel',
}

// conventions.md, "Payments and refunds".
export enum PaymentStatus {
  PENDING = 'Pending',
  SUCCEEDED = 'Succeeded',
  FAILED = 'Failed',
  EXPIRED = 'Expired',
}

export enum RefundStatus {
  PENDING = 'Pending',
  REFUNDED = 'Refunded',
  FAILED = 'Failed',
}

// What a booking module tells Payments about one booking.
export interface PayableBooking {
  bookingId: string;
  // The owner: Payments answers 404 to anyone else.
  userId: string;
  status: BookingStatus;
  // The total of the price snapshot, in cents of the platform currency
  // (PAY-04): what the PaymentIntent charges.
  amount: number;
  currency: string;
  // End of the 10-minute hold (PendingPayment only).
  expiresAt: Date | null;
  // PAY-02: when the user accepted the provider's policies; payment is
  // refused while this is null.
  policiesAcceptedAt: Date | null;
  // Short text for the Stripe dashboard, e.g. "Flight MS777 CAI-LHR".
  description?: string;
}

export interface PaymentHandler {
  // The booking, or null if it does not exist. Payments does the checks
  // (owner, PendingPayment, hold not expired, policies accepted), so they are
  // the same for flights and hotels.
  getPayable(bookingId: string): Promise<PayableBooking | null>;

  // Called once Stripe's webhook has verified a successful payment (FLT-23,
  // HTL-17): PendingPayment to Confirmed, held seats or rooms to booked,
  // booking reference, notification. Must be safe to call twice for the same
  // booking (Stripe may repeat an event): the second call changes nothing.
  // Throw ConflictException if the booking is no longer PendingPayment for
  // another reason (e.g. it expired), so the payment can be refunded.
  confirm(bookingId: string): Promise<void>;

  // The hold ran out (FLT-22, HTL-18): PendingPayment to Expired and the
  // seats or rooms released. Also safe to call twice.
  expire(bookingId: string): Promise<void>;
}

// Returned by PaymentsService.createPayment: the frontend passes clientSecret
// to Stripe Elements; card details never reach the backend.
export interface CreatedPayment {
  paymentId: string;
  clientSecret: string;
}

// Returned by PaymentsService.refund for a positive amount.
export interface RefundResult {
  refundId: string;
  amount: number;
  currency: string;
  status: RefundStatus;
}
