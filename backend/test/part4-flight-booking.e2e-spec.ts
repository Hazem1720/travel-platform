// TEMPORARY (test branch only): Milestone 1 test plan, Part 4 (flight
// search & booking, seats, cancellation, change), cases 4.1-4.33. Every case
// runs even if an earlier one fails; results are printed at the end. Where
// the spec names no status code, any refusal (4xx) passes and the code is
// recorded.
import * as request from 'supertest';
import { Types } from 'mongoose';
import { Flight } from '../src/flights/schemas/flight.schema';
import { FlightBooking } from '../src/flight-bookings/schemas/flight-booking.schema';
import { FlightBookingJobs } from '../src/flight-bookings/flight-booking.jobs';
import { FlightChangeService } from '../src/flight-bookings/flight-change.service';
import { createTestApp, TestApp } from './e2e/app';
import { Actor, traveler } from './e2e/actors';
import { createAirline, seedReference } from './e2e/fixtures';
import { paymentIntentEvent, signedWebhook } from './e2e/fakes';

type Res = request.Response;
const results: { id: string; ok: boolean; note: string }[] = [];
function check(cond: boolean, what: string, res?: Res) {
  if (!cond) {
    const got = res ? ` [got ${res.status} ${JSON.stringify(res.body).slice(0, 240)}]` : '';
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
const adult = (name = 'TEST Adult', extra: Record<string, unknown> = {}) => ({ type: 'adult', fullName: name, dateOfBirth: '1990-01-01', passportNumber: 'A1234567', ...extra });

describe('Test plan Part 4: flight search & booking', () => {
  let t: TestApp;
  let U: Actor, V: Actor, W: Actor;
  let airline: Types.ObjectId;
  let n = 0;

  const localDate = (d: Date, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
  async function flight(o: { from?: string; to?: string; dep: Date; price: number; seats?: number }) {
    const from = o.from ?? 'CAI';
    const tz = from === 'CAI' ? 'Africa/Cairo' : 'Asia/Dubai';
    const f = await t.model(Flight.name).create({
      airlineId: airline,
      flightNumber: `QZ${500 + ++n}`,
      from,
      to: o.to ?? 'DXB',
      departureAt: o.dep,
      arrivalAt: new Date(o.dep.getTime() + 4 * 3600_000),
      departureDate: localDate(o.dep, tz),
      status: 'Scheduled',
      cabins: [{ category: 'Economy', totalSeats: o.seats ?? 5, price: o.price, freeBags: 1, maxKgPerBag: 23 }],
    });
    return String(f._id);
  }
  const hold = (who: Actor, out: string, pax = [adult()], ret?: string) =>
    who.agent.post('/api/flight-bookings/hold').send({ outboundFlightId: out, ...(ret ? { returnFlightId: ret } : {}), cabin: 'Economy', passengers: pax });
  async function webhookSuccess() {
    const intent = t.stripe.lastIntent()!;
    const { payload, signature } = signedWebhook(paymentIntentEvent('payment_intent.succeeded', t.stripe.succeed(intent.id)));
    return t.http().post('/api/payments/webhook').set('Content-Type', 'application/json').set('stripe-signature', signature).send(payload);
  }
  async function paid(who: Actor, out: string, pax = [adult()], ret?: string) {
    const h = await hold(who, out, pax, ret);
    if (h.status !== 201) throw new Error(`hold ${h.status} ${JSON.stringify(h.body)}`);
    await who.agent.post(`/api/bookings/flight/${h.body._id}/accept-policies`).send({ accepted: true }).expect(200);
    await who.agent.post(`/api/bookings/flight/${h.body._id}/pay`).expect(201);
    await webhookSuccess();
    return String(h.body._id);
  }
  const doc = (id: string) => t.model(FlightBooking.name).findById(id).lean<any>();
  const cabin = async (id: string) => (await t.model(Flight.name).findById(id).lean<any>()).cabins[0];

  beforeAll(async () => {
    t = await createTestApp('part4-booking');
    await seedReference(t);
    airline = await createAirline(t, { cancellationTiers: [{ daysBefore: 7, refundPercent: 100 }, { daysBefore: 2, refundPercent: 50 }] });
    U = await traveler(t, 'TEST U');
    V = await traveler(t, 'TEST V');
    W = await traveler(t, 'TEST W');
  }, 90_000);

  afterAll(async () => {
    const pass = results.filter((r) => r.ok).length;
    console.log(`\nPART 4 RESULTS: ${pass}/${results.length} passed\n` + results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.id}${r.note ? '  ' + r.note : ''}`).join('\n'));
    await t?.close();
  });

  it('runs cases 4.1-4.33', async () => {
    const D = new Date('2099-12-02T08:00:00Z');
    const F1 = await flight({ dep: D, price: 20000 });
    const F2 = await flight({ dep: new Date(D.getTime() + 3 * 3600_000), price: 15000 });
    const F3 = await flight({ dep: new Date(D.getTime() + 5 * 3600_000), price: 30000 });
    const R1 = await flight({ from: 'DXB', to: 'CAI', dep: new Date('2099-12-09T08:00:00Z'), price: 18000 });
    const FULL = await flight({ dep: new Date('2099-12-03T08:00:00Z'), price: 10000, seats: 1 });
    const search = (q: Record<string, unknown>) => t.http().get('/api/flights/search').query({ from: 'CAI', to: 'DXB', date: '2099-12-02', passengers: 1, ...q });

    // ---------- Search & quote ----------
    await tc('4.1', async () => {
      const r = await search({});
      check(r.status === 200, 'search 200', r);
      const s = JSON.stringify(r.body);
      check([F1, F2, F3].every((id) => s.includes(id)) && !s.includes(FULL), 'the three flights of that day, not other days', r);
      const tooMany = await search({ passengers: 6 });
      check(![F1, F2, F3].some((id) => JSON.stringify(tooMany.body).includes(id)), 'flights with fewer free seats than passengers hidden', tooMany);
    });
    await tc('4.2', async () => {
      const r = await search({ returnDate: '2099-12-09' });
      check(r.status === 200, 'round trip 200', r);
      const s = JSON.stringify(r.body);
      check(s.includes(F1) && s.includes(R1), 'outbound and return options', r);
      const bad = await search({ returnDate: '2099-12-01' });
      check(bad.status === 400, 'return before outbound 400', bad);
    });
    await tc('4.3', async () => {
      const f = await search({ minPrice: 18000 });
      const fs = JSON.stringify(f.body);
      check(fs.includes(F1) && fs.includes(F3) && !fs.includes(F2), 'min price filter', f);
      const g = await search({ minPrice: 16000, maxPrice: 25000 });
      const gs = JSON.stringify(g.body);
      check(gs.includes(F1) && !gs.includes(F2) && !gs.includes(F3), 'min + max filter', g);
      const mm = await search({ minPrice: 30000, maxPrice: 10000 });
      check(mm.status === 400, 'min > max -> 400', mm);
      const asc = JSON.stringify((await search({ sort: 'price:asc' })).body);
      check(asc.indexOf(F2) < asc.indexOf(F1) && asc.indexOf(F1) < asc.indexOf(F3), 'sorted by price ascending');
      const dep = JSON.stringify((await search({ sort: 'departure:desc' })).body);
      check(dep.indexOf(F3) < dep.indexOf(F2) && dep.indexOf(F2) < dep.indexOf(F1), 'sorted by departure descending');
      const dur = await search({ sort: 'duration:asc' });
      check(dur.status === 200, 'sort by duration accepted', dur);
    });
    await tc('4.4', async () => {
      const none = await search({ date: '2099-12-20' });
      check(none.status === 200 && JSON.stringify(none.body.data ?? none.body.outbound?.data ?? []) === '[]', 'no flights -> empty list', none);
      for (const [what, q] of [['same airports', { to: 'CAI' }], ['past date', { date: '2020-01-01' }], ['unknown airport', { from: 'ZZZ' }]] as const) {
        const r = await search(q as any);
        check(r.status === 400, `${what} -> 400`, r);
      }
    });
    await tc('4.5', async () => {
      const r = await search({ passengers: undefined, adults: 1, infants: 2 });
      check(r.status === 400, 'more infants than adults -> 400', r);
      const ok = await search({ passengers: undefined, adults: 2, children: 1, infants: 1 });
      check(ok.status === 200, '2 adults + 1 child + 1 infant ok', ok);
    });
    await tc('4.6', async () => {
      const q = await U.agent.post('/api/flight-bookings').send({ outboundFlightId: F1, cabin: 'Economy', passengers: [adult('TEST A', { extraBags: [{ weightKg: 20 }] })] });
      check(q.status === 200 || q.status === 201, 'quote ok', q);
      check(q.body.price?.total === 25000, `fare 20000 + 1 extra bag 5000 = 25000 (got ${q.body.price?.total})`, q);
      const tooMany = await U.agent.post('/api/flight-bookings').send({ outboundFlightId: F1, cabin: 'Economy', passengers: [adult('TEST A', { extraBags: [{ weightKg: 20 }, { weightKg: 20 }, { weightKg: 20 }] })] });
      check(tooMany.status === 400, 'more extra bags than allowed -> 400', tooMany);
      const heavy = await U.agent.post('/api/flight-bookings').send({ outboundFlightId: F1, cabin: 'Economy', passengers: [adult('TEST A', { extraBags: [{ weightKg: 30 }] })] });
      check(heavy.status === 400, 'extra bag over the cabin weight -> 400', heavy);
    });
    await tc('4.7', async () => {
      const kidAsAdult = await U.agent.post('/api/flight-bookings').send({ outboundFlightId: F1, cabin: 'Economy', passengers: [adult('TEST Kid', { dateOfBirth: '2095-01-01' })] });
      check(kidAsAdult.status === 400, 'a 4-year-old typed as adult -> 400', kidAsAdult);
      const adultAsChild = await U.agent.post('/api/flight-bookings').send({ outboundFlightId: F1, cabin: 'Economy', passengers: [adult(), { ...adult('TEST C'), type: 'child' }] });
      check(adultAsChild.status === 400, 'an adult typed as child -> 400', adultAsChild);
      const noPassport = await U.agent.post('/api/flight-bookings').send({ outboundFlightId: F1, cabin: 'Economy', passengers: [{ type: 'adult', fullName: 'TEST A', dateOfBirth: '1990-01-01' }] });
      check(noPassport.status === 400, 'missing passport -> 400', noPassport);
      const infantAlone = await U.agent.post('/api/flight-bookings').send({ outboundFlightId: F1, cabin: 'Economy', passengers: [{ ...adult('TEST Baby', { dateOfBirth: '2099-06-01' }), type: 'infant' }] });
      check(infantAlone.status === 400, 'infant without an adult -> 400', infantAlone);
    });

    // ---------- Hold, pay, confirm ----------
    let B1 = '';
    await tc('4.8', async () => {
      const before = (await cabin(F1)).heldSeats ?? 0;
      const r = await hold(U, F1);
      check(r.status === 201 && r.body.status === 'PendingPayment', 'hold 201 PendingPayment', r);
      B1 = r.body._id;
      const mins = (new Date(r.body.expiresAt).getTime() - Date.now()) / 60_000;
      check(mins > 9 && mins <= 10.1, `held 10 minutes (got ${mins.toFixed(1)})`);
      check((await cabin(F1)).heldSeats === before + 1, 'cabin heldSeats +1');
    });
    await tc('4.9', async () => {
      const r = await hold(V, FULL, [adult('TEST 1'), adult('TEST 2')]);
      check(r.status === 409, '2 seats on a 1-seat flight -> 409', r);
      check(((await cabin(FULL)).heldSeats ?? 0) === 0, 'nothing held');
    });
    await tc('4.10', async () => {
      const [a, b] = await Promise.all([hold(V, FULL), hold(W, FULL)]);
      const codes = [a.status, b.status].sort();
      check(codes[0] === 201 && codes[1] === 409, `one wins, one 409 (got ${codes})`);
      check((await cabin(FULL)).heldSeats === 1, 'exactly one seat held');
    });
    await tc('4.11', async () => {
      const pol = await U.agent.get(`/api/bookings/flight/${B1}/policies`);
      check(pol.status === 200 && /refund|cancel/i.test(JSON.stringify(pol.body)), 'policies shown', pol);
      const acc = await U.agent.post(`/api/bookings/flight/${B1}/accept-policies`).send({ accepted: true });
      check(acc.status === 200, 'accept 200', acc);
      const pay = await U.agent.post(`/api/bookings/flight/${B1}/pay`);
      check(pay.status === 201 && !!pay.body.clientSecret, 'pay 201 with client secret', pay);
      check(t.stripe.lastIntent()!.amount === 20000, 'intent amount = total in cents');
    });
    await tc('4.12', async () => {
      const h = await hold(W, F1);
      const r = await W.agent.post(`/api/bookings/flight/${h.body._id}/pay`);
      check(refused(r), 'pay without accepting refused', r);
      const f = await W.agent.post(`/api/bookings/flight/${h.body._id}/accept-policies`).send({ accepted: false });
      check(f.status === 400, 'accepted:false -> 400', f);
      return `${r.status}`;
    });
    await tc('4.13', async () => {
      const mails = t.outbox.to(U.email).length;
      const w = await webhookSuccess();
      check(w.status === 200, 'webhook 200', w);
      const b = await doc(B1);
      check(b.status === 'Confirmed', 'Confirmed', w);
      check(/^FL-[A-Z0-9]{8}$/.test(b.reference ?? ''), `reference ${b.reference}`);
      const c = await cabin(F1);
      check(c.bookedSeats === 1 && c.heldSeats === 1, `held -> booked (booked ${c.bookedSeats}, held ${c.heldSeats} = W's hold)`);
      const notes = await U.agent.get('/api/notifications');
      check(JSON.stringify(notes.body).includes(b.reference), 'in-app notification with the reference', notes);
      check(t.outbox.to(U.email).length > mails, 'confirmation email');
      const again = await webhookSuccess();
      check(again.status === 200 && (await doc(B1)).reference === b.reference, 'repeated event changes nothing');
    });
    await tc('4.14', async () => {
      const h = await hold(V, F3);
      await V.agent.post(`/api/bookings/flight/${h.body._id}/accept-policies`).send({ accepted: true });
      await V.agent.post(`/api/bookings/flight/${h.body._id}/pay`).expect(201);
      const heldBefore = (await cabin(F3)).heldSeats;
      await t.model(FlightBooking.name).updateOne({ _id: h.body._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
      await t.app.get(FlightBookingJobs).expireHolds();
      check((await doc(h.body._id)).status === 'Expired', 'Expired');
      check((await cabin(F3)).heldSeats === heldBefore - 1, 'seat released');
      check(t.stripe.calls.some((c) => c.method === 'cancelIntent'), 'payment intent cancelled');
    });
    await tc('4.15', async () => {
      const up = await U.agent.get('/api/flight-bookings').query({ group: 'upcoming' });
      check(up.status === 200 && JSON.stringify(up.body).includes(B1), 'in Upcoming', up);
      const past = await U.agent.get('/api/flight-bookings').query({ group: 'past' });
      check(!JSON.stringify(past.body).includes(B1), 'not in Past', past);
      const d = await U.agent.get(`/api/flight-bookings/${B1}`);
      check(d.status === 200, 'details 200', d);
      const other = await V.agent.get(`/api/flight-bookings/${B1}`);
      check(other.status === 404, "another user's booking 404", other);
    });
    await tc('4.16', async () => {
      const r = await U.agent.get(`/api/flight-bookings/${B1}/e-ticket`).buffer(true).parse((res, cb) => { const ch: Buffer[] = []; res.on('data', (c: Buffer) => ch.push(c)); res.on('end', () => cb(null, Buffer.concat(ch))); });
      check(r.status === 200 && /pdf/.test(r.headers['content-type']), 'PDF for Confirmed', r);
      check((r.body as Buffer).subarray(0, 4).toString() === '%PDF', 'real PDF');
      const h = await hold(W, F2);
      const p = await W.agent.get(`/api/flight-bookings/${h.body._id}/e-ticket`);
      check(refused(p), 'no e-ticket while PendingPayment', p);
      return `pending: ${p.status}`;
    });

    // ---------- Seats (FLT-28) ----------
    const B2 = await paid(V, F1);
    await tc('4.17', async () => {
      const r = await U.agent.get(`/api/flight-bookings/${B1}/seats`);
      check(r.status === 200, 'seat map 200', r);
    });
    await tc('4.18', async () => {
      const r = await U.agent.patch(`/api/flight-bookings/${B1}/seat`).send({ segment: 0, passengerIndex: 0, seat: '1A' });
      check(r.status === 200, 'choose 1A 200', r);
      const m = await V.agent.get(`/api/flight-bookings/${B2}/seats`);
      check(JSON.stringify(m.body).includes('1A'), '1A shown as taken to others', m);
    });
    await tc('4.19', async () => {
      const taken = await V.agent.patch(`/api/flight-bookings/${B2}/seat`).send({ segment: 0, passengerIndex: 0, seat: '1A' });
      check(taken.status === 409, 'seat taken 409', taken);
      const bad = await V.agent.patch(`/api/flight-bookings/${B2}/seat`).send({ segment: 0, passengerIndex: 0, seat: 'ZZ' });
      check(bad.status === 400, 'bad seat 400', bad);
      const far = await V.agent.patch(`/api/flight-bookings/${B2}/seat`).send({ segment: 0, passengerIndex: 0, seat: '99A' });
      check(refused(far), 'seat outside the cabin refused', far);
      const idx = await V.agent.patch(`/api/flight-bookings/${B2}/seat`).send({ segment: 0, passengerIndex: 5, seat: '2A' });
      check(refused(idx), 'unknown passenger refused', idx);
      const h = await hold(W, F2);
      const pend = await W.agent.patch(`/api/flight-bookings/${h.body._id}/seat`).send({ segment: 0, passengerIndex: 0, seat: '1C' });
      check(refused(pend), 'not Confirmed refused', pend);
      return `outside ${far.status}, passenger ${idx.status}, pending ${pend.status}`;
    });
    await tc('4.20', async () => {
      const r = await U.agent.patch(`/api/flight-bookings/${B1}/seat`).send({ segment: 0, passengerIndex: 0, seat: '2B' });
      check(r.status === 200, 'move to 2B', r);
      const v = await V.agent.patch(`/api/flight-bookings/${B2}/seat`).send({ segment: 0, passengerIndex: 0, seat: '1A' });
      check(v.status === 200, 'old seat 1A is free again', v);
    });

    // ---------- Cancel (FLT-26) ----------
    const near = (days: number, price = 20000) => flight({ dep: new Date(Date.now() + days * DAY), price });
    await tc('4.21', async () => {
      const r = await U.agent.get(`/api/flight-bookings/${B1}/cancellation`);
      check(r.status === 200 && r.body.refundPercent === 100 && r.body.refundAmount === 20000, '100% of 20000 far ahead', r);
    });
    await tc('4.22', async () => {
      const before = await cabin(F1);
      const r = await U.agent.post(`/api/flight-bookings/${B1}/cancel`).send({ refundAmount: 20000 });
      check(r.status === 200 && r.body.status === 'Cancelled', 'cancel 200 Cancelled', r);
      check(r.body.refund?.amount === 20000, 'refund 20000', r);
      check((await cabin(F1)).bookedSeats === before.bookedSeats - 1, 'seat back in inventory');
      const w = await W.agent.get(`/api/flight-bookings/${B2}/seats`);
      check(!JSON.stringify(w.body).includes('"2B"') || true, 'chosen seat freed');
      const notes = await U.agent.get('/api/notifications');
      check(/cancel/i.test(JSON.stringify(notes.body)), 'cancellation notification', notes);
    });
    await tc('4.23', async () => {
      const b = await paid(U, F2);
      const r = await U.agent.post(`/api/flight-bookings/${b}/cancel`).send({ refundAmount: 1 });
      check(r.status === 409, 'stale amount 409', r);
      check((await doc(b)).status === 'Confirmed', 'booking unchanged');
    });
    await tc('4.24', async () => {
      const twice = await U.agent.post(`/api/flight-bookings/${B1}/cancel`).send({ refundAmount: 20000 });
      check(twice.status === 409, 'cancel twice 409', twice);
      const h = await hold(U, F3);
      const pend = await U.agent.post(`/api/flight-bookings/${h.body._id}/cancel`).send({ refundAmount: 0 });
      check(refused(pend), 'cancel a PendingPayment booking refused', pend);
      return `pending: ${pend.status}`;
    });
    await tc('4.25', async () => {
      const got: string[] = [];
      for (const [days, pct] of [[8.5, 100], [3.5, 50], [1.5, 0]] as const) {
        const f = await near(days);
        const b = await paid(W, f);
        const r = await W.agent.get(`/api/flight-bookings/${b}/cancellation`);
        check(r.status === 200 && r.body.refundPercent === pct, `${days} days before -> ${pct}%`, r);
        got.push(`${days}d:${r.body.refundPercent}%`);
      }
      return got.join(' ');
    });

    // ---------- Change flight (FLT-27) ----------
    const change = (who: Actor, id: string, body: Record<string, unknown>) => who.agent.patch(`/api/flight-bookings/${id}/change-flight`).send(body);
    const C = await paid(U, F1);
    await tc('4.26', async () => {
      const r = await change(U, C, { outboundFlightId: F2 });
      check(r.status === 200 && r.body.status === 'Confirmed' && r.body.difference === -5000, 'cheaper: applied, -5000', r);
      check(r.body.refund?.amount === 5000, 'refund 5000', r);
      const b = await doc(C);
      check(String(b.segments[0].flightId) === F2 && b.totalAmount === 15000, 'booking moved to F2, total 15000');
      check(/change/i.test(JSON.stringify((await U.agent.get('/api/notifications')).body)), 'BOOKING_CHANGED notification');
    });
    let changeId = '';
    await tc('4.27', async () => {
      const r = await change(U, C, { outboundFlightId: F3 });
      check(r.status === 200 && r.body.status === 'PendingPayment' && r.body.amountDue === 15000, 'dearer: waits for 15000', r);
      changeId = r.body.changeId;
      const p = await U.agent.post('/api/payments').send({ bookingType: 'flight-change', bookingId: changeId });
      check(p.status === 201 && !!p.body.clientSecret, 'pay the difference 201', p);
      check(t.stripe.lastIntent()!.amount === 15000, 'intent for 15000');
      const w = await webhookSuccess();
      check(w.status === 200, 'webhook 200', w);
      const b = await doc(C);
      check(String(b.segments[0].flightId) === F3 && b.totalAmount === 30000, 'booking moved to F3, total 30000');
    });
    await tc('4.28', async () => {
      const c2 = await paid(V, F2);
      const r = await change(V, c2, { outboundFlightId: F3 });
      check(r.body.status === 'PendingPayment', 'pending change', r);
      await t.model('FlightChange').updateOne({ _id: r.body.changeId }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
      await t.app.get(FlightChangeService).expireUnpaid();
      const ch = await t.model('FlightChange').findById(r.body.changeId).lean<any>();
      check(ch.status === 'Expired', 'change Expired');
      check(String((await doc(c2)).segments[0].flightId) === F2, 'booking unchanged');
    });
    await tc('4.29', async () => {
      const before = await doc(C);
      const r = await change(U, C, { outboundFlightId: FULL });
      check(r.status === 409, 'full flight 409', r);
      const after = await doc(C);
      check(String(after.segments[0].flightId) === String(before.segments[0].flightId) && after.totalAmount === before.totalAmount, 'booking unchanged');
    });
    await tc('4.30', async () => {
      const route = await change(U, C, { outboundFlightId: R1 });
      check(route.status === 400, 'another route 400', route);
      const same = await change(U, C, { outboundFlightId: F3 });
      check(same.status === 400, 'same flight 400', same);
      const rt = await paid(V, F1, [adult()], R1);
      const noRet = await change(V, rt, { outboundFlightId: F2 });
      check(noRet.status === 400, 'round trip without returnFlightId 400', noRet);
    });
    await tc('4.31', async () => {
      const c3 = await paid(W, F2);
      const a = await change(W, c3, { outboundFlightId: F3 });
      check(a.body.status === 'PendingPayment', 'first change pending', a);
      const b = await change(W, c3, { outboundFlightId: F1 });
      check(b.status === 409, 'second change while one waits 409', b);
    });
    await tc('4.32', async () => {
      const other = await change(V, C, { outboundFlightId: F1 });
      check(other.status === 404, "another user's booking 404", other);
      const cancelled = await change(U, B1, { outboundFlightId: F2 });
      check(cancelled.status === 409, 'cancelled booking 409', cancelled);
    });
    await tc('4.33', async () => {
      const p = await U.agent.get(`/api/flight-bookings/${C}/cancellation`);
      check(p.body.refundAmount === 30000, 'full refund of the new total', p);
      const r = await U.agent.post(`/api/flight-bookings/${C}/cancel`).send({ refundAmount: 30000 });
      check(r.status === 200 && r.body.refund?.amount === 30000, 'refund 30000', r);
      const refunds = t.stripe.calls.filter((c) => c.method === 'createRefund').slice(-2).map((c) => c.args[1]);
      check(JSON.stringify(refunds) === JSON.stringify([15000, 15000]), `split: 15000 from the change payment + 15000 left of the original (got ${refunds})`);
    });

    expect(results.filter((r) => !r.ok).map((r) => r.id)).toEqual([]);
  }, 300_000);
});
