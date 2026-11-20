// Milestone 1 test plan (the team's "Milestone 1 Test Plan" doc), Part 7 (payments &
// refunds), cases 7.1-7.14, with the harness's fake Stripe gateway and
// webhooks signed with the test secret. Every case runs even if an earlier
// one fails; the test then fails once with the full list (E2E_PLAN.md:
// table-driven tests, and a flow whose steps depend on each other is one it).
import * as request from 'supertest';
import { Types } from 'mongoose';
import { FlightBooking } from '../../src/flight-bookings/schemas/flight-booking.schema';
import { FlightBookingJobs } from '../../src/flight-bookings/flight-booking.jobs';
import { PaymentBookingType } from '../../src/payments/payment-handler';
import { PaymentsService } from '../../src/payments/payments.service';
import { StripeGateway } from '../../src/payments/stripe.gateway';
import { createTestApp, TestApp } from '../e2e/app';
import { Actor, traveler } from '../e2e/actors';
import { createAirline, createFlight, seedReference } from '../e2e/fixtures';
import { paymentIntentEvent, signedWebhook } from '../e2e/fakes';

type Res = request.Response;
const results: { id: string; ok: boolean | null; note: string }[] = [];
function check(cond: boolean, what: string, res?: Res) {
  if (!cond) {
    const got = res
      ? ` [got ${res.status} ${JSON.stringify(res.body).slice(0, 240)}]`
      : '';
    throw new Error(what + got);
  }
}
async function tc(id: string, fn: () => Promise<string | void>) {
  try {
    results.push({ id, ok: true, note: (await fn()) || '' });
  } catch (e) {
    results.push({ id, ok: false, note: (e as Error).message.slice(0, 500) });
  }
}
const PAX = [
  {
    type: 'adult',
    fullName: 'TEST Payer',
    dateOfBirth: '1990-01-01',
    passportNumber: 'A1234567',
  },
];

