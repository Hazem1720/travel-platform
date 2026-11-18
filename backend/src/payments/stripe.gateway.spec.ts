import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as StripeLib from 'stripe';
import { validateEnv } from '../config/env.validation';
import {
  INVALID_SIGNATURE,
  PAYMENTS_NOT_CONFIGURED,
  StripeGateway,
  WEBHOOK_NOT_CONFIGURED,
} from './stripe.gateway';

// PAY-01: the webhook signature check and the test-mode-only keys. No
// network: signatures are made locally with Stripe's own test helper.
describe('StripeGateway (PAY-01)', () => {
  const SECRET = 'whsec_test_secret_for_unit_tests';
  const gateway = (env: Record<string, string | undefined>) =>
    new StripeGateway({ get: (k: string) => env[k] } as any);

  const event = {
    id: 'evt_1',
    object: 'event',
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: 'pi_1',
        object: 'payment_intent',
        status: 'succeeded',
        amount: 42000,
        amount_received: 42000,
        currency: 'usd',
        client_secret: 'pi_1_secret_x',
        metadata: { bookingType: 'flight', bookingId: 'b1' },
      },
    },
  };
  const payload = JSON.stringify(event);
  const sign = (body: string, secret = SECRET) =>
    StripeLib.webhooks.generateTestHeaderString({ payload: body, secret });

  it('accepts an event signed with STRIPE_WEBHOOK_SECRET', () => {
    const verified = gateway({ STRIPE_WEBHOOK_SECRET: SECRET }).verifyEvent(
      Buffer.from(payload),
      sign(payload),
    );
    expect(verified).toEqual({
      id: 'evt_1',
      type: 'payment_intent.succeeded',
      intent: {
        id: 'pi_1',
        status: 'succeeded',
        amount: 42000,
        amountReceived: 42000,
        currency: 'usd',
        clientSecret: 'pi_1_secret_x',
        metadata: { bookingType: 'flight', bookingId: 'b1' },
      },
    });
  });

  it('refuses a forged, changed or unsigned event with 400', () => {
    const g = gateway({ STRIPE_WEBHOOK_SECRET: SECRET });
    const changed = payload.replace('42000', '1');
    const cases: [Buffer | undefined, unknown][] = [
      [Buffer.from(payload), sign(payload, 'whsec_someone_else')],
      [Buffer.from(changed), sign(payload)],
      [Buffer.from(payload), undefined],
      [Buffer.from(payload), 't=1,v1=abc'],
      [undefined, sign(payload)],
    ];
    for (const [body, signature] of cases) {
      expect(() => g.verifyEvent(body, signature)).toThrow(
        new BadRequestException(INVALID_SIGNATURE),
      );
    }
  });

  it('answers 503 without the webhook secret or the API key', async () => {
    expect(() =>
      gateway({}).verifyEvent(Buffer.from(payload), sign(payload)),
    ).toThrow(new ServiceUnavailableException(WEBHOOK_NOT_CONFIGURED));
    await expect(
      gateway({}).createIntent(
        { amount: 100, currency: 'usd', metadata: {} },
        'k',
      ),
    ).rejects.toThrow(new ServiceUnavailableException(PAYMENTS_NOT_CONFIGURED));
  });

  it('non-PaymentIntent events carry no intent', () => {
    const other = JSON.stringify({
      ...event,
      type: 'charge.updated',
      data: { object: { id: 'ch_1', object: 'charge' } },
    });
    expect(
      gateway({ STRIPE_WEBHOOK_SECRET: SECRET }).verifyEvent(
        Buffer.from(other),
        sign(other),
      ).intent,
    ).toBeNull();
  });

  describe('startup checks (env.validation.ts)', () => {
    const base = {
      MONGODB_URI: 'mongodb://localhost/test',
      JWT_SECRET: 'x'.repeat(32),
      FRONTEND_URL: 'http://localhost:3001',
    };

    it('accepts test keys, or none at all', () => {
      expect(() => validateEnv(base)).not.toThrow();
      expect(() =>
        validateEnv({
          ...base,
          STRIPE_SECRET_KEY: 'sk_test_abc',
          STRIPE_WEBHOOK_SECRET: 'whsec_abc',
        }),
      ).not.toThrow();
    });

    it('refuses a live key and a malformed webhook secret', () => {
      expect(() =>
        validateEnv({ ...base, STRIPE_SECRET_KEY: 'sk_live_abc' }),
      ).toThrow('live keys are not allowed');
      expect(() =>
        validateEnv({ ...base, STRIPE_WEBHOOK_SECRET: 'abc' }),
      ).toThrow('STRIPE_WEBHOOK_SECRET must start with whsec_');
    });
  });
});
