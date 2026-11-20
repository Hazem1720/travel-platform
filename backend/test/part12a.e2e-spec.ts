// TEMPORARY (test branch only): Milestone 1 test plan, Part 12 first half
// (cases 12.1-12.26: accounts, flights, hotels), the rules added after
// checking every requirement. Every case runs even if an earlier one fails;
// results are printed at the end. Where the spec names no status code, any
// refusal (4xx) passes and the code is recorded.
import * as request from 'supertest';
import { Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { Flight } from '../src/flights/schemas/flight.schema';
import { FlightStatusJob } from '../src/flights/flight-status.job';
import { FlightBookingJobs } from '../src/flight-bookings/flight-booking.jobs';
import { User } from '../src/users/schemas/user.schema';
import { createTestApp, TestApp } from './e2e/app';
import { Actor, admin, airlineModerator, hotelModerator, login, traveler, TEST_PASSWORD } from './e2e/actors';
import { createAirline, seedReference } from './e2e/fixtures';
import { paymentIntentEvent, signedWebhook } from './e2e/fakes';

type Res = request.Response;
const results: { id: string; ok: boolean; note: string }[] = [];
function check(cond: boolean, what: string, res?: Res) {
  if (!cond) {
    const got = res ? ` [got ${res.status} ${JSON.stringify(res.body).slice(0, 260)}]` : '';
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
const DAY = 86_400_000;
const idOf = (b: any) => String(b?._id ?? b?.id);
const adult = (n = 'TEST Adult') => ({ type: 'adult', fullName: n, dateOfBirth: '1990-01-01', passportNumber: 'A1234567' });

describe('Test plan Part 12a: accounts, flights, hotels', () => {
  let t: TestApp;
  let adm: Actor, U: Actor, V: Actor;
  let airline: Types.ObjectId, air: Actor, code = '';
  let n = 0;

  const localDate = (d: Date, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
  const TZ: Record<string, string> = { CAI: 'Africa/Cairo', DXB: 'Asia/Dubai', LHR: 'Europe/London' };
  async function flight(o: { from?: string; to?: string; dep: Date; price?: number; seats?: number; airlineId?: Types.ObjectId }) {
    const from = o.from ?? 'CAI';
    const f = await t.model(Flight.name).create({
      airlineId: o.airlineId ?? airline, flightNumber: `${code}${700 + ++n}`, from, to: o.to ?? 'DXB',
      departureAt: o.dep, arrivalAt: new Date(o.dep.getTime() + 4 * 3600_000), departureDate: localDate(o.dep, TZ[from]),
      status: 'Scheduled', cabins: [{ category: 'Economy', totalSeats: o.seats ?? 5, price: o.price ?? 20000, freeBags: 1, maxKgPerBag: 23 }],
    });
    return String(f._id);
  }
  async function webhookSuccess() {
    const intent = t.stripe.lastIntent()!;
    const { payload, signature } = signedWebhook(paymentIntentEvent('payment_intent.succeeded', t.stripe.succeed(intent.id)));
    await t.http().post('/api/payments/webhook').set('Content-Type', 'application/json').set('stripe-signature', signature).send(payload).expect(200);
  }
  async function paid(who: Actor, body: Record<string, unknown>, kind: 'flight' | 'hotel' = 'flight') {
    const url = kind === 'flight' ? '/api/flight-bookings/hold' : '/api/hotel-bookings';
    const h = await who.agent.post(url).send(body);
    if (h.status !== 201) throw new Error(`booking ${h.status} ${JSON.stringify(h.body)}`);
    await who.agent.post(`/api/bookings/${kind}/${h.body._id}/accept-policies`).send({ accepted: true }).expect(200);
    await who.agent.post(`/api/bookings/${kind}/${h.body._id}/pay`).expect(201);
    await webhookSuccess();
    return idOf(h.body);
  }

  beforeAll(async () => {
    t = await createTestApp('part12a');
    await seedReference(t);
    adm = await admin(t);
    U = await traveler(t, 'TEST Uma');
    V = await traveler(t, 'TEST Vik');
    airline = await createAirline(t, { cancellationTiers: [{ daysBefore: 7, refundPercent: 100 }, { daysBefore: 2, refundPercent: 50 }] });
    code = (await t.model('Airline').findById(airline).lean<any>()).code;
    air = await airlineModerator(t, airline);
  }, 120_000);

  afterAll(async () => {
    const pass = results.filter((r) => r.ok).length;
    console.log(`\nPART 12a RESULTS: ${pass}/${results.length} passed\n` + results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.id}${r.note ? '  ' + r.note : ''}`).join('\n'));
    await t?.close();
  });

  it('runs cases 12.1-12.26', async () => {
    // ---------- Accounts & security ----------
    await tc('12.1', async () => {
      const A = await traveler(t, 'TEST Idle');
      await t.model(User.name).updateOne({ _id: A.id }, { $set: { lastActivityAt: new Date(Date.now() - 31 * 60_000) } });
      const r = await A.agent.get('/api/users/me');
      check(r.status === 401, 'idle 31 minutes -> 401 (ACC-06)', r);
      const B = request.agent(t.server);
      const lr = await B.post('/api/auth/login').send({ email: V.email, password: TEST_PASSWORD });
      const refresh = ([] as string[]).concat(lr.headers['set-cookie'] ?? []).find((c) => c.startsWith('refresh_token='))!.split(';')[0];
      await B.post('/api/auth/logout').expect(200);
      const again = await t.http().post('/api/auth/refresh').set('Cookie', refresh);
      check(again.status === 401, 'refresh token revoked on the server after logout', again);
      V = await login(t, V.email, TEST_PASSWORD);
    });

    await tc('12.2', async () => {
      const r = await t.http().post('/api/auth/login').send({ email: U.email, password: TEST_PASSWORD });
      const cookies = ([] as string[]).concat(r.headers['set-cookie'] ?? []);
      check(cookies.length >= 2 && cookies.every((c) => /httponly/i.test(c) && /samesite/i.test(c)), 'httpOnly + SameSite cookies', r);
      check(!/eyJ[\w-]+\.[\w-]+\./.test(JSON.stringify(r.body)), 'no token in the JSON body', r);
      return 'Secure is on by default (unit test auth.service.spec); the test setup turns it off to use plain http';
    });

    await tc('12.3', async () => {
      const S = await traveler(t, 'TEST Susp');
      const f = await flight({ dep: new Date('2099-12-03T08:00:00Z') });
      const b = await paid(S, { outboundFlightId: f, cabin: 'Economy', passengers: [adult()] });
      const p = await S.agent.post('/api/posts').send({ title: 'TEST suspended post', body: 'x', status: 'Published' });
      await adm.agent.patch(`/api/admin/accounts/${S.id}/suspend`).send({}).expect(200);
      const lg = await t.http().post('/api/auth/login').send({ email: S.email, password: TEST_PASSWORD });
      check(lg.status === 403, 'cannot log in', lg);
      check((await t.model('FlightBooking').findById(b).lean<any>()).status === 'Confirmed', 'booking stays Confirmed (ACC-16)');
      const pub = await t.http().get(`/api/posts/${idOf(p.body)}`);
      check(pub.status === 200, 'content stays visible', pub);
    });

    await tc('12.4', async () => {
      const a2 = await createAirline(t);
      const mod = await airlineModerator(t, a2);
      await adm.agent.patch(`/api/admin/accounts/${mod.id}/suspend`).send({}).expect(200);
      const lg = await t.http().post('/api/auth/login').send({ email: mod.email, password: TEST_PASSWORD });
      check(lg.status === 403, 'suspended moderator cannot log in', lg);
      const f = await flight({ dep: new Date('2099-12-03T08:00:00Z'), airlineId: a2 });
      const b = await paid(U, { outboundFlightId: f, cabin: 'Economy', passengers: [adult()] });
      await adm.agent.patch(`/api/admin/providers/airline/${a2}/deactivate`).expect(200);
      const h = await V.agent.post('/api/flight-bookings/hold').send({ outboundFlightId: f, cabin: 'Economy', passengers: [adult()] });
      check(refused(h), 'deactivated airline cannot be booked', h);
      check((await t.model('FlightBooking').findById(b).lean<any>()).status === 'Confirmed', 'existing Confirmed booking stays valid');
      const notes = await t.model('Notification').countDocuments({ userId: new Types.ObjectId(mod.id) });
      check(notes >= 2, `affected parties notified (moderator has ${notes})`);
      await adm.agent.patch(`/api/admin/providers/airline/${a2}/reactivate`).expect(200);
      await adm.agent.patch(`/api/admin/accounts/${mod.id}/reactivate`).expect(200);
      const back = await t.http().post('/api/auth/login').send({ email: mod.email, password: TEST_PASSWORD });
      check(back.status === 200, 'reactivated moderator logs in', back);
      return `hold: ${h.status}`;
    });

    await tc('12.5', async () => {
      const r = await adm.agent.get('/api/admin/accounts').query({ role: 'user', status: 'suspended' });
      check(r.status === 200 && r.body.data.length >= 1 && r.body.data.every((a: any) => a.role === 'user' && a.status === 'suspended'), 'role + status together', r);
      const s = await adm.agent.get('/api/admin/accounts').query({ search: 'Uma' });
      check(s.body.data.some((a: any) => a.email === U.email) && s.body.data.every((a: any) => !!a.createdAt), 'search by name, registration date shown', s);
    });

    await tc('12.6', async () => {
      // passwordHash is not selected by default.
      const a = await t.model(User.name).findById(U.id).select('+passwordHash').lean<any>();
      const b = await t.model(User.name).findById(V.id).select('+passwordHash').lean<any>();
      check(/^\$2[aby]\$/.test(a.passwordHash) && a.passwordHash !== b.passwordHash, 'salted bcrypt hashes, different for the same password');
      check(await bcrypt.compare(TEST_PASSWORD, a.passwordHash), 'hash matches the password');
      check(!JSON.stringify(a).includes(TEST_PASSWORD), 'no plain password stored');
    });

    // ---------- Flights ----------
    await tc('12.7', async () => {
      const c = await air.agent.post('/api/flights').send({ flightNumber: `${code}901`, from: 'ZZZ', to: 'DXB', departureLocal: '2099-12-01T10:00', arrivalLocal: '2099-12-01T14:00' });
      const s = await t.http().get('/api/flights/search').query({ from: 'ZZZ', to: 'DXB', date: '2099-12-01', passengers: 1 });
      check(c.status === 400 && s.status === 400, `unknown airport: create ${c.status}, search ${s.status}`);
    });

    const F = await flight({ dep: new Date('2099-12-02T08:00:00Z') });
    await tc('12.8', async () => {
      for (const [what, body] of [
        ['category Super', { category: 'Super', totalSeats: 5, price: 1000, freeBags: 1, maxKgPerBag: 23 }],
        ['seats 0', { category: 'Business', totalSeats: 0, price: 1000, freeBags: 1, maxKgPerBag: 23 }],
        ['seats 2.5', { category: 'Business', totalSeats: 2.5, price: 1000, freeBags: 1, maxKgPerBag: 23 }],
        ['price 0', { category: 'Business', totalSeats: 2, price: 0, freeBags: 1, maxKgPerBag: 23 }],
      ] as const) {
        const r = await air.agent.post(`/api/flights/${F}/cabins`).send(body);
        check(r.status === 400, `${what} -> 400`, r);
      }
      const ok = await air.agent.post(`/api/flights/${F}/cabins`).send({ category: 'Premium Economy', totalSeats: 2, price: 30000, freeBags: 1, maxKgPerBag: 23 });
      check(ok.status === 201, 'Premium Economy accepted', ok);
    });

    await tc('12.9', async () => {
      const notes: string[] = [];
      const booked = await flight({ dep: new Date('2099-12-04T08:00:00Z'), seats: 3 });
      await paid(U, { outboundFlightId: booked, cabin: 'Economy', passengers: [adult()] });
      await V.agent.post('/api/flight-bookings/hold').send({ outboundFlightId: booked, cabin: 'Economy', passengers: [adult()] });
      const air1 = await air.agent.patch(`/api/flights/${booked}`).send({ from: 'DXB', to: 'CAI' });
      check(refused(air1), 'airports locked once booked', air1);
      const cab = (await t.model(Flight.name).findById(booked).lean<any>()).cabins[0];
      const low = await air.agent.patch(`/api/flights/${booked}/cabins/${cab._id}`).send({ totalSeats: 1 });
      check(refused(low), 'seats below booked + held refused', low);
      const ok = await air.agent.patch(`/api/flights/${booked}/cabins/${cab._id}`).send({ totalSeats: 2 });
      check(ok.status === 200, 'down to booked + held is fine', ok);
      const cancelled = await flight({ dep: new Date('2099-12-04T10:00:00Z') });
      await air.agent.post(`/api/flights/${cancelled}/cancel`).send({}).expect(200);
      const e1 = await air.agent.patch(`/api/flights/${cancelled}`).send({ departureLocal: '2099-12-04T13:00', arrivalLocal: '2099-12-04T18:00' });
      check(refused(e1), 'Cancelled flight not editable', e1);
      const past = await flight({ dep: new Date(Date.now() - 2 * 3600_000) });
      const e2 = await air.agent.patch(`/api/flights/${past}`).send({ departureLocal: '2099-12-04T13:00', arrivalLocal: '2099-12-04T18:00' });
      check(refused(e2), 'Departed flight not editable', e2);
      notes.push(`airports ${air1.status}, seats ${low.status}, cancelled ${e1.status}, departed ${e2.status}`);
      return notes.join(' ');
    });

    await tc('12.10', async () => {
      const q = (bags: number) => U.agent.post('/api/flight-bookings').send({ outboundFlightId: F, cabin: 'Economy', passengers: [{ ...adult(), extraBags: Array.from({ length: bags }, () => ({ weightKg: 20 })) }] });
      const one = await q(1);
      const two = await q(2);
      check(two.body.price.total - one.body.price.total === one.body.price.total - 20000, 'each extra bag adds the same fee (FLT-08)', two);
      const three = await q(3);
      check(three.status === 400, 'above the per-passenger maximum 400', three);
      return `fee per bag ${one.body.price.total - 20000}`;
    });

    await tc('12.11', async () => {
      const got: string[] = [];
      for (const [days, pct] of [[7, 100], [6, 50], [2, 50], [1, 0], [0, 0]] as const) {
        const f = await flight({ dep: new Date(Date.now() + days * DAY + 2 * 3600_000) });
        const b = await paid(V, { outboundFlightId: f, cabin: 'Economy', passengers: [adult()] });
        const r = await V.agent.get(`/api/flight-bookings/${b}/cancellation`);
        got.push(`${r.body.daysBeforeDeparture}d:${r.body.refundPercent}%`);
        check(r.body.refundPercent === (r.body.daysBeforeDeparture >= 7 ? 100 : r.body.daysBeforeDeparture >= 2 ? 50 : 0), `highest tier not above the days left (${got.join(' ')})`, r);
      }
      void got;
      return got.join(' ');
    });

    await tc('12.12', async () => {
      const a2 = await createAirline(t);
      const hidden = await flight({ dep: new Date('2099-12-08T08:00:00Z'), airlineId: a2 });
      await adm.agent.patch(`/api/admin/providers/airline/${a2}/deactivate`).expect(200);
      const small = await flight({ dep: new Date('2099-12-08T09:00:00Z'), seats: 1 });
      const s = JSON.stringify((await t.http().get('/api/flights/search').query({ from: 'CAI', to: 'DXB', date: '2099-12-08', passengers: 2 })).body);
      check(!s.includes(hidden) && !s.includes(small), 'inactive airline and too few seats excluded');
      const late = await air.agent.post('/api/flights').send({ flightNumber: `${code}950`, from: 'DXB', to: 'CAI', departureLocal: '2099-12-06T01:30', arrivalLocal: '2099-12-06T04:00' });
      check(late.status === 201, 'create a 01:30 Dubai flight', late);
      await air.agent.post(`/api/flights/${late.body._id}/cabins`).send({ category: 'Economy', totalSeats: 5, price: 10000, freeBags: 1, maxKgPerBag: 23 }).expect(201);
      const on6 = JSON.stringify((await t.http().get('/api/flights/search').query({ from: 'DXB', to: 'CAI', date: '2099-12-06', passengers: 1 })).body);
      const on5 = JSON.stringify((await t.http().get('/api/flights/search').query({ from: 'DXB', to: 'CAI', date: '2099-12-05', passengers: 1 })).body);
      check(on6.includes(late.body._id) && !on5.includes(late.body._id), 'found on its local date (6 Dec), not its UTC date (5 Dec)');
    });

    await tc('12.13', async () => {
      const out = await flight({ dep: new Date(Date.now() + 3 * DAY + 3600_000), price: 20000 });
      const ret = await flight({ from: 'DXB', to: 'CAI', dep: new Date(Date.now() + 10 * DAY), price: 10000 });
      const infant = { type: 'infant', fullName: 'TEST Baby', dateOfBirth: new Date(Date.now() - 300 * DAY).toISOString().slice(0, 10), passportNumber: 'B1234567' };
      const h = await U.agent.post('/api/flight-bookings/hold').send({ outboundFlightId: out, returnFlightId: ret, cabin: 'Economy', passengers: [adult(), infant] });
      check(h.status === 201 && h.body.segments.length === 2, 'round trip: one booking, two segments', h);
      check(h.body.totalAmount === 33000, `adult 30000 + infant 10% (3000) = 33000 (got ${h.body.totalAmount})`, h);
      check((await t.model(Flight.name).findById(out).lean<any>()).cabins[0].heldSeats === 1, 'the infant takes no seat');
      const bid = idOf(h.body);
      await U.agent.post(`/api/bookings/flight/${bid}/accept-policies`).send({ accepted: true }).expect(200);
      await U.agent.post(`/api/bookings/flight/${bid}/pay`).expect(201);
      await webhookSuccess();
      const pays = await t.model('Payment').countDocuments({ bookingId: new Types.ObjectId(bid) });
      const b = await t.model('FlightBooking').findById(bid).lean<any>();
      check(pays === 1 && /^FL-/.test(b.reference), 'one payment, one reference');
      const q = await U.agent.get(`/api/flight-bookings/${bid}/cancellation`);
      check(q.body.refundPercent === 50, `cancelled as a whole with the outbound tier (3 days -> 50%, got ${q.body.refundPercent}%)`, q);
      const bad = [
        [{ ...adult('TEST Kid'), dateOfBirth: '2094-01-01', type: 'adult' }],
        [adult(), { ...adult('TEST Grown'), type: 'child' }],
        [{ ...infant }],
        [adult(), infant, { ...infant, fullName: 'TEST Baby 2' }],
      ];
      for (const passengers of bad) {
        const r = await U.agent.post('/api/flight-bookings').send({ outboundFlightId: out, cabin: 'Economy', passengers });
        check(r.status === 400, `refused: ${passengers.map((p: any) => p.type).join('+')}`, r);
      }
    });

    await tc('12.14', async () => {
      const mm = await t.http().get('/api/flights/search').query({ from: 'CAI', to: 'DXB', date: '2099-12-02', passengers: 1, minPrice: 5000, maxPrice: 100 });
      check(mm.status === 400, 'min > max 400', mm);
      const d = await t.http().get('/api/flights/search').query({ from: 'CAI', to: 'DXB', date: '2099-12-02', passengers: 1, sort: 'duration:asc' });
      check(d.status === 200, 'sort by duration', d);
      const cab = await t.http().get('/api/flights/search').query({ from: 'CAI', to: 'DXB', date: '2099-12-02', passengers: 1, cabin: 'Premium Economy' });
      check(JSON.stringify(cab.body).includes(F), 'cabin-class filter (FLT-12c)', cab);
      const biz = await t.http().get('/api/flights/search').query({ from: 'CAI', to: 'DXB', date: '2099-12-02', passengers: 1, cabin: 'First' });
      check(!JSON.stringify(biz.body).includes(F), 'a cabin the flight lacks excludes it', biz);
    });

    await tc('12.15', async () => {
      const r = await t.http().get(`/api/flights/${F}`);
      const s = JSON.stringify(r.body);
      check(r.status === 200, 'details 200 logged out', r);
      for (const [what, ok] of [
        ['airline name', /"name"/.test(s)],
        ['flight number', s.includes(`${code}`)],
        ['local times', /"local"/.test(s)],
        ['duration', /duration/i.test(s)],
        ['cabin price', /"price"/.test(s)],
        ['seats remaining', /availableSeats|remaining/.test(s)],
        ['baggage', /freeBags/.test(s)],
        ['cancellation policy', /refundPercent/.test(s)],
      ] as const) check(ok, `shows ${what} (FLT-17)`, r);
    });

    await tc('12.16', async () => {
      const G = await traveler(t, 'TEST Groups');
      const up = await paid(G, { outboundFlightId: await flight({ dep: new Date('2099-12-09T08:00:00Z') }), cabin: 'Economy', passengers: [adult()] });
      const pastF = await flight({ dep: new Date(Date.now() + 3 * DAY) });
      const past = await paid(G, { outboundFlightId: pastF, cabin: 'Economy', passengers: [adult()] });
      await t.app.get(FlightBookingJobs).completeLanded(new Date(Date.now() + 4 * DAY));
      const can = await paid(G, { outboundFlightId: await flight({ dep: new Date('2099-12-09T10:00:00Z') }), cabin: 'Economy', passengers: [adult()] });
      await G.agent.post(`/api/flight-bookings/${can}/cancel`).send({ refundAmount: 20000 }).expect(200);
      const g = async (group: string) => JSON.stringify((await G.agent.get('/api/flight-bookings').query({ group })).body);
      const [u, p, c] = [await g('upcoming'), await g('past'), await g('cancelled')];
      check(u.includes(up) && !u.includes(past) && !u.includes(can), 'Upcoming');
      check(p.includes(past) && !p.includes(up), 'Past (Completed)');
      check(c.includes(can) && !c.includes(up), 'Cancelled');
    });

    await tc('12.17', async () => {
      const d = await flight({ dep: new Date(Date.now() - 3600_000) });
      await t.app.get(FlightStatusJob).markDeparted();
      check((await t.model(Flight.name).findById(d).lean<any>()).status === 'Departed', 'status Departed (FLT-30)');
      const h = await U.agent.post('/api/flight-bookings/hold').send({ outboundFlightId: d, cabin: 'Economy', passengers: [adult()] });
      check(refused(h), 'not bookable', h);
      const e = await air.agent.patch(`/api/flights/${d}`).send({ departureLocal: '2099-12-04T13:00', arrivalLocal: '2099-12-04T18:00' });
      check(refused(e), 'not editable', e);
      const v = await t.http().get(`/api/flights/${d}`);
      check(JSON.stringify(v.body).includes('Departed'), 'details show Departed', v);
      return `hold ${h.status}, edit ${e.status}`;
    });

    await tc('12.18', async () => {
      const r = await air.agent.post('/api/flights').send({ flightNumber: `${code}960`, from: 'CAI', to: 'LHR', departureLocal: '2099-12-07T10:00', arrivalLocal: '2099-12-07T14:00' });
      check(r.status === 201, 'CAI -> LHR created', r);
      const f = await t.model(Flight.name).findById(r.body._id).lean<any>();
      check(f.departureAt.toISOString() === '2099-12-07T08:00:00.000Z' && f.arrivalAt.toISOString() === '2099-12-07T14:00:00.000Z', 'stored in UTC');
      const v = (await t.http().get(`/api/flights/${r.body._id}`)).body;
      const s = JSON.stringify(v);
      check(s.includes('10:00') && s.includes('14:00') && s.includes('Africa/Cairo') && s.includes('Europe/London'), 'each time in its own airport zone (GEN-06)', { status: 200, body: v } as any);
      check(/"duration\w*":\s*"?(360|6h|6 h|06:00)/i.test(s) || s.includes('360'), `6-hour duration (${(s.match(/"duration\w*":[^,}]*/) ?? [''])[0]})`, { status: 200, body: v } as any);
    });

    // ---------- Hotels ----------
    const hotel = async (name: string, rooms: [string, number, number][], extra: Record<string, unknown> = {}) => {
      const h = (await adm.agent.post('/api/hotels').send({ name, address: '1 St', cityId: 'cairo', countryCode: 'EG', starClass: 4, ...extra })).body._id;
      const mod = await hotelModerator(t, h);
      await mod.agent.put(`/api/hotels/${h}/policies`).send({ checkInTime: '15:00', checkOutTime: '11:00', cancellationTiers: [{ daysBefore: 0, refundPercent: 100 }] });
      const ids: string[] = [];
      for (const [nm, occ, price] of rooms) {
        const r = await mod.agent.post(`/api/hotels/${h}/rooms`).send({ name: nm, type: 'Room', beds: occ, maxOccupancy: occ, pricePerNight: price });
        ids.push(idOf(r.body));
        await mod.agent.post(`/api/hotels/${h}/rooms/${idOf(r.body)}/availability`).send({ from: '2099-12-01', to: '2099-12-31' });
      }
      return { h, mod, ids };
    };
    const H = await hotel('TEST Hotel Twelve', [['A', 1, 5000], ['B', 3, 12000], ['C', 2, 8000]]);
    const stay = (who: Actor, rooms: any[], ci: string, co: string) => ({ hotelId: H.h, checkIn: ci, checkOut: co, rooms: rooms.map((r) => ({ childAges: [], ...r })) });

    await tc('12.19', async () => {
      const pend = await V.agent.post('/api/hotel-bookings').send(stay(V, [{ roomId: H.ids[2], adults: 1 }], '2099-12-05', '2099-12-06'));
      check(pend.status === 201, 'a PendingPayment stay on room C', pend);
      const off = await H.mod.agent.patch(`/api/hotels/${H.h}/rooms/${H.ids[2]}`).send({ isActive: false });
      check(off.status === 409, 'deactivating it -> 409', off);
      const del = await H.mod.agent.delete(`/api/hotels/${H.h}/rooms/${H.ids[2]}`);
      check(del.status === 409, 'deleting it -> 409', del);
      const blk = await H.mod.agent.patch(`/api/hotels/${H.h}/rooms/${H.ids[2]}/availability`).send({ block: { from: '2099-12-05', to: '2099-12-06' } });
      check(blk.status === 409, 'blocking the held night -> 409', blk);
      const other = await hotel('TEST Room Life', [['X', 2, 7000]]);
      const b = await paid(U, { hotelId: other.h, checkIn: '2099-12-10', checkOut: '2099-12-11', rooms: [{ roomId: other.ids[0], adults: 1, childAges: [] }] }, 'hotel');
      await U.agent.post(`/api/hotel-bookings/${b}/cancel`).send({ refundAmount: 7000 }).expect(200);
      const once = await other.mod.agent.delete(`/api/hotels/${other.h}/rooms/${other.ids[0]}`);
      check(once.status === 409, 'a room ever reserved cannot be deleted, even after cancellation (HTL-06)', once);
      const deact = await other.mod.agent.patch(`/api/hotels/${other.h}/rooms/${other.ids[0]}`).send({ isActive: false });
      check(deact.status === 200, 'but it can be deactivated', deact);
      const s = await t.http().get(`/api/hotels/${other.h}/rooms/available`).query({ checkIn: '2099-12-20', checkOut: '2099-12-21' });
      check(!JSON.stringify(s.body).includes('"X"'), 'a deactivated room is not offered', s);
      return `deleting a once-reserved room: ${once.status}`;
    });

    await tc('12.20', async () => {
      const b = await paid(U, stay(U, [{ roomId: H.ids[1], adults: 2 }], '2099-12-10', '2099-12-12'), 'hotel');
      const r = await H.mod.agent.patch(`/api/hotels/${H.h}/rooms/${H.ids[1]}/availability`).send({ ranges: [{ from: '2099-12-15', to: '2099-12-31' }] });
      check(r.status === 409, 'removing availability on booked nights -> 409 (HTL-05)', r);
      const ok = await H.mod.agent.patch(`/api/hotels/${H.h}/rooms/${H.ids[1]}/availability`).send({ ranges: [{ from: '2099-12-01', to: '2099-12-20' }] });
      check(ok.status === 200, 'shrinking it around the stay is fine', ok);
      (global as any).__hb = b;
    });

    await tc('12.21', async () => {
      const b = (global as any).__hb as string;
      const r = await U.agent.get(`/api/hotel-bookings/${b}`);
      check(JSON.stringify(r.body).includes('15:00') && JSON.stringify(r.body).includes('11:00'), 'check-in/out times in the booking summary (HTL-09)', r);
    });

    await tc('12.22', async () => {
      const s = (q: Record<string, unknown>) => t.http().get('/api/hotels/search').query({ checkIn: '2099-12-15', checkOut: '2099-12-16', guests: 1, ...q });
      check(JSON.stringify((await s({ country: 'EG' })).body).includes(H.h), 'by country');
      const four = await s({ city: 'cairo', guests: 4, rooms: 2 });
      check(JSON.stringify(four.body).includes(H.h), '2 rooms whose combined occupancy covers 4 guests (B 3 + C 2)', four);
      const six = await s({ city: 'cairo', guests: 6, rooms: 2 });
      check(!JSON.stringify(six.body).includes(H.h), '6 guests in 2 rooms: no 2 rooms hold 6', six);
      const past = await s({ city: 'cairo', checkIn: '2020-01-01', checkOut: '2020-01-02' });
      check(past.status === 400, 'check-in in the past 400', past);
      const g = await hotel('TEST Gone Hotel', [['G', 2, 5000]]);
      await adm.agent.patch(`/api/admin/providers/hotel/${g.h}/deactivate`).expect(200);
      check(!JSON.stringify((await s({ city: 'cairo' })).body).includes(g.h), 'deactivated hotel excluded');
    });

    await tc('12.23', async () => {
      const s = (q: Record<string, unknown>) => t.http().get('/api/hotels/search').query({ city: 'cairo', checkIn: '2099-12-16', checkOut: '2099-12-17', ...q });
      check(!JSON.stringify((await s({ guests: 1, minRating: 1 })).body).includes(H.h), 'unrated hotel excluded by a rating filter');
      check(JSON.stringify((await s({ guests: 3, minPrice: 10000 })).body).includes(H.h), '3 guests: the cheapest qualifying room is B (12000)');
      check(!JSON.stringify((await s({ guests: 3, maxPrice: 9000 })).body).includes(H.h), '...so a max of 9000 excludes it');
      check(JSON.stringify((await s({ guests: 1, maxPrice: 5000 })).body).includes(H.h), '1 guest: room A (5000) qualifies, inclusive bound');
    });

    await tc('12.24', async () => {
      const r = await t.http().get(`/api/hotels/${H.h}/rooms/available`).query({ checkIn: '2099-12-26', checkOut: '2099-12-29' });
      const rooms = Array.isArray(r.body) ? r.body : r.body.data ?? r.body.rooms;
      const a = rooms.find((x: any) => x.name === 'A');
      check(a.pricePerNight === 5000 && a.nights === 3 && a.totalPrice === 15000, 'price per night and stay total', r);
    });

    await tc('12.25', async () => {
      const r = await U.agent.post('/api/hotel-bookings').send(stay(U, [{ roomId: H.ids[0], adults: 1 }, { roomId: H.ids[1], adults: 1, childAges: [5, 17] }], '2099-12-17', '2099-12-19'));
      check(r.status === 201, 'two rooms, one reservation', r);
      check(r.body.totalAmount === 2 * 5000 + 2 * 12000, `total = sum of nights x price (got ${r.body.totalAmount})`, r);
      const bad = [
        ['child age 18', [{ roomId: H.ids[2], adults: 1, childAges: [18] }]],
        ['only children', [{ roomId: H.ids[2], adults: 0, childAges: [8] }]],
        ['over occupancy', [{ roomId: H.ids[0], adults: 2 }]],
      ] as const;
      for (const [what, rooms] of bad) {
        const x = await V.agent.post('/api/hotel-bookings').send(stay(V, rooms as any, '2099-12-29', '2099-12-30'));
        check(x.status === 400, `${what} -> 400`, x);
      }
    });

    await tc('12.26', async () => {
      const held = await V.agent.post('/api/hotel-bookings').send(stay(V, [{ roomId: H.ids[2], adults: 1 }], '2099-12-29', '2099-12-30'));
      check(held.status === 201, 'V holds room C', held);
      const both = await U.agent.post('/api/hotel-bookings').send(stay(U, [{ roomId: H.ids[0], adults: 1 }, { roomId: H.ids[2], adults: 1 }], '2099-12-29', '2099-12-30'));
      check(both.status === 409, 'one of two rooms taken -> whole request 409', both);
      const a = await U.agent.post('/api/hotel-bookings').send(stay(U, [{ roomId: H.ids[0], adults: 1 }], '2099-12-29', '2099-12-30'));
      check(a.status === 201, 'room A was not held by the refused request', a);
    });

    expect(results.filter((r) => !r.ok).map((r) => r.id)).toEqual([]);
  }, 480_000);
});
