import { ConfigService } from '@nestjs/config';
import * as StripeLib from 'stripe';
import {
  CreateIntentParams,
  StripeGateway,
  StripeIntent,
  StripeRefund,
} from '../../src/payments/stripe.gateway';

// PAY-01: Stripe's API is replaced; the webhook check is not. This class
// overrides only the three calls that would reach Stripe. verifyEvent() is
// the real one, so every webhook in the tests goes through the real
// signature check with STRIPE_WEBHOOK_SECRET.
export class FakeStripeGateway extends StripeGateway {
  readonly calls: { method: string; args: unknown[] }[] = [];
  readonly intents = new Map<string, StripeIntent>();
  // Refund status the next createRefund() returns (Stripe answers
  // "succeeded" for most card refunds, "pending" for some).
  refundStatus = 'succeeded';
  private readonly byIntentKey = new Map<string, string>();
  private readonly refundsByKey = new Map<string, StripeRefund>();
  private n = 0;

  constructor(config: ConfigService) {
    super(config);
  }

  async createIntent(
    params: CreateIntentParams,
    idempotencyKey: string,
  ): Promise<StripeIntent> {
    this.calls.push({ method: 'createIntent', args: [params, idempotencyKey] });
    // Like Stripe: the same idempotency key returns the same PaymentIntent.
    const known = this.byIntentKey.get(idempotencyKey);
    if (known) return { ...this.intents.get(known)! };
    const id = `pi_e2e_${++this.n}`;
    const intent: StripeIntent = {
      id,
      status: 'requires_payment_method',
      amount: params.amount,
      amountReceived: 0,
      currency: params.currency,
      clientSecret: `${id}_secret_e2e`,
      metadata: { ...params.metadata },
    };
    this.intents.set(id, intent);
    this.byIntentKey.set(idempotencyKey, id);
    return { ...intent };
  }

  async cancelIntent(id: string): Promise<string> {
    this.calls.push({ method: 'cancelIntent', args: [id] });
    const intent = this.intents.get(id);
    if (!intent) return 'canceled';
    if (CANCELABLE.has(intent.status)) intent.status = 'canceled';
    return intent.status;
  }

  async createRefund(
    paymentIntentId: string,
    amount: number,
    metadata: Record<string, string>,
    idempotencyKey: string,
  ): Promise<StripeRefund> {
    this.calls.push({
      method: 'createRefund',
      args: [paymentIntentId, amount, metadata, idempotencyKey],
    });
    const known = this.refundsByKey.get(idempotencyKey);
    if (known) return { ...known };
    const refund: StripeRefund = {
      id: `re_e2e_${++this.n}`,
      status: this.refundStatus,
      amount,
      metadata: { ...metadata },
    };
    this.refundsByKey.set(idempotencyKey, refund);
    return { ...refund };
  }

  // The customer paid: the PaymentIntent succeeds for `amount` cents (the
  // full amount unless a test wants a mismatch).
  succeed(id: string, amount?: number): StripeIntent {
    const intent = this.mustGet(id);
    intent.status = 'succeeded';
    intent.amountReceived = amount ?? intent.amount;
    return { ...intent };
  }

  fail(id: string): StripeIntent {
    const intent = this.mustGet(id);
    intent.status = 'requires_payment_method';
    return { ...intent };
  }

  lastIntent(): StripeIntent | undefined {
    return [...this.intents.values()].pop();
  }

  private mustGet(id: string): StripeIntent {
    const intent = this.intents.get(id);
    if (!intent) throw new Error(`FakeStripeGateway: unknown intent ${id}`);
    return intent;
  }
}

const CANCELABLE = new Set([
  'requires_payment_method',
  'requires_confirmation',
  'requires_action',
  'requires_capture',
]);

// A Stripe event as Stripe would send it, for POST /api/payments/webhook.
export function paymentIntentEvent(type: string, intent: StripeIntent) {
  return {
    id: `evt_e2e_${intent.id}_${type}_${Date.now()}`,
    object: 'event',
    type,
    data: {
      object: {
        id: intent.id,
        object: 'payment_intent',
        status: intent.status,
        amount: intent.amount,
        amount_received: intent.amountReceived,
        currency: intent.currency,
        client_secret: intent.clientSecret,
        metadata: intent.metadata,
      },
    },
  };
}

export function refundEvent(type: string, refund: StripeRefund) {
  return {
    id: `evt_e2e_${refund.id}_${type}_${Date.now()}`,
    object: 'event',
    type,
    data: {
      object: {
        id: refund.id,
        object: 'refund',
        status: refund.status,
        amount: refund.amount,
        metadata: refund.metadata,
      },
    },
  };
}

// Signs an event with the test webhook secret, exactly as Stripe does, so
// the real verifyEvent() accepts it. Send `payload` as the raw body.
export function signedWebhook(
  event: object,
  secret = process.env.STRIPE_WEBHOOK_SECRET!,
): { payload: string; signature: string } {
  const payload = JSON.stringify(event);
  const signature = StripeLib.webhooks.generateTestHeaderString({
    payload,
    secret,
  });
  return { payload, signature };
}

// GEN-01-B: the emails the app would have sent.
export interface SentMail {
  to: string;
  subject: string;
  text: string;
}

export class Outbox {
  readonly messages: SentMail[] = [];

  // The fake SMTP transport, installed on EmailService by createTestApp.
  readonly transport = {
    sendMail: async (mail: SentMail) => {
      this.messages.push({
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
      });
      return { messageId: `e2e-${this.messages.length}` };
    },
  };

  to(email: string): SentMail[] {
    const e = email.toLowerCase();
    return this.messages.filter((m) => m.to.toLowerCase() === e);
  }

  // The links in the latest email to `email`, optionally only those whose
  // path contains `part` (for example "verify-email").
  links(email: string, part = ''): string[] {
    const last = this.to(email).pop();
    const urls: string[] = last?.text.match(/https?:\/\/\S+/g) ?? [];
    return urls.filter((u) => u.includes(part));
  }

  // The token=... of the latest matching link.
  token(email: string, part: string): string {
    const link = this.links(email, part).pop();
    const token = link && new URL(link).searchParams.get('token');
    if (!token) throw new Error(`Outbox: no ${part} link sent to ${email}`);
    return token;
  }
}
