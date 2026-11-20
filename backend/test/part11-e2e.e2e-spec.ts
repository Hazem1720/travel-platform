// TEMPORARY (test branch only): Milestone 1 test plan, Part 11 (end-to-end
// stories across modules), stories S1-S8 and the security sweep. Each story
// is one case: it passes only if every step works in order. Results are
// printed at the end.
import * as request from 'supertest';
import { Types } from 'mongoose';
import { FlightBooking } from '../src/flight-bookings/schemas/flight-booking.schema';
import { FlightBookingJobs } from '../src/flight-bookings/flight-booking.jobs';
import { HotelStayCompletionJob } from '../src/hotel-bookings/hotel-stay-completion.job';
import { SUPPORTED_CURRENCIES } from '../src/common/constants/currencies';
import { createTestApp, TestApp } from './e2e/app';
import { Actor, admin, airlineModerator, hotelModerator, login, testEmail, traveler, TEST_PASSWORD } from './e2e/actors';
import { createAirline, createFlight, seedReference } from './e2e/fixtures';
import { paymentIntentEvent, signedWebhook } from './e2e/fakes';

type Res = request.Response;
const results: { id: string; ok: boolean; note: string }[] = [];
function check(cond: boolean, what: string, res?: Res) {
  if (!cond) {
    const got = res ? ` [got ${res.status} ${JSON.stringify(res.body).slice(0, 260)}]` : '';
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
const pax = (name: string) => ({ type: 'adult', fullName: name, dateOfBirth: '1990-01-01', passportNumber: 'A1234567' });
const idOf = (b: any) => String(b?._id ?? b?.id);
const today = () => new Date().toISOString().slice(0, 10);

describe('Test plan Part 11: end-to-end stories', () => {
  let t: TestApp;
  let adm: Actor;
  let airline: Types.ObjectId;
  let airMod: Actor;
  let hotel = '', hotMod!: Actor, roomId = '';
  // Everything created, for S8 and the sweep.
  const owned: { who: Actor; kind: 'flight-bookings' | 'hotel-bookings' | 'itineraries' | 'payments'; id: string }[] = [];

  async function webhookSuccess() {
    const intent = t.stripe.lastIntent()!;
    const { payload, signature } = signedWebhook(paymentIntentEvent('payment_intent.succeeded', t.stripe.succeed(intent.id)));
    const r = await t.http().post('/api/payments/webhook').set('Content-Type', 'application/json').set('stripe-signature', signature).send(payload);
    if (r.status !== 200) throw new Error(`webhook ${r.status}`);
  }
  async function payFlight(who: Actor, bookingId: string) {
    await who.agent.post(`/api/bookings/flight/${bookingId}/accept-policies`).send({ accepted: true }).expect(200);
    const p = await who.agent.post(`/api/bookings/flight/${bookingId}/pay`).expect(201);
    owned.push({ who, kind: 'payments', id: p.body.paymentId });
    await webhookSuccess();
  }
  async function hold(who: Actor, out: string, ret?: string, name = 'TEST Pax') {
    const h = await who.agent.post('/api/flight-bookings/hold').send({ outboundFlightId: out, ...(ret ? { returnFlightId: ret } : {}), cabin: 'Economy', passengers: [pax(name)] });
    if (h.status === 201) owned.push({ who, kind: 'flight-bookings', id: idOf(h.body) });
    return h;
  }
  async function stay(who: Actor, checkIn: string, checkOut: string) {
    const r = await who.agent.post('/api/hotel-bookings').send({ hotelId: hotel, checkIn, checkOut, rooms: [{ roomId, adults: 1, childAges: [] }] });
    if (r.status !== 201) throw new Error(`stay ${r.status} ${JSON.stringify(r.body)}`);
    owned.push({ who, kind: 'hotel-bookings', id: idOf(r.body) });
    await who.agent.post(`/api/bookings/hotel/${r.body._id}/accept-policies`).send({ accepted: true }).expect(200);
    await who.agent.post(`/api/bookings/hotel/${r.body._id}/pay`).expect(201);
    await webhookSuccess();
    return idOf(r.body);
  }
  const cabin = async (id: string) => (await t.model('Flight').findById(id).lean<any>()).cabins[0];
  const search = (date: string) => t.http().get('/api/flights/search').query({ from: 'CAI', to: 'DXB', date, passengers: 1 });

  beforeAll(async () => {
    t = await createTestApp('part11-stories');
    await seedReference(t);
    const rates: Record<string, number> = {};
    for (const c of SUPPORTED_CURRENCIES) rates[c] = c === 'AED' ? 4 : 1;
    rates.USD = 1;
    await t.model('ExchangeRate').create({ date: today(), base: 'USD', rates, fetchedAt: new Date() });
    adm = await admin(t);
    airline = await createAirline(t, { cancellationTiers: [{ daysBefore: 0, refundPercent: 100 }] });
    airMod = await airlineModerator(t, airline);
    hotel = (await adm.agent.post('/api/hotels').send({ name: 'TEST Dubai Stay', address: '1 Marina', cityId: 'dubai', countryCode: 'AE', starClass: 4 })).body._id;
    hotMod = await hotelModerator(t, hotel);
    await hotMod.agent.put(`/api/hotels/${hotel}/policies`).send({ checkInTime: '14:00', checkOutTime: '12:00', cancellationTiers: [{ daysBefore: 0, refundPercent: 100 }] });
    roomId = idOf((await hotMod.agent.post(`/api/hotels/${hotel}/rooms`).send({ name: '1', type: 'Double', beds: 2, maxOccupancy: 2, pricePerNight: 10000 })).body);
    await hotMod.agent.post(`/api/hotels/${hotel}/rooms/${roomId}/availability`).send({ from: '2099-12-01', to: '2099-12-31' });
  }, 120_000);

  afterAll(async () => {
    const pass = results.filter((r) => r.ok).length;
    console.log(`\nPART 11 RESULTS: ${pass}/${results.length} passed\n` + results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.id}${r.note ? '  ' + r.note : ''}`).join('\n'));
    await t?.close();
  });

  it('runs stories S1-S8 and the security sweep', async () => {
    const OUT = String((await createFlight(t, { airlineId: airline, from: 'CAI', to: 'DXB', day: 10, price: 30000 }))._id);
    const BACK = String((await createFlight(t, { airlineId: airline, from: 'DXB', to: 'CAI', day: 14, price: 25000 }))._id);
    const CHEAP = String((await createFlight(t, { airlineId: airline, from: 'CAI', to: 'DXB', day: 11, price: 20000 }))._id);
    const DEAR = String((await createFlight(t, { airlineId: airline, from: 'CAI', to: 'DXB', day: 12, price: 40000 }))._id);
    let S: Actor;
    let RT = '';

    await tc('S1 happy traveller', async () => {
      const email = testEmail('sara');
      const reg = await t.http().post('/api/auth/register').send({ name: 'TEST Sara', email, password: TEST_PASSWORD, acceptTerms: true });
      check(reg.status === 201, '1 register', reg);
      const v = await t.http().get('/api/auth/verify-email').query({ token: t.outbox.token(email, 'verify-email') });
      check(v.status === 200, '2 verify email', v);
      S = await login(t, email, TEST_PASSWORD);
      const s = await t.http().get('/api/flights/search').query({ from: 'CAI', to: 'DXB', date: '2099-12-10', returnDate: '2099-12-14', passengers: 1 });
      check(JSON.stringify(s.body).includes(OUT) && JSON.stringify(s.body).includes(BACK), '3 round-trip search', s);
      const h = await hold(S, OUT, BACK, 'TEST Sara');
      check(h.status === 201 && h.body.totalAmount === 55000, '4 hold the round trip (30000 + 25000)', h);
      RT = idOf(h.body);
      const mails = t.outbox.to(email).length;
      await payFlight(S, RT);
      const b = await S.agent.get(`/api/flight-bookings/${RT}`);
      check(b.body.status === 'Confirmed' && !!b.body.reference, '5 accept policies, pay, Confirmed', b);
      check(t.outbox.to(email).length > mails, '6 confirmation email');
      const seat = await S.agent.patch(`/api/flight-bookings/${RT}/seat`).send({ segment: 0, passengerIndex: 0, seat: '1A' });
      check(seat.status === 200, '7 choose seat 1A', seat);
      const tk = await S.agent.get(`/api/flight-bookings/${RT}/e-ticket`);
      check(tk.status === 200 && /pdf/.test(tk.headers['content-type']), '8 e-ticket PDF', tk);
      const hb = await stay(S, '2099-12-10', '2099-12-14');
      check((await S.agent.get(`/api/hotel-bookings/${hb}`)).body.status === 'Confirmed', '9 hotel for the same dates, Confirmed');
      const it = await S.agent.post('/api/itineraries').send({ title: 'TEST Dubai week', countries: ['AE'], startDate: '2099-12-10' });
      check(it.status === 201, '10 itinerary', it);
      const I = idOf(it.body);
      owned.push({ who: S, kind: 'itineraries', id: I });
      for (let i = 0; i < 4; i++) await S.agent.post(`/api/itineraries/${I}/days`).send({ cityId: 'dubai' }).expect(201);
      const day1 = idOf((await S.agent.get(`/api/itineraries/${I}`)).body.days[0]);
      const lf = await S.agent.post(`/api/itineraries/${I}/bookings`).send({ type: 'flight', bookingId: RT, dayId: day1 });
      const lh = await S.agent.post(`/api/itineraries/${I}/bookings`).send({ type: 'hotel', bookingId: hb, dayId: day1 });
      check(lf.status === 201 && lh.status === 201, '11 link both bookings', lf.status === 201 ? lh : lf);
      const sum = await S.agent.get(`/api/itineraries/${I}/budget-summary`);
      const total = Number(sum.body.total?.amount ?? sum.body.total);
      check(Math.abs(total - 950) < 0.01, `12 budget shows both: 550 + 400 = 950 USD (got ${total})`, sum);
    });

    await tc('S2 change of plans', async () => {
      const before = { out: (await cabin(OUT)).bookedSeats, cheap: (await cabin(CHEAP)).bookedSeats, dear: (await cabin(DEAR)).bookedSeats };
      const c1 = await S.agent.patch(`/api/flight-bookings/${RT}/change-flight`).send({ outboundFlightId: CHEAP, returnFlightId: BACK });
      check(c1.status === 200 && c1.body.difference === -10000 && c1.body.refund?.amount === 10000, '1 cheaper outbound, 10000 refunded', c1);
      const c2 = await S.agent.patch(`/api/flight-bookings/${RT}/change-flight`).send({ outboundFlightId: DEAR, returnFlightId: BACK });
      check(c2.status === 200 && c2.body.amountDue === 20000, '2 dearer outbound waits for 20000', c2);
      const p = await S.agent.post('/api/payments').send({ bookingType: 'flight-change', bookingId: c2.body.changeId });
      check(p.status === 201, '3 pay the difference', p);
      await webhookSuccess();
      const b = await S.agent.get(`/api/flight-bookings/${RT}`);
      check(b.body.totalAmount === 65000, `4 booking now 40000 + 25000 = 65000 (got ${b.body.totalAmount})`, b);
      const q = await S.agent.get(`/api/flight-bookings/${RT}/cancellation`);
      const x = await S.agent.post(`/api/flight-bookings/${RT}/cancel`).send({ refundAmount: q.body.refundAmount });
      check(x.status === 200 && x.body.refund?.amount === 65000, '5 cancel: refund 65000', x);
      const refunds = await t.model('Refund').find({ bookingId: new Types.ObjectId(RT) }).lean<any[]>();
      const paid = await t.model('Payment').find({ $or: [{ bookingId: new Types.ObjectId(RT) }, { parentBookingId: new Types.ObjectId(RT) }], status: 'Succeeded' }).lean<any[]>();
      const sum = (xs: any[]) => xs.reduce((n, r) => n + r.amount, 0);
      check(sum(refunds) === sum(paid), `6 refunded ${sum(refunds)} = paid ${sum(paid)}`);
      const after = { out: (await cabin(OUT)).bookedSeats, cheap: (await cabin(CHEAP)).bookedSeats, dear: (await cabin(DEAR)).bookedSeats };
      check(after.out === before.out - 1 && after.cheap === before.cheap && after.dear === before.dear, `7 seats freed on all three flights (${JSON.stringify(before)} -> ${JSON.stringify(after)})`);
      check((await cabin(BACK)).bookedSeats === 0, '8 return seat freed');
    });

    await tc('S3 airline trouble', async () => {
      const F = String((await createFlight(t, { airlineId: airline, day: 20, price: 12000 }))._id);
      const A = await traveler(t, 'TEST Ali');
      const B = await traveler(t, 'TEST Bea');
      const C = await traveler(t, 'TEST Cy');
      const a = await hold(A, F); await payFlight(A, idOf(a.body));
      const b = await hold(B, F); await payFlight(B, idOf(b.body));
      const c = await hold(C, F);
      const r = await airMod.agent.post(`/api/flights/${F}/cancel`).send({});
      check(r.status === 200 && r.body.cancelledBookings === 2 && r.body.releasedHolds === 1, '1 cancel: 2 bookings, 1 hold', r);
      for (const [who, id] of [[A, idOf(a.body)], [B, idOf(b.body)]] as const) {
        const d = await who.agent.get(`/api/flight-bookings/${id}`);
        check(d.body.status === 'Cancelled', '2 booking Cancelled', d);
        const refund = await t.model('Refund').findOne({ bookingId: new Types.ObjectId(id) }).lean<any>();
        check(refund?.amount === 12000, '3 refunded 100%');
        check(/cancel/i.test(JSON.stringify((await who.agent.get('/api/notifications')).body)), '4 notified');
      }
      check((await t.model(FlightBooking.name).findById(idOf(c.body)).lean<any>()).status !== 'PendingPayment', '5 hold released');
      check(!JSON.stringify((await search('2099-12-20')).body).includes(F), '6 no longer searchable');
    });

    await tc('S4 last seat race', async () => {
      const F = String((await createFlight(t, { airlineId: airline, day: 21, seats: 1, price: 9000 }))._id);
      const A = await traveler(t, 'TEST Ana');
      const B = await traveler(t, 'TEST Ben');
      const [ra, rb] = await Promise.all([hold(A, F), hold(B, F)]);
      const codes = [ra.status, rb.status].sort();
      check(codes[0] === 201 && codes[1] === 409, `1 one wins, one 409 (${codes})`);
      check(!JSON.stringify((await search('2099-12-21')).body).includes(F), '2 the loser no longer finds the flight');
      const win = ra.status === 201 ? ra : rb;
      await t.model(FlightBooking.name).updateOne({ _id: win.body._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
      await t.app.get(FlightBookingJobs).expireHolds();
      check((await cabin(F)).heldSeats === 0, '3 the hold expires, the seat comes back');
      check(JSON.stringify((await search('2099-12-21')).body).includes(F), '4 searchable again');
    });

    await tc('S5 hotel stay and review', async () => {
      const G = await traveler(t, 'TEST Gigi');
      const hb = await stay(G, '2099-12-20', '2099-12-22');
      const res = await hotMod.agent.get(`/api/hotels/${hotel}/reservations`);
      check(JSON.stringify(res.body).includes(hb), '1 the moderator sees the reservation', res);
      await t.app.get(HotelStayCompletionJob).completeStays(new Date('2099-12-23T12:00:00Z'));
      check((await G.agent.get(`/api/hotel-bookings/${hb}`)).body.status === 'Completed', '2 Completed after check-out');
      const rv = await G.agent.post(`/api/hotel-bookings/${hb}/review`).send({ rating: 5, text: 'TEST lovely' });
      check(rv.status === 201, '3 review', rv);
      const rp = await hotMod.agent.post(`/api/reviews/${idOf(rv.body)}/reply`).send({ text: 'TEST thanks' });
      check(rp.status === 201 || rp.status === 200, '4 reply', rp);
      check(/repl/i.test(JSON.stringify((await G.agent.get('/api/notifications')).body)), '5 guest notified');
      const s = await t.http().get('/api/hotels/search').query({ city: 'dubai', checkIn: '2099-12-27', checkOut: '2099-12-28', guests: 1, minRating: 5 });
      check(JSON.stringify(s.body).includes(hotel), '6 rating shows in search (min rating 5)', s);
    });

    await tc('S6 bad content', async () => {
      const A = await traveler(t, 'TEST Author');
      const B = await traveler(t, 'TEST Troll');
      const p = await A.agent.post('/api/posts').send({ title: 'TEST my trip', body: 'TEST nice', status: 'Published' });
      const c = await B.agent.post(`/api/posts/${idOf(p.body)}/comments`).send({ body: 'TEST rude words' });
      check(c.status === 201, '1 rude comment', c);
      const r = await A.agent.post('/api/reports').send({ targetType: 'comment', targetId: idOf(c.body), reason: 'TEST rude' });
      check(r.status === 201, '2 reported', r);
      const h = await adm.agent.patch(`/api/admin/reports/${idOf(r.body)}`).send({ action: 'hide' });
      check(h.status === 200, '3 admin hides it', h);
      const list = await t.http().get(`/api/posts/${idOf(p.body)}/comments`);
      check(!JSON.stringify(list.body).includes('TEST rude words'), '4 gone from the public post', list);
      const log = await adm.agent.get('/api/admin/audit-logs');
      check(/hid/i.test(JSON.stringify(log.body)), '5 in the audit log', log);
    });

    await tc('S7 account lifecycle', async () => {
      const L = await traveler(t, 'TEST Lena');
      const F = String((await createFlight(t, { airlineId: airline, day: 25, price: 10000 }))._id);
      const b = await hold(L, F); await payFlight(L, idOf(b.body));
      const it = await L.agent.post('/api/itineraries').send({ title: 'TEST Lena public trip', countries: ['AE'], startDate: '2099-12-10' });
      await L.agent.patch(`/api/itineraries/${idOf(it.body)}`).send({ visibility: 'Public' }).expect(200);
      const post = await L.agent.post('/api/posts').send({ title: 'TEST Lena post', body: 'x', status: 'Published' });
      const d1 = await L.agent.delete('/api/users/me');
      check(d1.status === 409, '1 deactivation refused with a booking ahead', d1);
      const q = await L.agent.get(`/api/flight-bookings/${idOf(b.body)}/cancellation`);
      await L.agent.post(`/api/flight-bookings/${idOf(b.body)}/cancel`).send({ refundAmount: q.body.refundAmount }).expect(200);
      const d2 = await L.agent.delete('/api/users/me');
      check(d2.status === 200, '2 deactivated after cancelling', d2);
      const lg = await t.http().post('/api/auth/login').send({ email: L.email, password: TEST_PASSWORD });
      check(lg.status === 401 || lg.status === 403, '3 login refused', lg);
      check((await t.http().get(`/api/itineraries/public/${idOf(it.body)}`)).status === 404, '4 public itinerary gone');
      check((await t.http().get(`/api/posts/${idOf(post.body)}`)).status === 404, '5 post gone');
      const re = await adm.agent.patch(`/api/admin/accounts/${L.id}/reactivate`);
      return `admin reactivating a self-deactivated account: ${re.status} (the spec does not require it)`;
    });

    await tc('S8 admin month', async () => {
      const a = await adm.agent.get('/api/admin/analytics').query({ from: today(), to: today() });
      check(a.status === 200, '1 analytics', a);
      const sum = (xs: any[]) => xs.reduce((n, r) => n + r.amount, 0);
      const paid = sum(await t.model('Payment').find({ status: 'Succeeded' }).lean<any[]>());
      const refunded = sum(await t.model('Refund').find({ status: { $ne: 'Failed' } }).lean<any[]>());
      check(a.body.totals.grossRevenue === paid, `2 gross ${a.body.totals.grossRevenue} = all payments ${paid}`, a);
      check(a.body.totals.refunded === refunded, `3 refunded ${a.body.totals.refunded} = all refunds ${refunded}`, a);
      const all = await adm.agent.get('/api/admin/bookings').query({ page: 1 });
      const total = (await t.model(FlightBooking.name).countDocuments()) + (await t.model('HotelBooking').countDocuments());
      check(all.body.meta.total === total, `4 all-bookings lists every booking (${all.body.meta.total} of ${total})`, all);
      return `gross ${paid}, refunded ${refunded}`;
    });

    await tc('Security sweep', async () => {
      const other = await traveler(t, 'TEST Stranger');
      const bad: string[] = [];
      for (const o of owned) {
        if (!o.id || o.id === 'undefined') continue;
        const path = `/api/${o.kind}/${o.id}`;
        const mine = await o.who.agent.get(path);
        const theirs = await other.agent.get(path);
        const anon = await t.http().get(path);
        const mod = await airMod.agent.get(path);
        if (![200, 401, 403].includes(mine.status)) bad.push(`${path} owner ${mine.status}`);
        if (theirs.status !== 404) bad.push(`${path} other user ${theirs.status}`);
        if (anon.status !== 401) bad.push(`${path} logged out ${anon.status}`);
        if (mod.status !== 403 && mod.status !== 404) bad.push(`${path} moderator ${mod.status}`);
      }
      check(bad.length === 0, bad.join('; '));
      return `${owned.length} resources x 4 callers`;
    });

    expect(results.filter((r) => !r.ok).map((r) => r.id)).toEqual([]);
  }, 400_000);
});
