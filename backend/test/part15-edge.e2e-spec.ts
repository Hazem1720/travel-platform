// TEMPORARY (test branch only): Milestone 1 test plan, Part 15 (edge cases
// no earlier part covers): races on seats, payments and cancellations, a
// payment Stripe took just before the hold ended, sessions after logout,
// password change, idle time and a tampered cookie, and pages past the end.
import * as request from 'supertest';
import { Types } from 'mongoose';
import { FlightBooking } from '../src/flight-bookings/schemas/flight-booking.schema';
import { FlightBookingJobs } from '../src/flight-bookings/flight-booking.jobs';
import { createTestApp, TestApp } from './e2e/app';
import { Actor, TEST_PASSWORD, traveler } from './e2e/actors';
import { createAirline, createFlight, seedReference } from './e2e/fixtures';
import { paymentIntentEvent, signedWebhook } from './e2e/fakes';

type Res = request.Response;
const results: { id: string; ok: boolean; note: string }[] = [];
function check(cond: boolean, what: string, res?: Res) {
  if (!cond) {
    const got = res ? ` [got ${res.status} ${JSON.stringify(res.body).slice(0, 240)}]` : '';
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
const PAX = [{ type: 'adult', fullName: 'TEST Edge', dateOfBirth: '1990-01-01', passportNumber: 'A1234567' }];
const cookieOf = (res: Res, name: string) =>
  ((res.headers['set-cookie'] as unknown as string[]) ?? []).map((c) => c.split(';')[0]).find((c) => c.startsWith(name + '='));

describe('Test plan Part 15: edge cases', () => {
  let t: TestApp;
  let airline: any;

  const send = (event: object) => {
    const signed = signedWebhook(event);
    return t.http().post('/api/payments/webhook').set('Content-Type', 'application/json').set('stripe-signature', signed.signature).send(signed.payload);
  };
  const doc = (id: string) => t.model(FlightBooking.name).findById(id).lean<any>();
  const refundsMade = () => t.stripe.calls.filter((c) => c.method === 'createRefund').length;
  async function newFlight(seats: number, day = 30) {
    return String((await createFlight(t, { airlineId: airline, seats, price: 20000, day } as any))._id);
  }
  async function holdOn(who: Actor, flightId: string) {
    return who.agent.post('/api/flight-bookings/hold').send({ outboundFlightId: flightId, cabin: 'Economy', passengers: PAX });
  }
  async function confirmed(who: Actor, flightId: string) {
    const h = await holdOn(who, flightId);
    if (h.status !== 201) throw new Error(`hold ${h.status} ${JSON.stringify(h.body)}`);
    const id = String(h.body._id);
    await who.agent.post(`/api/bookings/flight/${id}/accept-policies`).send({ accepted: true }).expect(200);
    await who.agent.post(`/api/bookings/flight/${id}/pay`).expect(201);
    await send(paymentIntentEvent('payment_intent.succeeded', t.stripe.succeed(t.stripe.lastIntent()!.id))).expect(200);
    if ((await doc(id)).status !== 'Confirmed') throw new Error('setup: booking not Confirmed');
    return id;
  }

  beforeAll(async () => {
    t = await createTestApp('part15-edge');
    await seedReference(t);
    airline = await createAirline(t, { cancellationTiers: [{ daysBefore: 0, refundPercent: 100 }] });
  }, 90_000);

  afterAll(async () => {
    const pass = results.filter((r) => r.ok).length;
    console.log(`\nPART 15 RESULTS: ${pass}/${results.length} passed\n` + results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.id}${r.note ? '  ' + r.note : ''}`).join('\n'));
    await t?.close();
  });

  it('runs cases 15.1-15.12', async () => {
    await tc('15.1 ten users hold the last 3 seats at the same moment', async () => {
      const f = await newFlight(3);
      const users: Actor[] = [];
      for (let i = 0; i < 10; i++) users.push(await traveler(t, `TEST Racer ${i}`));
      let res: Res[];
      try {
        res = await Promise.all(users.map((u) => holdOn(u, f)));
      } catch (e) {
        throw new Error('during the 10 simultaneous holds: ' + (e as Error).message);
      }
      const won = res.filter((r) => r.status === 201).length;
      const codes = [...new Set(res.filter((r) => r.status !== 201).map((r) => r.status))];
      check(won === 3, `exactly 3 holds (got ${won})`);
      check(res.every((r) => r.status < 500), 'no 5xx');
      const fl = await t.model('Flight').findById(f).lean<any>();
      const left = fl.cabins.reduce((s: number, c: any) => s + c.totalSeats - (c.bookedSeats ?? 0) - (c.heldSeats ?? 0), 0);
      check(left === 0, `0 seats left (got ${left})`);
      return `others answered ${codes.join(',')}`;
    });

    await tc('15.2 double-click on Pay (two requests at once) makes one PaymentIntent', async () => {
      const u = await traveler(t, 'TEST Double Pay');
      const f = await newFlight(5);
      const h = await holdOn(u, f);
      await u.agent.post(`/api/bookings/flight/${h.body._id}/accept-policies`).send({ accepted: true }).expect(200);
      const before = t.stripe.intents.size;
      const [a, b] = await Promise.all([u.agent.post(`/api/bookings/flight/${h.body._id}/pay`), u.agent.post(`/api/bookings/flight/${h.body._id}/pay`)]);
      check(a.status < 500 && b.status < 500, `no 5xx (${a.status}, ${b.status})`);
      check([a, b].some((r) => r.status === 201), 'one of them 201');
      check(t.stripe.intents.size - before === 1, `one PaymentIntent (got ${t.stripe.intents.size - before})`);
      const pays = await t.model('Payment').find({ bookingId: new Types.ObjectId(h.body._id) }).lean<any[]>();
      check(pays.length === 1, `one Payment record (got ${pays.length})`);
    });

    await tc('15.3 two cancel requests at the same moment refund once', async () => {
      const u = await traveler(t, 'TEST Double Cancel');
      const id = await confirmed(u, await newFlight(5));
      const q = await u.agent.get(`/api/flight-bookings/${id}/cancellation`).expect(200);
      const n = refundsMade();
      const res = await Promise.all([1, 2].map(() => u.agent.post(`/api/flight-bookings/${id}/cancel`).send({ refundAmount: q.body.refundAmount })));
      check(res.every((r) => r.status < 500), `no 5xx (${res.map((r) => r.status)})`);
      check(res.filter((r) => r.status === 200).length === 1, `exactly one 200 (${res.map((r) => r.status)})`);
      check(refundsMade() - n === 1, `one Stripe refund (got ${refundsMade() - n})`);
      const refunds = await t.model('Refund').find({ bookingId: new Types.ObjectId(id) }).lean<any[]>();
      check(refunds.length === 1, `one Refund record (got ${refunds.length})`);
      return `answers ${res.map((r) => r.status).join(', ')}`;
    });

    await tc('15.4 cancelling an already cancelled booking is refused and refunds nothing', async () => {
      const u = await traveler(t, 'TEST Cancel Twice');
      const id = await confirmed(u, await newFlight(5));
      const q = await u.agent.get(`/api/flight-bookings/${id}/cancellation`).expect(200);
      await u.agent.post(`/api/flight-bookings/${id}/cancel`).send({ refundAmount: q.body.refundAmount }).expect(200);
      const n = refundsMade();
      const again = await u.agent.post(`/api/flight-bookings/${id}/cancel`).send({ refundAmount: q.body.refundAmount });
      check(again.status === 409 || again.status === 400, 'second cancel 409/400', again);
      check(refundsMade() === n, 'no second refund');
    });

    await tc('15.5 a payment Stripe took just before the hold ended confirms the booking', async () => {
      const u = await traveler(t, 'TEST Late Payer');
      const h = await holdOn(u, await newFlight(5));
      const id = String(h.body._id);
      await u.agent.post(`/api/bookings/flight/${id}/accept-policies`).send({ accepted: true }).expect(200);
      await u.agent.post(`/api/bookings/flight/${id}/pay`).expect(201);
      t.stripe.succeed(t.stripe.lastIntent()!.id); // paid at Stripe; webhook not delivered (e.g. wrong secret)
      await t.model(FlightBooking.name).updateOne({ _id: id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
      const n = refundsMade();
      await t.app.get(FlightBookingJobs).expireHolds();
      check((await doc(id)).status === 'Confirmed', `booking Confirmed, not Expired (got ${(await doc(id)).status})`);
      check(refundsMade() === n, 'nothing refunded');
      const p = await t.model('Payment').findOne({ bookingId: new Types.ObjectId(id) }).lean<any>();
      check(p.status === 'Succeeded', `payment Succeeded (got ${p.status})`);
    });

    await tc('15.6 a webhook for a PaymentIntent we never made is acknowledged and ignored', async () => {
      const r = await send(paymentIntentEvent('payment_intent.succeeded', { id: 'pi_not_ours_123', status: 'succeeded', amount: 100, amountReceived: 100, currency: 'usd', metadata: {} } as any));
      check(r.status >= 200 && r.status < 300, 'answers 2xx so Stripe stops retrying', r);
    });

    await tc('15.7 a tampered session cookie is refused', async () => {
      const u = await traveler(t, 'TEST Tamper');
      const login = await t.http().post('/api/auth/login').send({ email: u.email, password: TEST_PASSWORD }).expect(200);
      const c = cookieOf(login, 'access_token')!;
      check(!!c, 'login sets access_token');
      const [name, value] = [c.slice(0, c.indexOf('=')), c.slice(c.indexOf('=') + 1)];
      const parts = value.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
      payload.role = 'admin';
      const forged = [parts[0], Buffer.from(JSON.stringify(payload)).toString('base64url'), parts[2]].join('.');
      const r1 = await t.http().get('/api/auth/me').set('Cookie', `${name}=${forged}`);
      check(r1.status === 401, 'changed payload 401', r1);
      const r2 = await t.http().get('/api/admin/accounts').set('Cookie', `${name}=${forged}`);
      check(r2.status === 401, 'no admin access with it', r2);
      const r3 = await t.http().get('/api/auth/me').set('Cookie', `${name}=garbage`);
      check(r3.status === 401, 'garbage cookie 401', r3);
    });

    await tc('15.8 after logout, the old cookies no longer work (access and refresh)', async () => {
      const u = await traveler(t, 'TEST Logout');
      const login = await t.http().post('/api/auth/login').send({ email: u.email, password: TEST_PASSWORD }).expect(200);
      const access = cookieOf(login, 'access_token')!, refresh = cookieOf(login, 'refresh_token')!;
      await t.http().get('/api/auth/me').set('Cookie', access).expect(200);
      await t.http().post('/api/auth/logout').set('Cookie', `${access}; ${refresh}`).expect((r) => { if (r.status >= 300) throw new Error('logout ' + r.status); });
      const me = await t.http().get('/api/auth/me').set('Cookie', access);
      check(me.status === 401, 'old access cookie 401', me);
      const rf = await t.http().post('/api/auth/refresh').set('Cookie', refresh);
      check(rf.status === 401, 'old refresh cookie 401', rf);
    });

    await tc('15.9 changing the password signs out other sessions but keeps this one', async () => {
      const u = await traveler(t, 'TEST Two Devices');
      const phone = request.agent(t.server);
      await phone.post('/api/auth/login').send({ email: u.email, password: TEST_PASSWORD }).expect(200);
      await phone.get('/api/auth/me').expect(200);
      await u.agent.patch('/api/auth/change-password').send({ currentPassword: TEST_PASSWORD, newPassword: 'Passw0rd9' }).expect(200);
      const here = await u.agent.get('/api/auth/me');
      check(here.status === 200, 'this session still works', here);
      const other = await phone.get('/api/auth/me');
      check(other.status === 401, 'the other device is signed out', other);
      const oldPw = await t.http().post('/api/auth/login').send({ email: u.email, password: TEST_PASSWORD });
      check(oldPw.status === 401, 'old password refused', oldPw);
    });

    await tc('15.10 a session idle for over 30 minutes ends', async () => {
      const u = await traveler(t, 'TEST Idle');
      await u.agent.get('/api/auth/me').expect(200);
      await t.model('User').updateOne({ _id: u.id }, { $set: { lastActivityAt: new Date(Date.now() - 31 * 60_000) } });
      const r = await u.agent.get('/api/auth/me');
      check(r.status === 401, 'idle session 401', r);
      const rf = await u.agent.post('/api/auth/refresh');
      check(rf.status === 401, 'refresh refused too', rf);
      const again = await t.http().post('/api/auth/login').send({ email: u.email, password: TEST_PASSWORD });
      check(again.status === 200, 'logging in again works', again);
    });

    await tc('15.11 asking for a page past the last one', async () => {
      const u = await traveler(t, 'TEST Pages');
      for (let i = 0; i < 12; i++) await u.agent.post('/api/itineraries').send({ title: `TEST page ${i}`, countries: ['EG'], startDate: '2099-12-10' }).expect(201);
      const p1 = await u.agent.get('/api/itineraries?page=1');
      check(p1.status === 200 && p1.body.data.length === 10 && p1.body.meta.total === 12 && p1.body.meta.totalPages === 2, 'page 1: 10 of 12, 2 pages', p1);
      const p2 = await u.agent.get('/api/itineraries?page=2');
      check(p2.body.data.length === 2, 'page 2: the last 2', p2);
      const ids = new Set([...p1.body.data, ...p2.body.data].map((x: any) => x._id));
      check(ids.size === 12, 'no item twice and none missing across pages');
      const p9 = await u.agent.get('/api/itineraries?page=9');
      check(p9.status === 200 && p9.body.data.length === 0 && p9.body.meta.total === 12, 'page 9: 200, empty, total still 12', p9);
    });

    await tc('15.12 a booking already Confirmed cannot be held again or paid twice by a race of webhooks', async () => {
      const u = await traveler(t, 'TEST Webhook Race');
      const h = await holdOn(u, await newFlight(5));
      const id = String(h.body._id);
      await u.agent.post(`/api/bookings/flight/${id}/accept-policies`).send({ accepted: true }).expect(200);
      await u.agent.post(`/api/bookings/flight/${id}/pay`).expect(201);
      const ev = paymentIntentEvent('payment_intent.succeeded', t.stripe.succeed(t.stripe.lastIntent()!.id));
      const before = t.outbox.to(u.email).length;
      const res = await Promise.all([send(ev), send({ ...ev, id: (ev as any).id + '_b' }), send({ ...ev, id: (ev as any).id + '_c' })]);
      check(res.every((r) => r.status === 200), `all 200 (${res.map((r) => r.status)})`);
      check((await doc(id)).status === 'Confirmed', 'Confirmed');
      const mails = t.outbox.to(u.email).length - before;
      check(mails === 1, `one confirmation email (got ${mails})`);
      const notes = (await u.agent.get('/api/notifications')).body.data.filter((x: any) => x.type === 'BOOKING_CONFIRMED');
      check(notes.length === 1, `one confirmation notification (got ${notes.length})`);
    });

    expect(results.filter((r) => !r.ok).map((r) => r.id)).toEqual([]);
  }, 300_000);
});