describe('Test plan Part 7: payments & refunds', () => {
  let t: TestApp;
  let U: Actor, V: Actor;
  let flightId = '';

  const send = (event: object, signature?: string) => {
    const signed = signedWebhook(event);
    return t
      .http()
      .post('/api/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature ?? signed.signature)
      .send(signed.payload);
  };
  const event = (type: string, intentId: string, how: 'succeed' | 'fail') =>
    paymentIntentEvent(
      type,
      how === 'succeed' ? t.stripe.succeed(intentId) : t.stripe.fail(intentId),
    );
  const hold = async (who: Actor) => {
    const h = await who.agent
      .post('/api/flight-bookings/hold')
      .send({ outboundFlightId: flightId, cabin: 'Economy', passengers: PAX });
    if (h.status !== 201)
      throw new Error(`hold ${h.status} ${JSON.stringify(h.body)}`);
    await who.agent
      .post(`/api/bookings/flight/${h.body._id}/accept-policies`)
      .send({ accepted: true })
      .expect(200);
    return String(h.body._id);
  };
  const doc = (id: string) =>
    t.model(FlightBooking.name).findById(id).lean<any>();
  const payments = (bookingId: string) =>
    t
      .model('Payment')
      .find({ bookingId: new Types.ObjectId(bookingId) })
      .lean<any[]>();

  beforeAll(async () => {
    t = await createTestApp('part7-payments');
    await seedReference(t);
    const airline = await createAirline(t, {
      cancellationTiers: [
        { daysBefore: 7, refundPercent: 100 },
        { daysBefore: 2, refundPercent: 50 },
      ],
    });
    flightId = String(
      (await createFlight(t, { airlineId: airline, seats: 20, price: 31250 }))
        ._id,
    );
    U = await traveler(t, 'TEST U');
    V = await traveler(t, 'TEST V');
  }, 90_000);

  afterAll(async () => {
    const pass = results.filter((r) => r.ok === true).length;
    const counted = results.filter((r) => r.ok !== null).length;
    console.log(
      `\nPART 7 RESULTS: ${pass}/${counted} passed\n` +
        results
          .map(
            (r) =>
              `${r.ok === null ? 'SKIP' : r.ok ? 'PASS' : 'FAIL'} ${r.id}${r.note ? '  ' + r.note : ''}`,
          )
          .join('\n'),
    );
    await t?.close();
  });

  it('runs cases 7.1-7.14 (PAY-01, PAY-03) [partial: PAY-02, PAY-04]', async () => {
    let B = '';
    await tc('7.1', async () => {
      const h = await U.agent.post('/api/flight-bookings/hold').send({
        outboundFlightId: flightId,
        cabin: 'Economy',
        passengers: PAX,
      });
      B = h.body._id;
      const p = await U.agent.get(`/api/bookings/flight/${B}/policies`);
      check(p.status === 200, 'policies 200', p);
      const s = JSON.stringify(p.body);
      check(
        s.includes('"refundPercent":100') && s.includes('"refundPercent":50'),
        "the airline's tiers",
        p,
      );
      const pay = await U.agent.post(`/api/bookings/flight/${B}/pay`);
      check(pay.status === 400, 'paying before accepting -> 400', pay);
      const acc = await U.agent
        .post(`/api/bookings/flight/${B}/accept-policies`)
        .send({ accepted: true });
      check(acc.status === 200, 'accept 200', acc);
      const stored = await doc(B);
      check(
        !!stored.policiesAcceptedAt,
        'acceptance stored with its time (PAY-02)',
      );
    });

    let P = '';
    await tc('7.2', async () => {
      const r = await U.agent
        .post('/api/payments')
        .send({ bookingType: 'flight', bookingId: B });
      check(
        r.status === 201 && !!r.body.clientSecret,
        '201 with client secret',
        r,
      );
      P = r.body.paymentId;
      const intent = t.stripe.lastIntent()!;
      check(
        intent.amount === 31250 && intent.currency.toLowerCase() === 'usd',
        `intent 31250 USD (got ${intent.amount} ${intent.currency})`,
      );
      const again = await U.agent
        .post('/api/payments')
        .send({ bookingType: 'flight', bookingId: B });
      check(
        again.status === 201 && t.stripe.intents.size === 1,
        'asking again reuses the same intent (no double charge)',
        again,
      );
    });

    await tc('7.3', async () => {
      const other = await V.agent
        .post('/api/payments')
        .send({ bookingType: 'flight', bookingId: B });
      check(other.status === 404, "paying another user's booking 404", other);
      const bad = await U.agent
        .post('/api/payments')
        .send({ bookingType: 'train', bookingId: B });
      check(bad.status === 400, 'unknown booking type 400', bad);
      const e = await hold(V);
      await t
        .model(FlightBooking.name)
        .updateOne(
          { _id: e },
          { $set: { expiresAt: new Date(Date.now() - 1000) } },
        );
      const expired = await V.agent
        .post('/api/payments')
        .send({ bookingType: 'flight', bookingId: e });
      check(expired.status === 409, 'expired hold 409', expired);
    });

    await tc('7.5', async () => {
      const intent = t.stripe.lastIntent()!;
      const r = await send(
        event('payment_intent.payment_failed', intent.id, 'fail'),
      );
      check(r.status === 200, 'webhook 200', r);
      const p = await U.agent.get(`/api/payments/${P}`);
      check(
        p.body.status === 'Failed',
        `payment Failed (got ${p.body.status})`,
        p,
      );
      check(
        (await doc(B)).status === 'PendingPayment',
        'booking still PendingPayment',
      );
    });

    await tc('7.6', async () => {
      const r = await U.agent.post(`/api/payments/${P}/retry`);
      check(
        r.status === 200 && !!r.body.clientSecret,
        'retry 200 with a client secret',
        r,
      );
      const other = await V.agent.post(`/api/payments/${P}/retry`);
      check(other.status === 404, "another user's payment 404", other);
      P = r.body.paymentId ?? P;
    });

    const mailsBefore = () => t.outbox.to(U.email).length;
    let m0 = 0;
    await tc('7.4', async () => {
      m0 = mailsBefore();
      const intent = t.stripe.lastIntent()!;
      const ev = event('payment_intent.succeeded', intent.id, 'succeed');
      const r = await send(ev);
      check(r.status === 200, 'webhook 200', r);
      check((await doc(B)).status === 'Confirmed', 'booking Confirmed');
      const p = await U.agent.get(`/api/payments/${P}`);
      check(
        p.body.status === 'Succeeded',
        `payment Succeeded (got ${p.body.status})`,
        p,
      );
      (global as any).__ev = ev;
    });

    await tc('7.9', async () => {
      const ev = (global as any).__ev;
      const r = await send(ev);
      check(r.status === 200, 'repeat 200', r);
      const r2 = await send({ ...ev, id: ev.id + '_again' });
      check(r2.status === 200, 'same intent, new event id 200', r2);
      check(
        mailsBefore() === m0 + 1,
        `one confirmation email only (got ${mailsBefore() - m0})`,
      );
      const ok = (await payments(B)).filter((x) => x.status === 'Succeeded');
      check(ok.length === 1, 'one Succeeded payment');
      const retry = await U.agent.post(`/api/payments/${P}/retry`);
      check(retry.status === 409, 'retry after success 409', retry);
      const pay = await U.agent
        .post('/api/payments')
        .send({ bookingType: 'flight', bookingId: B });
      check(pay.status === 409, 'paying a Confirmed booking 409', pay);
    });

    await tc('7.7', async () => {
      const own = await U.agent.get(`/api/payments/${P}`);
      check(
        own.status === 200 &&
          own.body.amount === 31250 &&
          own.body.currency === 'USD',
        'own payment 200, 31250 USD',
        own,
      );
      const other = await V.agent.get(`/api/payments/${P}`);
      check(other.status === 404, 'another user 404', other);
      const anon = await t.http().get(`/api/payments/${P}`);
      check(anon.status === 401, 'no session 401', anon);
    });

    await tc('7.8', async () => {
      const b2 = await hold(V);
      await V.agent
        .post('/api/payments')
        .send({ bookingType: 'flight', bookingId: b2 })
        .expect(201);
      // Built without touching the fake gateway: the intent stays unpaid.
      const intent = t.stripe.lastIntent()!;
      const ev = paymentIntentEvent('payment_intent.succeeded', {
        ...intent,
        status: 'succeeded',
        amountReceived: intent.amount,
      });
      const forged = await send(ev, 't=1,v1=deadbeef');
      check(forged.status === 400, 'bad signature 400', forged);
      const none = await t
        .http()
        .post('/api/payments/webhook')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify(ev));
      check(none.status === 400, 'no signature 400', none);
      check((await doc(b2)).status === 'PendingPayment', 'nothing changed');
      (global as any).__b2 = b2;
      (global as any).__pi2 = intent.id;
    });

    await tc('7.10', async () => {
      const b2 = (global as any).__b2 as string;
      await t
        .model(FlightBooking.name)
        .updateOne(
          { _id: b2 },
          { $set: { expiresAt: new Date(Date.now() - 1000) } },
        );
      await t.app.get(FlightBookingJobs).expireHolds();
      check((await doc(b2)).status === 'Expired', 'hold Expired');
      const refundsBefore = t.stripe.calls.filter(
        (c) => c.method === 'createRefund',
      ).length;
      // The card is paid only now, after the hold has expired.
      const r = await send(
        event('payment_intent.succeeded', (global as any).__pi2, 'succeed'),
      );
      check(r.status === 200, 'late success webhook 200', r);
      check((await doc(b2)).status === 'Expired', 'booking stays Expired');
      const refunds = t.stripe.calls.filter((c) => c.method === 'createRefund');
      check(
        refunds.length === refundsBefore + 1 &&
          refunds[refunds.length - 1].args[1] === 31250,
        'the late payment is refunded in full',
      );
    });

    await tc('7.11', async () => {
      const q = await U.agent.get(`/api/flight-bookings/${B}/cancellation`);
      const c = await U.agent
        .post(`/api/flight-bookings/${B}/cancel`)
        .send({ refundAmount: q.body.refundAmount });
      check(
        c.status === 200 && c.body.refund?.amount === 31250,
        'refund equals the shown amount',
        c,
      );
      check(
        ['Pending', 'Refunded'].includes(c.body.refund.status),
        `refund status shown (${c.body.refund.status})`,
        c,
      );
      const last = t.stripe.calls
        .filter((x) => x.method === 'createRefund')
        .pop()!;
      check(last.args[1] === 31250, 'Stripe refund for the same amount');
      const rid =
        c.body.refund.refundId ?? c.body.refund._id ?? c.body.refund.id;
      if (rid) {
        const own = await U.agent.get(`/api/refunds/${rid}`);
        check(own.status === 200, 'refund details 200', own);
        const other = await V.agent.get(`/api/refunds/${rid}`);
        check(other.status === 404, "another user's refund 404", other);
      }
      check(
        /refund/i.test(
          JSON.stringify((await U.agent.get('/api/notifications')).body),
        ),
        'refund notification',
      );
    });

    await tc('7.12', async () => {
      let refused = false;
      try {
        await t.app
          .get(PaymentsService)
          .refund(PaymentBookingType.FLIGHT, B, 1);
      } catch (e) {
        refused = (e as any).status === 409;
      }
      check(
        refused,
        'a refund above what is left (0 after the full refund) -> 409',
      );
      const zero = await (async () => {
        const b = await hold(U);
        await U.agent
          .post('/api/payments')
          .send({ bookingType: 'flight', bookingId: b });
        await send(
          event(
            'payment_intent.succeeded',
            t.stripe.lastIntent()!.id,
            'succeed',
          ),
        );
        await t.model(FlightBooking.name).updateOne(
          { _id: b },
          {
            $set: {
              'segments.0.departureAt': new Date(Date.now() + 86_400_000),
            },
          },
        );
        const q = await U.agent.get(`/api/flight-bookings/${b}/cancellation`);
        const n = t.stripe.calls.filter(
          (x) => x.method === 'createRefund',
        ).length;
        const c = await U.agent
          .post(`/api/flight-bookings/${b}/cancel`)
          .send({ refundAmount: q.body.refundAmount });
        return {
          q: q.body,
          c,
          made:
            t.stripe.calls.filter((x) => x.method === 'createRefund').length -
            n,
        };
      })();
      check(
        zero.q.refundAmount === 0 &&
          zero.c.status === 200 &&
          zero.c.body.refund === null &&
          zero.made === 0,
        '0% tier: cancelled, no Stripe refund (PAY-03)',
        zero.c,
      );
    });

    await tc('7.13', async () => {
      const all = await t.model('Payment').find({}).lean<any[]>();
      const refunds = await t.model('Refund').find({}).lean<any[]>();
      const bookings = await t.model(FlightBooking.name).find({}).lean<any[]>();
      const nums = [
        ...all.map((x) => x.amount),
        ...refunds.map((x) => x.amount),
        ...bookings.map((x) => x.totalAmount),
      ];
      check(
        nums.every((n) => Number.isInteger(n)),
        'every amount is integer cents',
      );
      check(
        [...all, ...refunds, ...bookings].every(
          (x) => (x.currency ?? 'USD') === 'USD',
        ),
        'one currency: USD (PAY-04)',
      );
      check(
        [...t.stripe.intents.values()].every(
          (i) => i.currency.toLowerCase() === 'usd',
        ),
        'Stripe charged in USD',
      );
      return `${all.length} payments, ${refunds.length} refunds checked`;
    });

    await tc('7.14', async () => {
      // The real gateway, with a config that has no Stripe keys, swapped in
      // for this case only (the harness otherwise always uses the fake).
      const ps = t.app.get(PaymentsService) as any;
      const fake = ps.stripe;
      ps.stripe = new StripeGateway({ get: () => undefined } as any);
      try {
        const b = await hold(U);
        const r = await U.agent
          .post('/api/payments')
          .send({ bookingType: 'flight', bookingId: b });
        check(r.status === 503, 'paying without STRIPE_SECRET_KEY -> 503', r);
        check(
          /STRIPE_SECRET_KEY|not configured/i.test(r.body.message),
          'clear message',
          r,
        );
        check((await doc(b)).status === 'PendingPayment', 'booking unchanged');
        const pol = await U.agent.get(`/api/bookings/flight/${b}/policies`);
        check(pol.status === 200, 'the rest of the API keeps working', pol);
        return `message: "${r.body.message}"`;
      } finally {
        ps.stripe = fake;
      }
    });

    expect(results.filter((r) => r.ok === false).map((r) => r.id)).toEqual([]);
  }, 240_000);
});
