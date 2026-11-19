// TEMPORARY (test branch only): Milestone 1 test plan, Part 3 (airlines &
// flights management), cases 3.1-3.21. Every case runs even if an earlier
// one fails; results are printed at the end. Where the spec names no status
// code, any refusal (4xx) passes and the code is recorded.
import * as request from 'supertest';
import { Types } from 'mongoose';
import { Flight } from '../src/flights/schemas/flight.schema';
import { FlightBooking } from '../src/flight-bookings/schemas/flight-booking.schema';
import { createTestApp, TestApp } from './e2e/app';
import { Actor, admin, airlineModerator, traveler } from './e2e/actors';
import { createAirline, seedReference } from './e2e/fixtures';
import { paymentIntentEvent, signedWebhook } from './e2e/fakes';

type Res = request.Response;
const results: { id: string; ok: boolean; note: string }[] = [];
function check(cond: boolean, what: string, res?: Res) {
  if (!cond) {
    const got = res ? ` [got ${res.status} ${JSON.stringify(res.body).slice(0, 220)}]` : '';
    throw new Error(what + got);
  }
}
const refused = (r: Res) => r.status >= 400 && r.status < 500;
async function tc(id: string, fn: () => Promise<string | void>) {
  try {
    results.push({ id, ok: true, note: (await fn()) || '' });
  } catch (e) {
    results.push({ id, ok: false, note: (e as Error).message.slice(0, 500) });
  }
}
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const PAX = (name = 'TEST Passenger') => ({ type: 'adult', fullName: name, dateOfBirth: '1990-01-01', passportNumber: 'A1234567' });

