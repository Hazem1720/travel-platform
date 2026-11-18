import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// stripe's types use `export =`; without esModuleInterop the namespace
// import compiles to require('stripe'), the constructor itself (as pdfkit
// in e-ticket.pdf.ts).
import * as StripeLib from 'stripe';

export const PAYMENTS_NOT_CONFIGURED =
  'Payments are not configured on this server (STRIPE_SECRET_KEY)';
export const WEBHOOK_NOT_CONFIGURED =
  'The Stripe webhook is not configured on this server (STRIPE_WEBHOOK_SECRET)';
export const INVALID_SIGNATURE = 'Invalid Stripe signature';
export const PROVIDER_ERROR =
  'The payment provider could not be reached; please try again';

type StripeClient = InstanceType<typeof StripeLib>;

// What PaymentsService needs from a PaymentIntent.
export interface StripeIntent {
  id: string;
  status: string;
  amount: number;
  amountReceived: number;
  currency: string;
  clientSecret: string | null;
  metadata: Record<string, string>;
}

export interface StripeEvent {
  id: string;
  type: string;
  intent: StripeIntent | null;
}

export interface CreateIntentParams {
  amount: number;
  // Lowercase, as Stripe expects ("usd").
  currency: string;
  description?: string;
  metadata: Record<string, string>;
}

// PAY-01: the only place that talks to Stripe, so tests replace this class
// with a plain object. Test mode only: env.validation.ts refuses anything but
// an sk_test_ (or rk_test_) key. The keys stay in backend/.env and never
// reach the frontend.
@Injectable()
export class StripeGateway {
  private readonly logger = new Logger(StripeGateway.name);
  private client: StripeClient | null = null;

  constructor(private readonly config: ConfigService) {}

  // A server without keys still starts; only paying answers 503.
  private stripe(): StripeClient {
    if (!this.client) {
      const key = this.config.get<string>('STRIPE_SECRET_KEY');
      if (!key) throw new ServiceUnavailableException(PAYMENTS_NOT_CONFIGURED);
      this.client = new StripeLib(key, { maxNetworkRetries: 2 });
    }
    return this.client;
  }

  // The same idempotency key always returns the same PaymentIntent, so a
  // retry or two clicks at once never create a second charge for a booking.
  async createIntent(
    params: CreateIntentParams,
    idempotencyKey: string,
  ): Promise<StripeIntent> {
    return this.call('create PaymentIntent', async () =>
      toIntent(
        await this.stripe().paymentIntents.create(
          {
            amount: params.amount,
            currency: params.currency,
            description: params.description,
            metadata: params.metadata,
            // Card payments in Stripe Elements; no redirect-based methods.
            automatic_payment_methods: {
              enabled: true,
              allow_redirects: 'never',
            },
          },
          { idempotencyKey },
        ),
      ),
    );
  }

  // Cancels the PaymentIntent if Stripe still allows it, and returns its
  // final status. "succeeded" means the money arrived first: the caller
  // must confirm the booking instead of expiring it.
  async cancelIntent(id: string): Promise<string> {
    return this.call('cancel PaymentIntent', async () => {
      const stripe = this.stripe();
      const current = await stripe.paymentIntents.retrieve(id);
      if (!CANCELABLE.has(current.status)) return current.status;
      try {
        return (await stripe.paymentIntents.cancel(id)).status;
      } catch (err) {
        // It changed between the two calls (for example it succeeded).
        if (isStripeError(err)) {
          return (await stripe.paymentIntents.retrieve(id)).status;
        }
        throw err;
      }
    });
  }

  // A full refund. Used only when a payment arrives for a booking that can
  // no longer be confirmed; PAY-03 adds partial refunds and their records.
  async refundIntent(id: string, idempotencyKey: string): Promise<string> {
    return this.call('refund PaymentIntent', async () => {
      const refund = await this.stripe().refunds.create(
        { payment_intent: id },
        { idempotencyKey },
      );
      return refund.id;
    });
  }

  // Checks the Stripe-Signature header against the raw request body with
  // STRIPE_WEBHOOK_SECRET. Anything that fails is a 400, so a forged
  // "payment succeeded" can never confirm a booking.
  verifyEvent(rawBody: Buffer | undefined, signature: unknown): StripeEvent {
    const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!secret) throw new ServiceUnavailableException(WEBHOOK_NOT_CONFIGURED);
    if (!rawBody || typeof signature !== 'string' || !signature) {
      throw new BadRequestException(INVALID_SIGNATURE);
    }
    let event: StripeLib.Event;
    try {
      // Verifying needs no API key, only the webhook secret.
      event = StripeLib.webhooks.constructEvent(rawBody, signature, secret);
    } catch {
      throw new BadRequestException(INVALID_SIGNATURE);
    }
    const object = event.data?.object as { object?: string } | undefined;
    return {
      id: event.id,
      type: event.type,
      intent:
        object?.object === 'payment_intent'
          ? toIntent(object as StripeLib.PaymentIntent)
          : null,
    };
  }

  // Stripe failures become 502 with a short message; the details go to the
  // log, never to the client.
  private async call<T>(what: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (isStripeError(err)) {
        this.logger.error(`Stripe could not ${what}: ${err.message}`);
        throw new BadGatewayException(PROVIDER_ERROR);
      }
      throw err;
    }
  }
}

const CANCELABLE = new Set([
  'requires_payment_method',
  'requires_confirmation',
  'requires_action',
  'requires_capture',
]);

// Errors from the Stripe library carry a type such as StripeCardError or
// StripeConnectionError.
function isStripeError(err: unknown): err is Error & { type: string } {
  if (!(err instanceof Error)) return false;
  const type = (err as unknown as { type?: unknown }).type;
  return typeof type === 'string' && type.startsWith('Stripe');
}

function toIntent(pi: StripeLib.PaymentIntent): StripeIntent {
  return {
    id: pi.id,
    status: pi.status,
    amount: pi.amount,
    amountReceived: pi.amount_received ?? 0,
    currency: pi.currency,
    clientSecret: pi.client_secret ?? null,
    metadata: (pi.metadata ?? {}) as Record<string, string>,
  };
}
