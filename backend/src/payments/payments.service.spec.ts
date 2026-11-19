import {
  BadRequestException,
  ConflictException,
  Injectable,
  Module,
  Global,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { BookingStatus } from '../common/enums/booking-status.enum';
import {
  PayableBooking,
  PaymentBookingType,
  PaymentHandler,
  PaymentStatus,
  RefundStatus,
} from './payment-handler';
import { Payment } from './schemas/payment.schema';
import { Refund } from './schemas/refund.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/schemas/notification.schema';
import {
  CreateIntentParams,
  StripeGateway,
  StripeIntent,
} from './stripe.gateway';
import { PaymentsModule } from './payments.module';
import {
  HOLD_EXPIRED,
  NOT_PENDING_PAYMENT,
  PaymentsService,
  NOTHING_TO_REFUND,
  POLICIES_NOT_ACCEPTED,
  REFUND_NOT_FOUND,
} from './payments.service';

// PAY-01: handler registry, payability rules, the Stripe PaymentIntent, the
// webhook events and hold expiry, with a fake Stripe and Payment model.
describe('PaymentsService (PAY-01)', () => {
  const BOOKING = '6735a1f4c1a2b3c4d5e6fa01';
  const USER = '6735a1f4c1a2b3c4d5e6fb01';
  const { FLIGHT, HOTEL } = PaymentBookingType;

  const payable = (over: Partial<PayableBooking> = {}): PayableBooking => ({
    bookingId: BOOKING,
    userId: USER,
    status: BookingStatus.PENDING_PAYMENT,
    amount: 24000,
    currency: 'USD',
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    policiesAcceptedAt: new Date(),
    ...over,
  });

  const intent = (over: Partial<StripeIntent> = {}): StripeIntent => ({
    id: 'pi_1',
    status: 'requires_payment_method',
    amount: 24000,
    amountReceived: 0,
    currency: 'usd',
    clientSecret: 'pi_1_secret_x',
    metadata: {},
    ...over,
  });

  // An in-memory Payment model with the few queries PaymentsService uses.
  // An in-memory Mongoose model with the few queries PaymentsService uses
  // (payments and refunds).
  function fakeModel() {
    const docs: any[] = [];
    const matches = (doc: any, filter: Record<string, any>): boolean =>
      Object.entries(filter).every(([k, v]) => {
        if (k === '$or') return (v as any[]).some((f) => matches(doc, f));
        if (v && typeof v === 'object' && '$in' in v) {
          return v.$in.some((x: unknown) => String(x) === String(doc[k]));
        }
        if (v && typeof v === 'object' && '$ne' in v) {
          return String(doc[k]) !== String(v.$ne);
        }
        return String(doc[k]) === String(v);
      });
    const query = (value: unknown): any => ({
      lean: async () => value,
      sort: () => query(value),
    });
    return {
      docs,
      create: jest.fn(async (data: any) => {
        const doc = {
          _id: new Types.ObjectId(),
          createdAt: new Date(),
          ...data,
        };
        docs.push(doc);
        return { ...doc };
      }),
      findById: jest.fn((id: unknown) => {
        const doc = docs.find((d) => String(d._id) === String(id));
        return query(doc ? { ...doc } : null);
      }),
      findOneAndUpdate: jest.fn((filter: any, update: any) => {
        let doc = docs.find((d) => matches(d, filter));
        if (!doc && update.$setOnInsert) {
          doc = {
            _id: new Types.ObjectId(),
            ...filter,
            ...update.$setOnInsert,
          };
          docs.push(doc);
        }
        if (doc && update.$set) Object.assign(doc, update.$set);
        return query(doc ? { ...doc } : null);
      }),
      findOne: jest.fn((filter: any) => {
        const doc = docs.find((d) => matches(d, filter));
        return query(doc ? { ...doc } : null);
      }),
      find: jest.fn((filter: any) =>
        query(docs.filter((d) => matches(d, filter)).map((d) => ({ ...d }))),
      ),
      updateOne: jest.fn(async (filter: any, update: any) => {
        const doc = docs.find((d) => matches(d, filter));
        if (doc) Object.assign(doc, update.$set);
        return { modifiedCount: doc ? 1 : 0 };
      }),
    };
  }

  function setup(found: PayableBooking | null = payable()) {
    const handler = {
      getPayable: jest.fn(async () => found),
      confirm: jest.fn(async () => undefined),
      expire: jest.fn(async () => undefined),
    };
    const stripe = {
      createIntent: jest.fn(async (p: CreateIntentParams) =>
        intent({ amount: p.amount, currency: p.currency }),
      ),
      cancelIntent: jest.fn(async () => 'canceled'),
      createRefund: jest.fn(async (_pi: string, amount: number) => ({
        id: `re_${amount}`,
        status: 'succeeded',
        amount,
        metadata: {},
      })),
    };
    const store = fakeModel();
    const refunds = fakeModel();
    const notifications = { create: jest.fn(async () => ({})) };
    const service = new PaymentsService(
      store as any,
      stripe as any,
      refunds as any,
      notifications as any,
    );
    service.registerHandler(HOTEL, handler);
    return { service, handler, stripe, store, refunds, notifications };
  }

  describe('registerHandler', () => {
    it('refuses a second handler for the same type, and an unknown type', () => {
      const { service, handler } = setup();
      expect(() => service.registerHandler(HOTEL, handler)).toThrow(
        'already registered',
      );
      expect(() =>
        service.registerHandler('train' as PaymentBookingType, handler),
      ).toThrow('Unknown payment booking type');
    });

    it('fails loudly when a type has no handler', async () => {
      const { service } = setup();
      await expect(service.confirmBooking(FLIGHT, BOOKING)).rejects.toThrow(
        'No payment handler for "flight"',
      );
    });

    it('is one registry for the whole app, whichever module registers', async () => {
      const flight: PaymentHandler = {
        getPayable: jest.fn(),
        confirm: jest.fn(async () => undefined),
        expire: jest.fn(),
      };
      @Injectable()
      class Registrar implements OnModuleInit {
        constructor(private readonly payments: PaymentsService) {}
        onModuleInit() {
          this.payments.registerHandler(FLIGHT, flight);
        }
      }
      @Module({ imports: [PaymentsModule], providers: [Registrar] })
      class FakeFlightBookingsModule {}
      // NotificationsModule is global in the app.
      @Global()
      @Module({
        providers: [{ provide: NotificationsService, useValue: {} }],
        exports: [NotificationsService],
      })
      class FakeNotificationsModule {}

      const app = await Test.createTestingModule({
        imports: [
          FakeNotificationsModule,
          PaymentsModule,
          FakeFlightBookingsModule,
        ],
      })
        .overrideProvider(getModelToken(Payment.name))
        .useValue({})
        .overrideProvider(getModelToken(Refund.name))
        .useValue({})
        .overrideProvider(StripeGateway)
        .useValue({})
        .compile();
      await app.init();
      await app.get(PaymentsService).confirmBooking(FLIGHT, BOOKING);
      expect(flight.confirm).toHaveBeenCalledWith(BOOKING);
      await app.close();
    });
  });

  describe('getPayableFor (PAY-01 rules)', () => {
    it("returns the user's PendingPayment booking within its hold", async () => {
      const { service, handler } = setup();
      await expect(
        service.getPayableFor(HOTEL, BOOKING, USER),
      ).resolves.toMatchObject({ amount: 24000, currency: 'USD' });
      expect(handler.getPayable).toHaveBeenCalledWith(BOOKING);
    });

    it("answers 404 for a missing booking and for another user's", async () => {
      await expect(
        setup(null).service.getPayableFor(HOTEL, BOOKING, USER),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        setup().service.getPayableFor(HOTEL, BOOKING, 'someone-else'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each([
      BookingStatus.CONFIRMED,
      BookingStatus.EXPIRED,
      BookingStatus.CANCELLED,
    ])('answers 409 for a %s booking', async (status) => {
      await expect(
        setup(payable({ status })).service.getPayableFor(HOTEL, BOOKING, USER),
      ).rejects.toThrow(new ConflictException(NOT_PENDING_PAYMENT));
    });

    it('answers 409 once the hold has run out', async () => {
      const expired = payable({ expiresAt: new Date(Date.now() - 1) });
      await expect(
        setup(expired).service.getPayableFor(HOTEL, BOOKING, USER),
      ).rejects.toThrow(new ConflictException(HOLD_EXPIRED));
    });

    it('answers 400 until the policies are accepted (PAY-02)', async () => {
      const notAccepted = payable({ policiesAcceptedAt: null });
      await expect(
        setup(notAccepted).service.getPayableFor(HOTEL, BOOKING, USER),
      ).rejects.toThrow(new BadRequestException(POLICIES_NOT_ACCEPTED));
    });

    it('refuses a broken amount or another currency from a handler (PAY-04)', async () => {
      await expect(
        setup(payable({ amount: 99.5 })).service.getPayableFor(
          HOTEL,
          BOOKING,
          USER,
        ),
      ).rejects.toThrow('invalid amount');
      await expect(
        setup(payable({ currency: 'EGP' })).service.getPayableFor(
          HOTEL,
          BOOKING,
          USER,
        ),
      ).rejects.toThrow('platform currency');
    });
  });

  describe('createPayment (PAY-01)', () => {
    it('runs the checks first and never calls Stripe for a refused booking', async () => {
      const missing = setup(null);
      await expect(
        missing.service.createPayment(HOTEL, BOOKING, USER),
      ).rejects.toBeInstanceOf(NotFoundException);
      const expired = setup(payable({ expiresAt: new Date(Date.now() - 1) }));
      await expect(
        expired.service.createPayment(HOTEL, BOOKING, USER),
      ).rejects.toThrow(new ConflictException(HOLD_EXPIRED));
      expect(missing.stripe.createIntent).not.toHaveBeenCalled();
      expect(expired.stripe.createIntent).not.toHaveBeenCalled();
    });

    it('creates a PaymentIntent for the booking total and stores only id, amount, currency, status', async () => {
      const { service, stripe, store } = setup();
      const result = await service.createPayment(HOTEL, BOOKING, USER);

      expect(stripe.createIntent).toHaveBeenCalledWith(
        {
          amount: 24000,
          currency: 'usd',
          description: undefined,
          metadata: { bookingType: 'hotel', bookingId: BOOKING, userId: USER },
        },
        `pay-hotel-${BOOKING}`,
      );
      expect(result).toEqual({
        paymentId: String(store.docs[0]._id),
        clientSecret: 'pi_1_secret_x',
        amount: 24000,
        currency: 'USD',
        expiresAt: expect.any(Date),
      });
      expect(store.docs).toHaveLength(1);
      expect(store.docs[0]).toMatchObject({
        bookingType: 'hotel',
        stripePaymentIntentId: 'pi_1',
        amount: 24000,
        currency: 'USD',
        status: PaymentStatus.PENDING,
      });
      expect(String(store.docs[0].bookingId)).toBe(BOOKING);
    });

    it('a retry after a declined card reuses the same PaymentIntent and is Pending again', async () => {
      const { service, store } = setup();
      const first = await service.createPayment(HOTEL, BOOKING, USER);
      store.docs[0].status = PaymentStatus.FAILED;
      const second = await service.createPayment(HOTEL, BOOKING, USER);
      expect(second.paymentId).toBe(first.paymentId);
      expect(store.docs).toHaveLength(1);
      expect(store.docs[0].status).toBe(PaymentStatus.PENDING);
    });

    it('answers 409 if Stripe already cancelled the PaymentIntent', async () => {
      const { service, stripe } = setup();
      stripe.createIntent.mockResolvedValueOnce(intent({ status: 'canceled' }));
      await expect(service.createPayment(HOTEL, BOOKING, USER)).rejects.toThrow(
        new ConflictException(HOLD_EXPIRED),
      );
    });
  });

  describe('handleStripeEvent (PAY-01 webhook)', () => {
    async function paid() {
      const s = setup();
      await s.service.createPayment(HOTEL, BOOKING, USER);
      return s;
    }
    const succeeded = (over: Partial<StripeIntent> = {}) =>
      intent({ status: 'succeeded', amountReceived: 24000, ...over });

    it('payment_intent.succeeded: Succeeded, then the booking is confirmed', async () => {
      const { service, handler, store } = await paid();
      await service.handleStripeEvent('payment_intent.succeeded', succeeded());
      expect(store.docs[0].status).toBe(PaymentStatus.SUCCEEDED);
      expect(handler.confirm).toHaveBeenCalledWith(BOOKING);
    });

    it('the same event twice is harmless (the handler confirms once)', async () => {
      const { service, handler, store } = await paid();
      await service.handleStripeEvent('payment_intent.succeeded', succeeded());
      await service.handleStripeEvent('payment_intent.succeeded', succeeded());
      expect(store.docs[0].status).toBe(PaymentStatus.SUCCEEDED);
      expect(handler.confirm).toHaveBeenCalledTimes(2);
    });

    it('never confirms when Stripe received another amount or currency', async () => {
      const { service, handler, store } = await paid();
      await service.handleStripeEvent(
        'payment_intent.succeeded',
        succeeded({ amountReceived: 100 }),
      );
      await service.handleStripeEvent(
        'payment_intent.succeeded',
        succeeded({ currency: 'eur' }),
      );
      expect(handler.confirm).not.toHaveBeenCalled();
      expect(store.docs[0].status).toBe(PaymentStatus.PENDING);
    });

    it('ignores PaymentIntents that are not ours, and non-payment events', async () => {
      const { service, handler } = await paid();
      await service.handleStripeEvent(
        'payment_intent.succeeded',
        succeeded({ id: 'pi_other' }),
      );
      await service.handleStripeEvent('charge.updated', null);
      expect(handler.confirm).not.toHaveBeenCalled();
    });

    it('refunds in full when the booking can no longer be confirmed (409)', async () => {
      const { service, handler, stripe, refunds } = await paid();
      handler.confirm.mockRejectedValueOnce(
        new ConflictException(
          'A booking cannot change from Expired to Confirmed',
        ),
      );
      await service.handleStripeEvent('payment_intent.succeeded', succeeded());
      expect(stripe.createRefund).toHaveBeenCalledWith(
        'pi_1',
        24000,
        expect.objectContaining({ bookingType: 'hotel', bookingId: BOOKING }),
        expect.stringMatching(/^refund-/),
      );
      // Recorded like any refund (PAY-03), and only once.
      expect(refunds.docs).toHaveLength(1);
      expect(refunds.docs[0]).toMatchObject({
        amount: 24000,
        status: RefundStatus.REFUNDED,
      });
      handler.confirm.mockRejectedValueOnce(new ConflictException('Expired'));
      await service.handleStripeEvent('payment_intent.succeeded', succeeded());
      expect(stripe.createRefund).toHaveBeenCalledTimes(1);
    });

    it('lets other errors through, so Stripe sends the event again', async () => {
      const { service, handler, stripe } = await paid();
      handler.confirm.mockRejectedValueOnce(new Error('database down'));
      await expect(
        service.handleStripeEvent('payment_intent.succeeded', succeeded()),
      ).rejects.toThrow('database down');
      expect(stripe.createRefund).not.toHaveBeenCalled();
    });

    it('payment_failed marks it Failed; canceled marks it Expired', async () => {
      const { service, store, handler } = await paid();
      await service.handleStripeEvent(
        'payment_intent.payment_failed',
        intent(),
      );
      expect(store.docs[0].status).toBe(PaymentStatus.FAILED);
      await service.handleStripeEvent(
        'payment_intent.canceled',
        intent({ status: 'canceled' }),
      );
      expect(store.docs[0].status).toBe(PaymentStatus.EXPIRED);
      expect(handler.confirm).not.toHaveBeenCalled();
    });

    it('a late failure never undoes a success', async () => {
      const { service, store } = await paid();
      await service.handleStripeEvent('payment_intent.succeeded', succeeded());
      await service.handleStripeEvent(
        'payment_intent.payment_failed',
        intent(),
      );
      expect(store.docs[0].status).toBe(PaymentStatus.SUCCEEDED);
    });
  });

  describe('confirmBooking and releaseInventory', () => {
    it("call the type's handler; no payment means no Stripe call", async () => {
      const { service, handler, stripe } = setup();
      await service.confirmBooking(HOTEL, BOOKING);
      await service.releaseInventory(HOTEL, BOOKING);
      expect(handler.confirm).toHaveBeenCalledWith(BOOKING);
      expect(handler.expire).toHaveBeenCalledWith(BOOKING);
      expect(stripe.cancelIntent).not.toHaveBeenCalled();
    });

    it('cancels the PaymentIntent before expiring the booking', async () => {
      const { service, handler, stripe, store } = setup();
      await service.createPayment(HOTEL, BOOKING, USER);
      await service.releaseInventory(HOTEL, BOOKING);
      expect(stripe.cancelIntent).toHaveBeenCalledWith('pi_1');
      expect(store.docs[0].status).toBe(PaymentStatus.EXPIRED);
      expect(handler.expire).toHaveBeenCalledWith(BOOKING);
      expect(stripe.cancelIntent.mock.invocationCallOrder[0]).toBeLessThan(
        handler.expire.mock.invocationCallOrder[0],
      );
    });

    it('confirms instead when the payment succeeded just before the hold ended', async () => {
      const { service, handler, stripe, store } = setup();
      await service.createPayment(HOTEL, BOOKING, USER);
      stripe.cancelIntent.mockResolvedValueOnce('succeeded');
      await service.releaseInventory(HOTEL, BOOKING);
      expect(store.docs[0].status).toBe(PaymentStatus.SUCCEEDED);
      expect(handler.confirm).toHaveBeenCalledWith(BOOKING);
      expect(handler.expire).not.toHaveBeenCalled();
    });

    it('changes nothing while Stripe is processing or unreachable', async () => {
      const { service, handler, stripe, store } = setup();
      await service.createPayment(HOTEL, BOOKING, USER);
      stripe.cancelIntent.mockResolvedValueOnce('processing');
      await service.releaseInventory(HOTEL, BOOKING);
      stripe.cancelIntent.mockRejectedValueOnce(new Error('Stripe down'));
      await service.releaseInventory(HOTEL, BOOKING);
      expect(handler.expire).not.toHaveBeenCalled();
      expect(store.docs[0].status).toBe(PaymentStatus.PENDING);
    });
  });

  describe('refund (PAY-03)', () => {
    // A hotel booking paid 240.00 USD through Stripe.
    async function paidBooking() {
      const s = setup(payable({ description: 'Hotel TEST Nile View' }));
      await s.service.createPayment(HOTEL, BOOKING, USER);
      await s.service.handleStripeEvent(
        'payment_intent.succeeded',
        intent({ status: 'succeeded', amountReceived: 24000 }),
      );
      return s;
    }

    it('creates nothing for 0 cents', async () => {
      const { service, refunds, stripe } = await paidBooking();
      await expect(service.refund(HOTEL, BOOKING, 0)).resolves.toBe(null);
      expect(refunds.docs).toHaveLength(0);
      expect(stripe.createRefund).not.toHaveBeenCalled();
    });

    it('refuses an amount that is not whole cents', async () => {
      for (const amount of [-1, 10.5, NaN]) {
        await expect(
          setup().service.refund(HOTEL, BOOKING, amount),
        ).rejects.toThrow('whole cents');
      }
    });

    it('fails loudly for a type with no handler', async () => {
      await expect(setup().service.refund(FLIGHT, BOOKING, 0)).rejects.toThrow(
        'No payment handler',
      );
    });

    it('409 when the booking has no successful payment', async () => {
      await expect(
        setup().service.refund(HOTEL, BOOKING, 1000),
      ).rejects.toThrow(new ConflictException(NOTHING_TO_REFUND));
    });

    it('a 50% cancellation: Stripe refund, a Refunded record, a notification', async () => {
      const { service, stripe, refunds, notifications } = await paidBooking();
      const result = await service.refund(HOTEL, BOOKING, 12000);

      const record = refunds.docs[0];
      expect(result).toEqual({
        refundId: String(record._id),
        amount: 12000,
        currency: 'USD',
        status: RefundStatus.REFUNDED,
      });
      expect(stripe.createRefund).toHaveBeenCalledWith(
        'pi_1',
        12000,
        {
          refundId: String(record._id),
          bookingType: 'hotel',
          bookingId: BOOKING,
        },
        `refund-${String(record._id)}`,
      );
      expect(record).toMatchObject({
        bookingType: 'hotel',
        amount: 12000,
        currency: 'USD',
        status: RefundStatus.REFUNDED,
        stripeRefundId: 're_12000',
      });
      expect(String(record.userId)).toBe(USER);
      expect(notifications.create).toHaveBeenCalledWith(
        expect.anything(),
        NotificationType.REFUND_ISSUED,
        'A refund of 120.00 USD for your Hotel TEST Nile View has been issued',
        expect.objectContaining({ amount: 12000, status: 'Refunded' }),
      );
    });

    it('never refunds more than what is left of the payment', async () => {
      const { service } = await paidBooking();
      await service.refund(HOTEL, BOOKING, 20000);
      await expect(service.refund(HOTEL, BOOKING, 5000)).rejects.toThrow(
        'Only 4000 cents of this payment can still be refunded',
      );
      await expect(service.refund(HOTEL, BOOKING, 4000)).resolves.toMatchObject(
        { amount: 4000 },
      );
    });

    it('records a Stripe failure as Failed instead of throwing', async () => {
      const { service, stripe, refunds, notifications } = await paidBooking();
      stripe.createRefund.mockRejectedValueOnce(new Error('Stripe down'));
      await expect(
        service.refund(HOTEL, BOOKING, 12000),
      ).resolves.toMatchObject({ status: RefundStatus.FAILED });
      expect(refunds.docs[0]).toMatchObject({ status: RefundStatus.FAILED });
      expect(refunds.docs[0].stripeRefundId ?? null).toBeNull();
      expect(notifications.create).toHaveBeenLastCalledWith(
        expect.anything(),
        NotificationType.REFUND_ISSUED,
        expect.stringContaining('could not be completed'),
        expect.anything(),
      );
      // A failed refund gave nothing back, so the full amount is still left.
      await expect(
        service.refund(HOTEL, BOOKING, 24000),
      ).resolves.toMatchObject({ status: RefundStatus.REFUNDED });
    });

    it('the webhook moves Pending to Refunded, and Refunded to Failed if the bank rejects it', async () => {
      const { service, stripe, refunds, notifications } = await paidBooking();
      stripe.createRefund.mockResolvedValueOnce({
        id: 're_slow',
        status: 'pending',
        amount: 12000,
        metadata: {},
      });
      await service.refund(HOTEL, BOOKING, 12000);
      expect(refunds.docs[0].status).toBe(RefundStatus.PENDING);
      const refundId = String(refunds.docs[0]._id);
      const event = (status: string) => ({
        id: 're_slow',
        status,
        amount: 12000,
        metadata: { refundId },
      });

      await service.handleStripeEvent(
        'refund.updated',
        null,
        event('succeeded'),
      );
      expect(refunds.docs[0].status).toBe(RefundStatus.REFUNDED);
      // Never back to Pending.
      await service.handleStripeEvent('refund.updated', null, event('pending'));
      expect(refunds.docs[0].status).toBe(RefundStatus.REFUNDED);

      notifications.create.mockClear();
      await service.handleStripeEvent('refund.failed', null, event('failed'));
      expect(refunds.docs[0].status).toBe(RefundStatus.FAILED);
      expect(notifications.create).toHaveBeenCalledTimes(1);
      // A repeated failure event changes nothing and tells nobody twice.
      await service.handleStripeEvent('refund.failed', null, event('failed'));
      expect(notifications.create).toHaveBeenCalledTimes(1);
    });

    it("lists a booking's refunds and shows one only to its owner", async () => {
      const { service } = await paidBooking();
      const r = await service.refund(HOTEL, BOOKING, 12000);
      await expect(service.refundsFor(HOTEL, BOOKING)).resolves.toEqual([
        expect.objectContaining({
          _id: r!.refundId,
          amount: 12000,
          status: RefundStatus.REFUNDED,
        }),
      ]);
      const owner = { id: USER, role: 'user' } as any;
      await expect(
        service.getRefundFor(owner, r!.refundId),
      ).resolves.toMatchObject({ amount: 12000, bookingId: BOOKING });
      const other = { id: String(new Types.ObjectId()), role: 'user' } as any;
      await expect(service.getRefundFor(other, r!.refundId)).rejects.toThrow(
        new NotFoundException(REFUND_NOT_FOUND),
      );
      await expect(service.getRefundFor(owner, 'nope')).rejects.toThrow(
        new NotFoundException(REFUND_NOT_FOUND),
      );
    });
  });
});
