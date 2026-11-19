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
  RefundStatus,
} from './payment-handler';
import {
  LeanPayment,
  Payment,
  PaymentDocument,
} from './schemas/payment.schema';
import { LeanRefund, Refund, RefundDocument } from './schemas/refund.schema';
import { StripeGateway, StripeIntent, StripeRefund } from './stripe.gateway';
import { assertOwner } from '../common/helpers/ownership';
import { AuthUser } from '../common/types/auth-user.type';
import { NotificationType } from '../notifications/schemas/notification.schema';
import { NotificationsService } from '../notifications/notifications.service';

export const NOTHING_TO_REFUND =
  'This booking has no successful payment to refund';
export const REFUND_NOT_FOUND = 'Refund not found';
const REFUND_EVENTS = new Set([
  'refund.created',
  'refund.updated',
  'refund.failed',
  'charge.refund.updated',
]);

export const BOOKING_NOT_FOUND = 'Booking not found';
export const PAYMENT_NOT_FOUND = 'Payment not found';
export const ALREADY_PAID = 'This payment has already succeeded';
export const HOLD_EXPIRED = 'The hold has expired; please book again';
export const NOT_PENDING_PAYMENT = 'This booking is not waiting for payment';
export const POLICIES_NOT_ACCEPTED =
  'Accept the cancellation and booking policies before paying';

