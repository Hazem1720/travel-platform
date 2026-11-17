import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { isCents, isPlatformCurrency } from '../common/helpers/money';
import {
  CreatedPayment,
  PayableBooking,
  PaymentBookingType,
  PaymentHandler,
  RefundResult,
} from './payment-handler';

export const BOOKING_NOT_FOUND = 'Booking not found';
export const HOLD_EXPIRED = 'The hold has expired; please book again';
export const NOT_PENDING_PAYMENT = 'This booking is not waiting for payment';
export const POLICIES_NOT_ACCEPTED =
  'Accept the cancellation and booking policies before paying';

// PAY-01 and PAY-03: the contract other modules build against now. The
// handler registry, the payability checks, confirmBooking and
// releaseInventory work today. The Stripe parts (createPayment, refund with a
// positive amount) answer 501 until PAY-01 and PAY-03 land; mock them in tests.
//
// A booking module registers its handler once at startup:
//
//   @Module({ imports: [PaymentsModule], ... })
//   export class FlightBookingsModule implements OnModuleInit {
//     constructor(private payments: PaymentsService,
//                 private handler: FlightPaymentHandler) {}
//     onModuleInit() {
//       this.payments.registerHandler(PaymentBookingType.FLIGHT, this.handler);
//     }
//   }
@Injectable()
export class PaymentsService {
  private readonly handlers = new Map<PaymentBookingType, PaymentHandler>();

  registerHandler(type: PaymentBookingType, handler: PaymentHandler): void {
    if (!Object.values(PaymentBookingType).includes(type)) {
      throw new Error(`Unknown payment booking type "${String(type)}"`);
    }
    if (this.handlers.has(type)) {
      throw new Error(`A payment handler for "${type}" is already registered`);
    }
    this.handlers.set(type, handler);
  }

  private handler(type: PaymentBookingType): PaymentHandler {
    const handler = this.handlers.get(type);
    // A programming error (module not imported), so a plain 500.
    if (!handler) throw new Error(`No payment handler for "${type}"`);
    return handler;
  }

  // PAY-01 rules, the same for flights and hotels. Returns the booking if the
  // user may pay for it now:
  // - not found or another user's booking: 404 (conventions.md, P-10);
  // - not PendingPayment: 409; hold expired: 409;
  // - policies not accepted (PAY-02): 400.
  async getPayableFor(
    type: PaymentBookingType,
    bookingId: string,
    userId: string,
  ): Promise<PayableBooking> {
    const booking = await this.handler(type).getPayable(bookingId);
    if (!booking || String(booking.userId) !== String(userId)) {
      throw new NotFoundException(BOOKING_NOT_FOUND);
    }
    if (booking.status !== BookingStatus.PENDING_PAYMENT) {
      throw new ConflictException(NOT_PENDING_PAYMENT);
    }
    if (!booking.expiresAt || booking.expiresAt.getTime() <= Date.now()) {
      throw new ConflictException(HOLD_EXPIRED);
    }
    if (!booking.policiesAcceptedAt) {
      throw new BadRequestException(POLICIES_NOT_ACCEPTED);
    }
    if (!isCents(booking.amount) || booking.amount < 1) {
      throw new Error(`Booking ${bookingId} has an invalid amount`);
    }
    if (!isPlatformCurrency(booking.currency)) {
      throw new Error(`Booking ${bookingId} is not in the platform currency`);
    }
    return booking;
  }

  // PAY-01 (stub): creates a Stripe PaymentIntent for the booking total and
  // returns its client secret. The checks above already run, so callers get
  // the real 404/409/400 answers; the Stripe step answers 501 for now.
  async createPayment(
    type: PaymentBookingType,
    bookingId: string,
    userId: string,
  ): Promise<CreatedPayment> {
    await this.getPayableFor(type, bookingId, userId);
    throw new NotImplementedException(
      'Stripe payments are not available yet (PAY-01)',
    );
  }

  // Called by the Stripe webhook after it verifies a successful payment.
  async confirmBooking(
    type: PaymentBookingType,
    bookingId: string,
  ): Promise<void> {
    await this.handler(type).confirm(bookingId);
  }

  // Called by the hold-expiry job (and by PAY-01 when a hold runs out during
  // payment): Expired and inventory released. Cancelling the PaymentIntent is
  // added with PAY-01.
  async releaseInventory(
    type: PaymentBookingType,
    bookingId: string,
  ): Promise<void> {
    await this.handler(type).expire(bookingId);
  }

  // PAY-03 (stub): refunds `amount` cents of the booking's payment through
  // the Stripe Refunds API, records it and notifies the user. Used by Hasan
  // for every cancellation (FLT-06 at 100%, FLT-26, HTL-21) with the amount
  // from refundAmount() in common/helpers/cancellation-tiers.ts.
  // An amount of 0 creates no refund and returns null (works today).
  async refund(
    type: PaymentBookingType,
    bookingId: string,
    amount: number,
  ): Promise<RefundResult | null> {
    this.handler(type);
    if (!isCents(amount)) {
      throw new Error(`Refund amount must be whole cents, got ${amount}`);
    }
    if (amount === 0) return null;
    throw new NotImplementedException(
      `Stripe refunds are not available yet (PAY-03), booking ${bookingId}`,
    );
  }
}
