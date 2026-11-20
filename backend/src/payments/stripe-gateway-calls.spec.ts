import { BadGatewayException } from '@nestjs/common';
import * as StripeLib from 'stripe';
import { PROVIDER_ERROR, StripeGateway } from './stripe.gateway';

// PAY-01 / PAY-03: the calls to Stripe's API, with the Stripe client replaced
// by a fake. Covers the paths the webhook spec does not: idempotency keys,
// Stripe outages, a PaymentIntent that changes while it is being cancelled,
// and missing optional fields in Stripe's answers.
describe('StripeGateway API calls (PAY-01, PAY-03)', () => {
  const stripeError = (message = 'card declined') =>
    Object.assign(new Error(message), { type: 'StripeCardError' });

  function setup() {
    const client = {
      paymentIntents: {
        create: jest.fn(),
        retrieve: jest.fn(),
        cancel: jest.fn(),
      },
      refunds: { create: jest.fn() },
    };
    const gateway = new StripeGateway({
      get: (k: string) =>
        k === 'STRIPE_SECRET_KEY' ? 'sk_test_unit' : undefined,
    } as any);
    (gateway as any).client = client;
    return { gateway, client };
  }

  it('creates a PaymentIntent with the idempotency key and no redirect methods', async () => {
    const { gateway, client } = setup();
    client.paymentIntents.create.mockResolvedValue({
      id: 'pi_1',
      status: 'requires_payment_method',
      amount: 1500,
      amount_received: null,
      currency: 'usd',
      client_secret: null,
      metadata: null,
    });
    const intent = await gateway.createIntent(
      {
        amount: 1500,
        currency: 'usd',
        description: 'TEST',
        metadata: { bookingId: 'b1' },
      } as any,
      'booking-b1',
    );
    expect(client.paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 1500,
        currency: 'usd',
        automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      }),
      { idempotencyKey: 'booking-b1' },
    );
    // Missing optional fields become safe defaults.
    expect(intent).toEqual({
      id: 'pi_1',
      status: 'requires_payment_method',
      amount: 1500,
      amountReceived: 0,
      currency: 'usd',
      clientSecret: null,
      metadata: {},
    });
  });

  it('turns a Stripe error into 502 with a short message, never the details', async () => {
    const { gateway, client } = setup();
    client.paymentIntents.create.mockRejectedValue(
      stripeError('secret internal detail'),
    );
    const err = await gateway
      .createIntent({ amount: 1, currency: 'usd' } as any, 'k')
      .catch((e) => e);
    expect(err).toBeInstanceOf(BadGatewayException);
    expect(err.message).toBe(PROVIDER_ERROR);
    expect(err.message).not.toContain('secret internal detail');
  });

  it('rethrows a non-Stripe error unchanged', async () => {
    const { gateway, client } = setup();
    client.refunds.create.mockRejectedValue(new TypeError('bug'));
    await expect(
      gateway.createRefund('pi_1', 100, {}, 'refund-1'),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it('does not cancel a PaymentIntent that already succeeded', async () => {
    const { gateway, client } = setup();
    client.paymentIntents.retrieve.mockResolvedValue({ status: 'succeeded' });
    await expect(gateway.cancelIntent('pi_1')).resolves.toBe('succeeded');
    expect(client.paymentIntents.cancel).not.toHaveBeenCalled();
  });

  it.each([
    'requires_payment_method',
    'requires_confirmation',
    'requires_action',
    'requires_capture',
  ])('cancels a PaymentIntent in %s', async (status) => {
    const { gateway, client } = setup();
    client.paymentIntents.retrieve.mockResolvedValue({ status });
    client.paymentIntents.cancel.mockResolvedValue({ status: 'canceled' });
    await expect(gateway.cancelIntent('pi_1')).resolves.toBe('canceled');
  });

  it('reads the status again when the intent changed between the two calls', async () => {
    const { gateway, client } = setup();
    client.paymentIntents.retrieve
      .mockResolvedValueOnce({ status: 'requires_payment_method' })
      .mockResolvedValueOnce({ status: 'succeeded' });
    client.paymentIntents.cancel.mockRejectedValue(
      stripeError('cannot cancel'),
    );
    await expect(gateway.cancelIntent('pi_1')).resolves.toBe('succeeded');
    expect(client.paymentIntents.retrieve).toHaveBeenCalledTimes(2);
  });

  it('rethrows a non-Stripe error while cancelling', async () => {
    const { gateway, client } = setup();
    client.paymentIntents.retrieve.mockResolvedValue({
      status: 'requires_payment_method',
    });
    client.paymentIntents.cancel.mockRejectedValue(new RangeError('bug'));
    await expect(gateway.cancelIntent('pi_1')).rejects.toBeInstanceOf(
      RangeError,
    );
  });

  it('answers 502 when Stripe cannot be reached while cancelling', async () => {
    const { gateway, client } = setup();
    client.paymentIntents.retrieve.mockRejectedValue(
      Object.assign(new Error('offline'), { type: 'StripeConnectionError' }),
    );
    await expect(gateway.cancelIntent('pi_1')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('creates a refund with the idempotency key; a missing status is pending', async () => {
    const { gateway, client } = setup();
    client.refunds.create.mockResolvedValue({
      id: 're_1',
      status: null,
      amount: 700,
      metadata: null,
    });
    const r = await gateway.createRefund(
      'pi_1',
      700,
      { refundId: 'r1' },
      'refund-r1',
    );
    expect(client.refunds.create).toHaveBeenCalledWith(
      { payment_intent: 'pi_1', amount: 700, metadata: { refundId: 'r1' } },
      { idempotencyKey: 'refund-r1' },
    );
    expect(r).toEqual({
      id: 're_1',
      status: 'pending',
      amount: 700,
      metadata: {},
    });
  });

  it('builds the client once and reuses it', async () => {
    const gateway = new StripeGateway({
      get: () => 'sk_test_unit',
    } as any);
    const first = (gateway as any).stripe();
    expect(typeof first.paymentIntents.create).toBe('function');
    expect((gateway as any).stripe()).toBe(first);
  });

  describe('webhook events that are not about a PaymentIntent', () => {
    const SECRET = 'whsec_unit';
    const gateway = new StripeGateway({
      get: (k: string) => (k === 'STRIPE_WEBHOOK_SECRET' ? SECRET : undefined),
    } as any);
    const verify = (object: object) => {
      const payload = JSON.stringify({
        id: 'evt_x',
        object: 'event',
        type: 'refund.updated',
        data: { object },
      });
      const signature = StripeLib.webhooks.generateTestHeaderString({
        payload,
        secret: SECRET,
      });
      return gateway.verifyEvent(Buffer.from(payload), signature);
    };

    it('maps a refund event to a refund and no intent', () => {
      const e = verify({
        id: 're_9',
        object: 'refund',
        status: 'succeeded',
        amount: 300,
        metadata: { refundId: 'r9' },
      });
      expect(e.intent).toBeNull();
      expect(e.refund).toEqual({
        id: 're_9',
        status: 'succeeded',
        amount: 300,
        metadata: { refundId: 'r9' },
      });
    });

    it('maps any other object to neither', () => {
      const e = verify({ id: 'ch_1', object: 'charge' });
      expect([e.intent, e.refund]).toEqual([null, null]);
    });
  });
});