// PAY-01 and PAY-03. createPayment, the Stripe webhook (handleStripeEvent),
// releaseInventory and refund talk to Stripe through StripeGateway.
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
    @InjectModel(Refund.name)
    private readonly refunds: Model<RefundDocument>,
    private readonly notifications: NotificationsService,
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

  // PAY-01, as section 8.7 of the project description lists it:
  // GET /api/payments/:id. The user's own payment, without Stripe secrets;
  // another user's is 404 (ACC-11).
  async getPayment(user: AuthUser, id: string): Promise<PaymentView> {
    const payment = await this.ownPayment(user, id);
    return {
      _id: String(payment._id),
      bookingType: payment.bookingType,
      bookingId: String(payment.bookingId),
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
    };
  }

  // PAY-01: POST /api/payments/:id/retry after a declined card. Pays the
  // same booking again, inside its hold (the same rules as paying).
  async retryPayment(user: AuthUser, id: string): Promise<CreatedPayment> {
    const payment = await this.ownPayment(user, id);
    if (payment.status === PaymentStatus.SUCCEEDED) {
      throw new ConflictException(ALREADY_PAID);
    }
    return this.createPayment(
      payment.bookingType,
      String(payment.bookingId),
      user.id,
    );
  }

  private async ownPayment(user: AuthUser, id: string): Promise<LeanPayment> {
    const payment = isValidObjectId(id)
      ? await this.payments
          .findOne({ _id: id, userId: new Types.ObjectId(user.id) })
          .lean<LeanPayment>()
      : null;
    if (!payment) throw new NotFoundException(PAYMENT_NOT_FOUND);
    return payment;
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
  async handleStripeEvent(
    type: string,
    intent: StripeIntent | null,
    refund: StripeRefund | null = null,
  ) {
    if (refund && REFUND_EVENTS.has(type)) return this.onRefundEvent(refund);
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
      // give it all back, recorded like any refund (PAY-03). (Hold expiry
      // cancels the PaymentIntent first, so this only happens in a race.)
      // A repeated event finds nothing left to refund.
      const fresh = await this.payments
        .findById(payment._id)
        .lean<LeanPayment>();
      const left = fresh!.amount - (await this.refunded(fresh!._id));
      if (left <= 0) return;
      const result = await this.issueRefund(fresh!, left);
      this.logger.warn(
        `Payment ${intent.id} arrived for ${payment.bookingType} booking ` +
          `${String(payment.bookingId)} that cannot be confirmed ` +
          `(${err.message}); refund ${result.refundId}: ${result.status}`,
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

  // PAY-03: refunds `amount` cents of the booking's succeeded payment
  // through the Stripe Refunds API, records it and notifies the user. Used
  // by Hasan for every cancellation (FLT-06 at 100%, FLT-26, HTL-21) with
  // the amount from refundAmount() in common/helpers/cancellation-tiers.ts.
  // An amount of 0 creates nothing and returns null. Never more than what
  // is left of the payment (409). If Stripe fails, the refund is recorded
  // as Failed and returned, not thrown, so a cancellation never half-fails.
  async refund(
    type: PaymentBookingType,
    bookingId: string,
    amount: number,
  ): Promise<RefundResult | null> {
    const handler = this.handler(type);
    if (!isCents(amount)) {
      throw new Error(`Refund amount must be whole cents, got ${amount}`);
    }
    if (amount === 0) return null;
    const payment = isValidObjectId(bookingId)
      ? await this.payments
          .findOne({
            bookingType: type,
            bookingId: new Types.ObjectId(bookingId),
            status: PaymentStatus.SUCCEEDED,
          })
          .lean<LeanPayment>()
      : null;
    if (!payment) throw new ConflictException(NOTHING_TO_REFUND);
    const booking = await handler.getPayable(bookingId);
    return this.issueRefund(payment, amount, booking?.description);
  }

  // Records the refund first, so its id is the Stripe idempotency key and
  // a retry can never refund twice; then asks Stripe and stores the answer.
  private async issueRefund(
    payment: LeanPayment,
    amount: number,
    description?: string,
  ): Promise<RefundResult> {
    const left = payment.amount - (await this.refunded(payment._id));
    if (amount > left) {
      throw new ConflictException(
        `Only ${left} cents of this payment can still be refunded`,
      );
    }
    const record = await this.refunds.create({
      bookingType: payment.bookingType,
      bookingId: payment.bookingId,
      userId: payment.userId,
      paymentId: payment._id,
      amount,
      currency: payment.currency,
      status: RefundStatus.PENDING,
    });
    const refundId = String(record._id);

    let status = RefundStatus.FAILED;
    try {
      const stripeRefund = await this.stripe.createRefund(
        payment.stripePaymentIntentId,
        amount,
        {
          refundId,
          bookingType: payment.bookingType,
          bookingId: String(payment.bookingId),
        },
        `refund-${refundId}`,
      );
      status = toRefundStatus(stripeRefund.status);
      await this.refunds.updateOne(
        { _id: record._id },
        { $set: { stripeRefundId: stripeRefund.id } },
      );
    } catch (err) {
      this.logger.error(
        `Refund ${refundId} of ${amount} cents for ${payment.bookingType} ` +
          `booking ${String(payment.bookingId)} failed: ${(err as Error).message}`,
      );
    }
    // The webhook may already have moved it on; never step back.
    await this.refunds.updateOne(
      { _id: record._id, status: RefundStatus.PENDING },
      { $set: { status } },
    );

    await this.notifyRefund(payment, amount, status, description);
    return { refundId, amount, currency: payment.currency, status };
  }

  // Cents already refunded or on their way (Failed refunds give nothing).
  private async refunded(paymentId: Types.ObjectId): Promise<number> {
    const refunds = await this.refunds
      .find({ paymentId, status: { $ne: RefundStatus.FAILED } }, { amount: 1 })
      .lean<{ amount: number }[]>();
    return refunds.reduce((sum, r) => sum + r.amount, 0);
  }

  // PAY-03 webhook: Stripe's refund events (refund.created, refund.updated,
  // refund.failed, charge.refund.updated). Pending -> Refunded or Failed;
  // Refunded -> Failed happens when a bank rejects it later. A refund that
  // fails tells the user.
  private async onRefundEvent(refund: StripeRefund): Promise<void> {
    const status = toRefundStatus(refund.status);
    if (status === RefundStatus.PENDING) return;
    const from =
      status === RefundStatus.REFUNDED
        ? [RefundStatus.PENDING]
        : [RefundStatus.PENDING, RefundStatus.REFUNDED];
    const match = isValidObjectId(refund.metadata.refundId)
      ? {
          $or: [
            { stripeRefundId: refund.id },
            { _id: new Types.ObjectId(refund.metadata.refundId) },
          ],
        }
      : { stripeRefundId: refund.id };
    const updated = await this.refunds
      .findOneAndUpdate(
        { ...match, status: { $in: from } },
        { $set: { status, stripeRefundId: refund.id } },
        { new: true },
      )
      .lean<LeanRefund>();
    if (updated && status === RefundStatus.FAILED) {
      const payment = await this.payments
        .findById(updated.paymentId)
        .lean<LeanPayment>();
      if (payment) await this.notifyRefund(payment, updated.amount, status);
    }
  }

  // GEN-01: REFUND_ISSUED with the amount and its status. A failed
  // notification never undoes the refund.
  private async notifyRefund(
    payment: LeanPayment,
    amount: number,
    status: RefundStatus,
    description?: string,
  ): Promise<void> {
    const money = `${(amount / 100).toFixed(2)} ${payment.currency}`;
    const what = description ?? `${payment.bookingType} booking`;
    const text = {
      [RefundStatus.REFUNDED]: `A refund of ${money} for your ${what} has been issued`,
      [RefundStatus.PENDING]: `A refund of ${money} for your ${what} is being processed`,
      [RefundStatus.FAILED]: `The refund of ${money} for your ${what} could not be completed; please contact support`,
    }[status];
    await this.notifications
      .create(payment.userId, NotificationType.REFUND_ISSUED, text, {
        bookingType: payment.bookingType,
        bookingId: String(payment.bookingId),
        amount,
        currency: payment.currency,
        status,
      })
      .catch((err: Error) =>
        this.logger.error(`Refund notification failed: ${err.message}`),
      );
  }

  // PAY-03: the refunds of one booking, oldest first, for the booking
  // details pages (GET /flight-bookings/:id, GET /hotel-bookings/:id).
  async refundsFor(
    type: PaymentBookingType,
    bookingId: string,
  ): Promise<RefundView[]> {
    if (!isValidObjectId(bookingId)) return [];
    const refunds = await this.refunds
      .find({ bookingType: type, bookingId: new Types.ObjectId(bookingId) })
      .sort({ createdAt: 1 })
      .lean<LeanRefund[]>();
    return refunds.map(toRefundView);
  }

  // PAY-03: GET /refunds/:id, the user's own refund (404 for anyone else).
  async getRefundFor(user: AuthUser, id: string): Promise<RefundView> {
    const refund = isValidObjectId(id)
      ? await this.refunds.findById(id).lean<LeanRefund>()
      : null;
    assertOwner(refund?.userId, user, REFUND_NOT_FOUND);
    return toRefundView(refund!);
  }
}

// PAY-01: GET /api/payments/:id
export interface PaymentView {
  _id: string;
  bookingType: PaymentBookingType;
  bookingId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface RefundView {
  _id: string;
  bookingType: PaymentBookingType;
  bookingId: string;
  amount: number;
  currency: string;
  status: RefundStatus;
  createdAt?: Date;
  updatedAt?: Date;
}

function toRefundView(r: LeanRefund): RefundView {
  return {
    _id: String(r._id),
    bookingType: r.bookingType,
    bookingId: String(r.bookingId),
    amount: r.amount,
    currency: r.currency,
    status: r.status,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

// Stripe's refund status as one of ours (conventions.md).
export function toRefundStatus(stripeStatus: string): RefundStatus {
  if (stripeStatus === 'succeeded') return RefundStatus.REFUNDED;
  if (stripeStatus === 'failed' || stripeStatus === 'canceled') {
    return RefundStatus.FAILED;
  }
  return RefundStatus.PENDING;
}