describe('Test plan Part 3: airlines & flights management', () => {
  let t: TestApp;
  let adm: Actor, U: Actor, V: Actor;

  // Hold -> accept policies -> pay -> Stripe webhook success (PAY-01).
  async function paidBooking(who: Actor, flightId: string, pax = [PAX()]) {
    const hold = await who.agent.post('/api/flight-bookings/hold').send({ outboundFlightId: flightId, cabin: 'Economy', passengers: pax });
    if (hold.status !== 201) throw new Error(`hold failed ${hold.status} ${JSON.stringify(hold.body)}`);
    const id = hold.body._id;
    await who.agent.post(`/api/bookings/flight/${id}/accept-policies`).send({ accepted: true }).expect(200);
    await who.agent.post(`/api/bookings/flight/${id}/pay`).expect(201);
    const intent = t.stripe.lastIntent()!;
    const { payload, signature } = signedWebhook(paymentIntentEvent('payment_intent.succeeded', t.stripe.succeed(intent.id)));
    await t.http().post('/api/payments/webhook').set('Content-Type', 'application/json').set('stripe-signature', signature).send(payload).expect(200);
    return id as string;
  }

  beforeAll(async () => {
    t = await createTestApp('part3-flights');
    await seedReference(t);
    adm = await admin(t);
    U = await traveler(t, 'TEST U');
    V = await traveler(t, 'TEST V');
  }, 90_000);

  afterAll(async () => {
    const pass = results.filter((r) => r.ok).length;
    console.log(`\nPART 3 RESULTS: ${pass}/${results.length} passed\n` + results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.id}${r.note ? '  ' + r.note : ''}`).join('\n'));
    await t?.close();
  });

  it('runs cases 3.1-3.21', async () => {
    let X = '';
    let modX!: Actor, modY!: Actor;
    await tc('3.1', async () => {
      const r = await adm.agent.post('/api/airlines').send({ name: 'TEST Nile Air', code: 'Q7' });
      check(r.status === 201, 'create airline 201', r);
      X = r.body._id;
      check(r.body.code === 'Q7' && r.body.isActive === true, 'active airline with its code', r);
    });
    modX = await airlineModerator(t, X);
    modY = await airlineModerator(t, await createAirline(t));

    await tc('3.2', async () => {
      const dup = await adm.agent.post('/api/airlines').send({ name: 'TEST Copy', code: 'Q7' });
      check(dup.status === 409, 'duplicate code 409', dup);
      for (const code of ['X', 'ABCD1', '9']) {
        const r = await adm.agent.post('/api/airlines').send({ name: 'TEST Bad', code });
        check(r.status === 400, `code "${code}" -> 400`, r);
      }
      const asMod = await modX.agent.post('/api/airlines').send({ name: 'TEST Mod Air', code: 'Q8' });
      check(asMod.status === 403, 'moderator cannot create an airline', asMod);
    });

    await tc('3.3', async () => {
      const r = await modX.agent.patch(`/api/airlines/${X}`).send({ name: 'TEST Nile Air 2' });
      check(r.status === 200 && r.body.name === 'TEST Nile Air 2', 'edit own airline 200', r);
      const logo = await modX.agent.post(`/api/airlines/${X}/logo`).attach('logo', PNG, 'logo.png');
      check(logo.status === 200 || logo.status === 201, 'logo upload ok', logo);
      const view = await t.http().get(`/api/airlines/${X}`);
      check(!!view.body.logo, 'logo URL shown on the airline', view);
    });

    await tc('3.4', async () => {
      const r = await modY.agent.patch(`/api/airlines/${X}`).send({ name: 'hacked' });
      check(r.status === 403, "another airline's moderator 403", r);
      const u = await U.agent.patch(`/api/airlines/${X}`).send({ name: 'hacked' });
      check(u.status === 403, 'a user 403', u);
    });

    await tc('3.5', async () => {
      const r = await modX.agent.put(`/api/airlines/${X}/baggage-policy`).send({ extraBagPrice: 5000, maxExtraBags: 2 });
      check(r.status === 200, 'baggage policy 200', r);
      const bad = await modX.agent.put(`/api/airlines/${X}/baggage-policy`).send({ extraBagPrice: 0, maxExtraBags: -1 });
      check(bad.status === 400, 'price 0 / max -1 refused (FLT-08)', bad);
      const view = await t.http().get(`/api/airlines/${X}`);
      check(view.body.extraBagPrice === 5000 && view.body.maxExtraBags === 2, 'stored', view);
    });

    await tc('3.6', async () => {
      const r = await modX.agent.put(`/api/airlines/${X}/cancellation-policy`).send({ tiers: [{ daysBefore: 7, refundPercent: 100 }, { daysBefore: 2, refundPercent: 50 }] });
      check(r.status === 200, 'tiers 200', r);
      const view = await t.http().get(`/api/airlines/${X}`);
      check(view.body.cancellationTiers?.length === 2, 'two tiers stored', view);
    });

    await tc('3.7', async () => {
      for (const [what, tiers] of [
        ['percent 150', [{ daysBefore: 7, refundPercent: 150 }]],
        ['percent -1', [{ daysBefore: 7, refundPercent: -1 }]],
        ['days -1', [{ daysBefore: -1, refundPercent: 50 }]],
        ['days 2.5', [{ daysBefore: 2.5, refundPercent: 50 }]],
        ['duplicate days', [{ daysBefore: 7, refundPercent: 100 }, { daysBefore: 7, refundPercent: 50 }]],
      ] as const) {
        const r = await modX.agent.put(`/api/airlines/${X}/cancellation-policy`).send({ tiers });
        check(r.status === 400, `${what} -> 400`, r);
      }
    });

    const mk = (n: string, day: string, extra: Record<string, unknown> = {}) =>
      modX.agent.post('/api/flights').send({ flightNumber: n, from: 'CAI', to: 'DXB', departureLocal: `${day}T10:00`, arrivalLocal: `${day}T15:00`, ...extra });
    let F = '';
    await tc('3.8', async () => {
      const r = await mk('Q7101', '2099-12-01');
      check(r.status === 201, 'create flight 201', r);
      F = r.body._id;
      check(r.body.status === 'Scheduled', 'status Scheduled', r);
      const doc = await t.model(Flight.name).findById(F).lean<any>();
      check(new Date(doc.departureAt).toISOString() === '2099-12-01T08:00:00.000Z', 'stored in UTC');
    });

    await tc('3.9', async () => {
      const notes: string[] = [];
      for (const [what, body] of [
        ['arrival before departure', { flightNumber: 'Q7102', from: 'CAI', to: 'DXB', departureLocal: '2099-12-01T15:00', arrivalLocal: '2099-12-01T13:00' }],
        ['same airports', { flightNumber: 'Q7103', from: 'CAI', to: 'CAI', departureLocal: '2099-12-01T10:00', arrivalLocal: '2099-12-01T12:00' }],
        ['unknown airport', { flightNumber: 'Q7104', from: 'ZZZ', to: 'DXB', departureLocal: '2099-12-01T10:00', arrivalLocal: '2099-12-01T15:00' }],
        ['past date', { flightNumber: 'Q7105', from: 'CAI', to: 'DXB', departureLocal: '2020-12-01T10:00', arrivalLocal: '2020-12-01T15:00' }],
      ] as const) {
        const r = await modX.agent.post('/api/flights').send(body);
        check(refused(r), `${what} refused`, r);
        notes.push(`${what}:${r.status}`);
      }
      return notes.join(' ');
    });

    await tc('3.10', async () => {
      const r = await mk('Q7101', '2099-12-01');
      check(r.status === 409, 'same number + date 409', r);
    });

    let econId = '';
    await tc('3.11', async () => {
      const e = await modX.agent.post(`/api/flights/${F}/cabins`).send({ category: 'Economy', totalSeats: 5, price: 20000, freeBags: 1, maxKgPerBag: 23 });
      check(e.status === 201, 'Economy 201', e);
      const b = await modX.agent.post(`/api/flights/${F}/cabins`).send({ category: 'Business', totalSeats: 2, price: 60000, freeBags: 2, maxKgPerBag: 32 });
      check(b.status === 201, 'Business 201', b);
      const again = await modX.agent.post(`/api/flights/${F}/cabins`).send({ category: 'Economy', totalSeats: 5, price: 20000, freeBags: 1, maxKgPerBag: 23 });
      check(refused(again), 'Economy twice refused', again);
      const odd = await modX.agent.post(`/api/flights/${F}/cabins`).send({ category: 'Super', totalSeats: 5, price: 20000, freeBags: 1, maxKgPerBag: 23 });
      check(odd.status === 400, 'category outside the set 400', odd);
      for (const bad of [{ totalSeats: 0 }, { totalSeats: 2.5 }, { price: 0 }]) {
        const r = await modX.agent.post(`/api/flights/${F}/cabins`).send({ category: 'First', totalSeats: 2, price: 90000, freeBags: 2, maxKgPerBag: 32, ...bad });
        check(r.status === 400, `${JSON.stringify(bad)} -> 400`, r);
      }
      const doc = await t.model(Flight.name).findById(F).lean<any>();
      econId = String(doc.cabins.find((c: any) => c.category === 'Economy')._id);
      return `Economy twice: ${again.status}`;
    });

    await tc('3.12', async () => {
      const p = await modX.agent.patch(`/api/flights/${F}/cabins/${econId}`).send({ price: 22000 });
      check(p.status === 200, 'price change 200', p);
      await t.model(Flight.name).updateOne({ _id: F, 'cabins._id': econId }, { $set: { 'cabins.$.bookedSeats': 3 } });
      const low = await modX.agent.patch(`/api/flights/${F}/cabins/${econId}`).send({ totalSeats: 2 });
      check(refused(low), 'seats below booked refused', low);
      await t.model(Flight.name).updateOne({ _id: F, 'cabins._id': econId }, { $set: { 'cabins.$.bookedSeats': 0 } });
      return `below booked: ${low.status}`;
    });

    await tc('3.13', async () => {
      const r = await mk('Q7110', '2099-12-05');
      const id = r.body._id;
      await modX.agent.post(`/api/flights/${id}/cabins`).send({ category: 'Economy', totalSeats: 5, price: 20000, freeBags: 1, maxKgPerBag: 23 }).expect(201);
      const b = await paidBooking(U, id);
      check((await t.model(FlightBooking.name).findById(b).lean<any>()).status === 'Confirmed', 'booking Confirmed');
      const time = await modX.agent.patch(`/api/flights/${id}`).send({ departureLocal: '2099-12-05T11:00', arrivalLocal: '2099-12-05T16:00' });
      check(time.status === 200, 'time change 200', time);
      const air = await modX.agent.patch(`/api/flights/${id}`).send({ to: 'CAI', from: 'DXB' });
      check(refused(air), 'airports locked once booked', air);
      const notes = await U.agent.get('/api/notifications');
      const msgs = JSON.stringify(notes.body);
      check(/change|schedule|time/i.test(msgs), 'passenger notified of the schedule change (GEN-01)', notes);
      return `airports: ${air.status}`;
    });

    await tc('3.14', async () => {
      const anon = await t.http().get(`/api/airlines/${X}/flights`);
      check(anon.status === 401, 'moderator route: no session 401', anon);
      const other = await modY.agent.get(`/api/airlines/${X}/flights`);
      check(other.status === 403, "another airline's moderator 403", other);
      const r = await modX.agent.get(`/api/airlines/${X}/flights`).query({ page: 1 });
      check(r.status === 200 && Array.isArray(r.body.data) && !!r.body.meta, 'paginated list', r);
      check(r.body.data.every((f: any) => String(f.airlineId) === X), 'only this airline', r);
      return `${r.body.meta.total} flights`;
    });

    let FC = '';
    let bc = '';
    await tc('3.15', async () => {
      const r = await mk('Q7120', '2099-12-07');
      FC = r.body._id;
      await modX.agent.post(`/api/flights/${FC}/cabins`).send({ category: 'Economy', totalSeats: 5, price: 20000, freeBags: 1, maxKgPerBag: 23 }).expect(201);
      bc = await paidBooking(U, FC, [PAX('TEST Sara Ali')]);
      const list = await modX.agent.get(`/api/flights/${FC}/bookings`);
      check(list.status === 200, 'passenger list 200', list);
      const s = JSON.stringify(list.body);
      check(s.includes('TEST Sara Ali') && s.includes('Confirmed'), 'passenger name and status shown', list);
      check(/remaining|available/i.test(s), 'seats remaining shown', list);
    });

    await tc('3.16', async () => {
      const r = await modX.agent.get(`/api/flights/${FC}/passengers/export`);
      check(r.status === 200 && /text\/csv/.test(r.headers['content-type']), 'CSV 200', r);
      check(r.text.includes('TEST Sara Ali'), 'passenger in the CSV');
    });

    await tc('3.17', async () => {
      const y = await modY.agent.get(`/api/flights/${FC}/bookings`);
      const u = await U.agent.get(`/api/flights/${FC}/bookings`);
      check(y.status === 403 && u.status === 403, 'other airline and user 403', y.status === 403 ? u : y);
    });

    await tc('3.18', async () => {
      const held = await V.agent.post('/api/flight-bookings/hold').send({ outboundFlightId: FC, cabin: 'Economy', passengers: [PAX('TEST V')] });
      check(held.status === 201, 'V holds a seat', held);
      const mailsBefore = t.outbox.to(U.email).length;
      const r = await modX.agent.post(`/api/flights/${FC}/cancel`).send({});
      check(r.status === 200, 'cancel flight 200', r);
      check(r.body.cancelledBookings === 1 && r.body.releasedHolds === 1, '1 booking cancelled, 1 hold released', r);
      const b = await t.model(FlightBooking.name).findById(bc).lean<any>();
      check(b.status === 'Cancelled', 'Confirmed booking -> Cancelled');
      const h = await t.model(FlightBooking.name).findById(held.body._id).lean<any>();
      check(h.status !== 'PendingPayment', `hold released (now ${h.status})`);
      const refund = t.stripe.calls.filter((c) => c.method === 'createRefund').pop();
      check(!!refund && refund.args[1] === b.totalAmount, `100% refund (${refund?.args[1]} of ${b.totalAmount})`);
      const f = await t.model(Flight.name).findById(FC).lean<any>();
      check(f.status === 'Cancelled', 'flight Cancelled');
      check(t.outbox.to(U.email).length > mailsBefore, 'passenger emailed');
    });

    await tc('3.19', async () => {
      const r = await modX.agent.post(`/api/flights/${FC}/cancel`).send({});
      check(refused(r), 'cancel twice refused', r);
      return `${r.status}`;
    });

    await tc('3.20', async () => {
      const s = await t.http().get('/api/flights/search').query({ from: 'CAI', to: 'DXB', date: '2099-12-07', passengers: 1 });
      check(s.status === 200 && !JSON.stringify(s.body).includes(FC), 'cancelled flight not in search', s);
      const h = await U.agent.post('/api/flight-bookings/hold').send({ outboundFlightId: FC, cabin: 'Economy', passengers: [PAX()] });
      check(refused(h), 'cannot hold a cancelled flight', h);
      const e = await modX.agent.patch(`/api/flights/${FC}`).send({ departureLocal: '2099-12-07T12:00', arrivalLocal: '2099-12-07T17:00' });
      check(refused(e), 'cannot edit a cancelled flight', e);
      return `hold ${h.status}, edit ${e.status}`;
    });

    await tc('3.21', async () => {
      const search = () => t.http().get('/api/flights/search').query({ from: 'CAI', to: 'DXB', date: '2099-12-01', passengers: 1 });
      check(JSON.stringify((await search()).body).includes(F), 'flight in search before');
      const d = await adm.agent.patch(`/api/admin/providers/airline/${X}/deactivate`);
      check(d.status === 200, 'deactivate 200', d);
      check(!JSON.stringify((await search()).body).includes(F), 'hidden after deactivation');
      const h = await U.agent.post('/api/flight-bookings/hold').send({ outboundFlightId: F, cabin: 'Economy', passengers: [PAX()] });
      check(refused(h), 'cannot be booked while deactivated', h);
      const a = await adm.agent.patch(`/api/admin/providers/airline/${X}/reactivate`);
      check(a.status === 200, 'reactivate 200', a);
      check(JSON.stringify((await search()).body).includes(F), 'back in search');
    });

    void Types;
    expect(results.filter((r) => !r.ok).map((r) => r.id)).toEqual([]);
  }, 240_000);
});
