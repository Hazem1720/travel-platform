import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { isCents, isPlatformCurrency } from '../common/helpers/money';
import {
  BookingPolicies,
  CreatedPayment,
  PayableBooking,
  PaymentBookingType,
  PaymentHandler,
  PaymentStatus,
  RefundResult,
} from './payment-handler';
import {
  LeanPayment,
  Payment,
  PaymentDocument,
} from './schemas/payment.schema';
import { StripeGateway, StripeIntent } from './stripe.gateway';

export const BOOKING_NOT_FOUND = 'Booking not found';
export const HOLD_EXPIRED = 'The hold has expired; please book again';
export const NOT_PENDING_PAYMENT = 'This booking is not waiting for payment';
export const POLICIES_NOT_ACCEPTED =
  'Accept the cancellation and booking policies before paying';

// PAY-01 and PAY-03. createPayment, the Stripe webhook (handleStripeEvent)
// and releaseInventory talk to Stripe through StripeGateway; refund with a
// positive amount answers 501 until PAY-03.
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
  private readonly logger = new Logger(PaymentsService.name);
  private readonly handlers = new Map<PaymentBookingType, PaymentHandler>();

  constructor(
    @InjectModel(Payment.name)
    private readonly payments: Model<PaymentDocument>,
    private readonly stripe: StripeGateway,
  ) {}

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

  // PAY-02: the policies of the user's own booking (404 for anyone else).
  // Readable in any status, e.g. on a confirmation page.
  async getPolicies(
    type: PaymentBookingType,
    bookingId: string,
    userId: string,
  ) {
    const policies = await this.ownPolicies(type, bookingId, userId);
    return {
      type,
      bookingId: policies.bookingId,
      status: policies.status,
      provider: policies.provider,
      cancellationTiers: policies.cancellationTiers,
      ...(policies.checkInTime !== undefined
        ? { checkInTime: policies.checkInTime }
        : {}),
      ...(policies.checkOutTime !== undefined
        ? { checkOutTime: policies.checkOutTime }
        : {}),
      ...(policies.baggage ? { baggage: policies.baggage } : {}),
      accepted: policies.policiesAcceptedAt !== null,
      policiesAcceptedAt: policies.policiesAcceptedAt,
      expiresAt: policies.expiresAt,
    };
  }

  // PAY-02: the acceptance checkbox. Stores policiesAcceptedAt (now) on the
  // user's own PendingPayment booking whose hold has not run out; payment
  // (getPayableFor) answers 400 until then. Accepting again keeps the first
  // timestamp.
  async acceptPolicies(
    type: PaymentBookingType,
    bookingId: string,
    userId: string,
  ): Promise<{
    type: PaymentBookingType;
    bookingId: string;
    accepted: true;
    policiesAcceptedAt: Date;
  }> {
    const policies = await this.ownPolicies(type, bookingId, userId);
    const done = (policiesAcceptedAt: Date) => ({
      type,
      bookingId: policies.bookingId,
      accepted: true as const,
      policiesAcceptedAt,
    });
    if (policies.status !== BookingStatus.PENDING_PAYMENT) {
      throw new ConflictException(NOT_PENDING_PAYMENT);
    }
    if (!policies.expiresAt || policies.expiresAt.getTime() <= Date.now()) {
      throw new ConflictException(HOLD_EXPIRED);
    }
    if (policies.policiesAcceptedAt) return done(policies.policiesAcceptedAt);

    const at = new Date();
    const saved = await this.handler(type).acceptPolicies!(
      policies.bookingId,
      at,
    );
    if (!saved) throw new ConflictException(HOLD_EXPIRED);
    return done(at);
  }

  private async ownPolicies(
    type: PaymentBookingType,
    bookingId: string,
    userId: string,
  ): Promise<BookingPolicies> {
    // `type` comes from the URL, so a booking module that is not there yet
    // (or has no policies yet) is a 501, not a 500.
    const handler = this.handlers.get(type);
    if (!handler?.getPolicies || !handler.acceptPolicies) {
      throw new NotImplementedException(
        `Policies for ${type} bookings are not available yet (PAY-02)`,
      );
    }
    const policies = await handler.getPolicies(bookingId);
    if (!policies || String(policies.userId) !== String(userId)) {
      throw new NotFoundException(BOOKING_NOT_FOUND);
    }
    return policies;
  }

  // PAY-01: POST /bookings/:type/:id/pay. Creates the Stripe PaymentIntent
  // for the booking total and returns its client secret; the frontend
  // confirms it with Stripe Elements, so card details never reach us.
  // Paying again after a failed attempt (until the hold ends) returns the
  // same PaymentIntent: one booking never gets two charges.
  async createPayment(
    type: PaymentBookingType,
    bookingId: string,
    userId: string,
  ): Promise<CreatedPayment> {
    const booking = await this.getPayableFor(type, bookingId, userId);
    const intent = await this.stripe.createIntent(
      {
        amount: booking.amount,
        currency: booking.currency.toLowerCase(),
        description: booking.description,
        metadata: {
          bookingType: type,
          bookingId: booking.bookingId,
          userId: booking.userId,
        },
      },
      `pay-${type}-${booking.bookingId}`,
    );
    if (intent.status === 'canceled' || !intent.clientSecret) {
      throw new ConflictException(HOLD_EXPIRED);
    }

    const payment = await this.recordPayment(type, booking, intent);
    // A retry after a failed card: Pending again.
    if (payment.status === PaymentStatus.FAILED) {
      await this.payments.updateOne(
        { _id: payment._id, status: PaymentStatus.FAILED },
        { $set: { status: PaymentStatus.PENDING } },
      );
    }
    return {
      paymentId: String(payment._id),
      clientSecret: intent.clientSecret,
      amount: payment.amount,
      currency: payment.currency,
      expiresAt: booking.expiresAt!,
    };
  }

  // One Payment per PaymentIntent (unique index): of two requests at the
  // same moment, the second reads what the first stored.
  private async recordPayment(
    type: PaymentBookingType,
    booking: PayableBooking,
    intent: StripeIntent,
  ): Promise<LeanPayment> {
    const filter = { stripePaymentIntentId: intent.id };
    try {
      return await this.payments
        .findOneAndUpdate(
          filter,
          {
            $setOnInsert: {
              bookingType: type,
              bookingId: new Types.ObjectId(booking.bookingId),
              userId: new Types.ObjectId(booking.userId),
              amount: intent.amount,
              currency: intent.currency.toUpperCase(),
              status: PaymentStatus.PENDING,
            },
          },
          { upsert: true, new: true },
        )
        .lean<LeanPayment>();
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err;
      return this.payments.findOne(filter).lean<LeanPayment>();
    }
  }

  // PAY-01: POST /payments/webhook, after StripeGateway verified the
  // signature. The booking is confirmed only here, from Stripe's own
  // "payment_intent.succeeded", never from anything the browser sends.
  // Stripe may send an event twice or out of order; every step is safe to
  // repeat. An error (500) makes Stripe send the event again later.
  async handleStripeEvent(type: string, intent: StripeIntent | null) {
    if (!intent) return;
    const payment = await this.payments
      .findOne({ stripePaymentIntentId: intent.id })
      .lean<LeanPayment>();
    // Not one of ours (another test in the same Stripe account).
    if (!payment) return;

    switch (type) {
      case 'payment_intent.succeeded':
        return this.onSucceeded(payment, intent);
      case 'payment_intent.payment_failed':
        // The frontend shows Stripe's message; the user may retry until
        // the hold ends.
        await this.setStatus(payment, PaymentStatus.FAILED, [
          PaymentStatus.PENDING,
        ]);
        return;
      case 'payment_intent.canceled':
        await this.setStatus(payment, PaymentStatus.EXPIRED, [
          PaymentStatus.PENDING,
          PaymentStatus.FAILED,
        ]);
        return;
    }
  }

  private async onSucceeded(
    payment: LeanPayment,
    intent: StripeIntent,
  ): Promise<void> {
    // Stripe must have received exactly the booking total (PAY-04).
    if (
      intent.amountReceived !== payment.amount ||
      !isPlatformCurrency(intent.currency)
    ) {
      this.logger.error(
        `Payment ${intent.id} received ${intent.amountReceived} ` +
          `${intent.currency}, expected ${payment.amount} ${payment.currency}; ` +
          'booking not confirmed',
      );
      return;
    }
    await this.setStatus(payment, PaymentStatus.SUCCEEDED, [
      PaymentStatus.PENDING,
      PaymentStatus.FAILED,
      PaymentStatus.EXPIRED,
    ]);
    try {
      await this.confirmBooking(payment.bookingType, String(payment.bookingId));
    } catch (err) {
      if (!(err instanceof ConflictException)) throw err;
      // The booking expired or was cancelled before the money arrived:
      // give it all back. (Hold expiry cancels the PaymentIntent first, so
      // this only happens in a race.) PAY-03 will record the refund.
      const refundId = await this.stripe.refundIntent(
        intent.id,
        `refund-unconfirmed-${intent.id}`,
      );
      this.logger.warn(
        `Payment ${intent.id} arrived for ${payment.bookingType} booking ` +
          `${String(payment.bookingId)} that cannot be confirmed ` +
          `(${err.message}); refunded in full (${refundId})`,
      );
    }
  }

  private async setStatus(
    payment: LeanPayment,
    status: PaymentStatus,
    from: PaymentStatus[],
  ): Promise<void> {
    await this.payments.updateOne(
      { _id: payment._id, status: { $in: from } },
      { $set: { status } },
    );
  }

  // Called by the Stripe webhook after it verifies a successful payment.
  async confirmBooking(
    type: PaymentBookingType,
    bookingId: string,
  ): Promise<void> {
    await this.handler(type).confirm(bookingId);
  }

  // Called when a hold runs out (the expiry jobs, and FLT-22 before a new
  // hold): the PaymentIntent is cancelled first, then the booking is
  // Expired and its seats or rooms released (conventions.md, "Hold
  // expiry"). Cancelling first means no payment can succeed afterwards. If
  // Stripe says the payment already succeeded, the booking is confirmed
  // instead. If Stripe cannot be reached, nothing changes and the next run
  // tries again, so a booking is never expired with a live PaymentIntent.
  async releaseInventory(
    type: PaymentBookingType,
    bookingId: string,
  ): Promise<void> {
    const handler = this.handler(type);
    const open = isValidObjectId(bookingId)
      ? await this.payments
          .find({
            bookingType: type,
            bookingId: new Types.ObjectId(bookingId),
            status: { $in: [PaymentStatus.PENDING, PaymentStatus.FAILED] },
          })
          .lean<LeanPayment[]>()
      : [];

    for (const payment of open) {
      let status: string;
      try {
        status = await this.stripe.cancelIntent(payment.stripePaymentIntentId);
      } catch (err) {
        this.logger.error(
          `Hold expiry of ${type} booking ${bookingId} postponed: ` +
            (err as Error).message,
        );
        return;
      }
      if (status === 'succeeded') {
        // Paid just before the end of the hold: the webhook may still be
        // on its way; confirming twice is safe.
        await this.setStatus(payment, PaymentStatus.SUCCEEDED, [
          PaymentStatus.PENDING,
          PaymentStatus.FAILED,
        ]);
        await this.confirmBooking(type, bookingId);
        return;
      }
      if (status !== 'canceled') {
        // Still processing at Stripe: wait for the outcome.
        return;
      }
      await this.setStatus(payment, PaymentStatus.EXPIRED, [
        PaymentStatus.PENDING,
        PaymentStatus.FAILED,
      ]);
    }
    await handler.expire(bookingId);
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
