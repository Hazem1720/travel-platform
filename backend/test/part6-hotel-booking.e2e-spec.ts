// TEMPORARY (test branch only): Milestone 1 test plan, Part 6 (hotel search,
// booking, cancellation, reviews and replies, favourites), cases 6.1-6.22.
// Every case runs even if an earlier one fails; results are printed at the
// end. Where the spec names no status code, any refusal (4xx) passes and the
// code is recorded.
import * as request from 'supertest';
import { Types } from 'mongoose';
import { HotelBooking } from '../src/hotel-bookings/schemas/hotel-booking.schema';
import { HotelBookingJobs } from '../src/hotel-bookings/hotel-booking.jobs';
import { HotelStayCompletionJob } from '../src/hotel-bookings/hotel-stay-completion.job';
import { createTestApp, TestApp } from './e2e/app';
import { Actor, admin, airlineModerator, hotelModerator, traveler } from './e2e/actors';
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
const Y = 2099;
const DAY = 86_400_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

describe('Test plan Part 6: hotel search, booking & reviews', () => {
  let t: TestApp;
  let adm: Actor, U: Actor, V: Actor, W: Actor;

  async function webhookSuccess() {
    const intent = t.stripe.lastIntent()!;
    const { payload, signature } = signedWebhook(paymentIntentEvent('payment_intent.succeeded', t.stripe.succeed(intent.id)));
    return t.http().post('/api/payments/webhook').set('Content-Type', 'application/json').set('stripe-signature', signature).send(payload);
  }
  const book = (who: Actor, hotelId: string, rooms: { roomId: string; adults: number; childAges?: number[] }[], checkIn: string, checkOut: string) =>
    who.agent.post('/api/hotel-bookings').send({ hotelId, checkIn, checkOut, rooms: rooms.map((r) => ({ childAges: [], ...r })) });
  async function paidStay(who: Actor, hotelId: string, roomId: string, checkIn: string, checkOut: string) {
    const r = await book(who, hotelId, [{ roomId, adults: 2 }], checkIn, checkOut);
    if (r.status !== 201) throw new Error(`booking ${r.status} ${JSON.stringify(r.body)}`);
    await who.agent.post(`/api/bookings/hotel/${r.body._id}/accept-policies`).send({ accepted: true }).expect(200);
    await who.agent.post(`/api/bookings/hotel/${r.body._id}/pay`).expect(201);
    await webhookSuccess();
    return String(r.body._id);
  }
  const doc = (id: string) => t.model(HotelBooking.name).findById(id).lean<any>();

  beforeAll(async () => {
    t = await createTestApp('part6-hotel-booking');
    await seedReference(t);
    adm = await admin(t);
    U = await traveler(t, 'TEST U');
    V = await traveler(t, 'TEST V');
    W = await traveler(t, 'TEST W');
  }, 90_000);

  afterAll(async () => {
    const pass = results.filter((r) => r.ok).length;
    console.log(`\nPART 6 RESULTS: ${pass}/${results.length} passed\n` + results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.id}${r.note ? '  ' + r.note : ''}`).join('\n'));
    await t?.close();
  });

  it('runs cases 6.1-6.22', async () => {
    // Three hotels in Cairo: A (4*, 10000/night, 1 single + 1 double),
    // B (5*, 25000/night), C (3*, 6000/night, rated low later).
    const hotel = async (name: string, star: number, rooms: [string, number, number][]) => {
      const h = (await adm.agent.post('/api/hotels').send({ name, address: '1 Nile St', cityId: 'cairo', countryCode: 'EG', starClass: star })).body._id;
      const mod = await hotelModerator(t, h);
      await mod.agent.put(`/api/hotels/${h}/policies`).send({ checkInTime: '14:00', checkOutTime: '12:00', cancellationTiers: [{ daysBefore: 7, refundPercent: 100 }, { daysBefore: 2, refundPercent: 50 }] }).expect(200);
      const ids: string[] = [];
      for (const [nm, occ, price] of rooms) {
        const r = await mod.agent.post(`/api/hotels/${h}/rooms`).send({ name: nm, type: 'Room', beds: occ, maxOccupancy: occ, pricePerNight: price });
        const id = r.body._id ?? r.body.id;
        await mod.agent.post(`/api/hotels/${h}/rooms/${id}/availability`).send({ from: ymd(new Date(Date.now() + DAY)), to: `${Y}-12-31` });
        ids.push(id);
      }
      return { h, mod, rooms: ids };
    };
    const A = await hotel('TEST Hotel A', 4, [['A1', 1, 10000], ['A2', 2, 10000]]);
    const B = await hotel('TEST Hotel B', 5, [['B1', 2, 25000]]);
    const C = await hotel('TEST Hotel C', 3, [['C1', 2, 6000]]);
    const search = (q: Record<string, unknown>) => t.http().get('/api/hotels/search').query({ city: 'cairo', checkIn: `${Y}-12-10`, checkOut: `${Y}-12-12`, guests: 2, ...q });

    await tc('6.1', async () => {
      const r = await search({});
      check(r.status === 200 && !!r.body.meta, 'search 200, paginated', r);
      const s = JSON.stringify(r.body);
      check([A.h, B.h, C.h].every((id) => s.includes(id)), 'all three hotels free those nights', r);
      const country = await t.http().get('/api/hotels/search').query({ country: 'EG', checkIn: `${Y}-12-10`, checkOut: `${Y}-12-12`, guests: 2 });
      check(JSON.stringify(country.body).includes(A.h), 'search by country works (HTL-11)', country);
      const twoRooms = await search({ rooms: 2, guests: 3 });
      const tr = JSON.stringify(twoRooms.body);
      check(tr.includes(A.h) && !tr.includes(B.h), '2 rooms: only the hotel with 2 free rooms', twoRooms);
    });

    await tc('6.2', async () => {
      const p = await search({ minPrice: 20000 });
      const ps = JSON.stringify(p.body);
      check(ps.includes(B.h) && !ps.includes(A.h) && !ps.includes(C.h), 'min price filter', p);
      const asc = JSON.stringify((await search({ sort: 'price:asc' })).body);
      check(asc.indexOf(C.h) < asc.indexOf(A.h) && asc.indexOf(A.h) < asc.indexOf(B.h), 'sorted by price ascending');
      const mm = await search({ minPrice: 30000, maxPrice: 1000 });
      check(mm.status === 400, 'min > max -> 400', mm);
      const rated = await search({ minRating: 1 });
      check(!JSON.stringify(rated.body).includes(A.h), 'unrated hotels excluded by a rating filter (HTL-12)', rated);
    });

    await tc('6.3', async () => {
      const notes: string[] = [];
      for (const [what, q] of [
        ['check-out before check-in', { checkIn: `${Y}-12-12`, checkOut: `${Y}-12-10` }],
        ['same day', { checkIn: `${Y}-12-12`, checkOut: `${Y}-12-12` }],
        ['past date', { checkIn: '2020-01-01', checkOut: '2020-01-03' }],
        ['bad date', { checkIn: '2099-13-01', checkOut: '2099-13-03' }],
        ['0 guests', { guests: 0 }],
      ] as const) {
        const r = await search(q as any);
        check(r.status === 400, `${what} -> 400`, r);
        notes.push(`${what}:${r.status}`);
      }
    });

    await tc('6.4', async () => {
      const r = await t.http().get(`/api/hotels/${A.h}/rooms/available`).query({ checkIn: `${Y}-12-10`, checkOut: `${Y}-12-13` });
      check(r.status === 200, 'available rooms 200', r);
      const rooms = Array.isArray(r.body) ? r.body : r.body.data ?? r.body.rooms;
      const a2 = rooms.find((x: any) => x.name === 'A2');
      check(!!a2 && a2.nights === 3 && a2.totalPrice === 30000 && a2.pricePerNight === 10000, 'per night and stay total (HTL-15)', r);
    });

    // ---------- Booking ----------
    let H1 = '';
    await tc('6.5', async () => {
      const r = await book(U, A.h, [{ roomId: A.rooms[1], adults: 2 }], `${Y}-12-10`, `${Y}-12-12`);
      check(r.status === 201 && r.body.status === 'PendingPayment', '201 PendingPayment', r);
      check(r.body.totalAmount === 20000, '2 nights x 10000', r);
      const mins = (new Date(r.body.expiresAt).getTime() - Date.now()) / 60_000;
      check(mins > 9 && mins <= 10.1, `held 10 minutes (got ${mins.toFixed(1)})`);
      H1 = r.body._id;
      const multi = await book(V, A.h, [{ roomId: A.rooms[0], adults: 1 }, { roomId: B.rooms[0], adults: 1 }], `${Y}-12-20`, `${Y}-12-21`);
      check(refused(multi), 'rooms of another hotel refused', multi);
    });

    await tc('6.6', async () => {
      const notes: string[] = [];
      for (const [what, rooms] of [
        ['guests above occupancy', [{ roomId: A.rooms[0], adults: 2 }]],
        ['child age 18', [{ roomId: A.rooms[1], adults: 1, childAges: [18] }]],
        ['no adult', [{ roomId: A.rooms[1], adults: 0, childAges: [5] }]],
      ] as const) {
        const r = await book(V, A.h, rooms as any, `${Y}-12-20`, `${Y}-12-21`);
        check(r.status === 400, `${what} -> 400`, r);
      }
      const taken = await book(V, A.h, [{ roomId: A.rooms[1], adults: 2 }], `${Y}-12-11`, `${Y}-12-13`);
      check(taken.status === 409, 'room not free (held by U) -> 409', taken);
      const closed = await book(V, A.h, [{ roomId: A.rooms[1], adults: 2 }], '2100-01-02', '2100-01-03');
      check(refused(closed), 'night outside the bookable range refused', closed);
      notes.push(`outside range:${closed.status}`);
      return notes.join(' ');
    });

    await tc('6.7', async () => {
      const [a, b] = await Promise.all([
        book(V, C.h, [{ roomId: C.rooms[0], adults: 2 }], `${Y}-12-15`, `${Y}-12-16`),
        book(W, C.h, [{ roomId: C.rooms[0], adults: 2 }], `${Y}-12-15`, `${Y}-12-16`),
      ]);
      const codes = [a.status, b.status].sort();
      check(codes[0] === 201 && codes[1] === 409, `one wins, one 409 (got ${codes})`);
      const whole = await book(W, A.h, [{ roomId: A.rooms[0], adults: 1 }, { roomId: A.rooms[1], adults: 2 }], `${Y}-12-11`, `${Y}-12-12`);
      check(whole.status === 409, 'one of two rooms taken -> whole request 409 (HTL-18)', whole);
      const a1 = await book(V, A.h, [{ roomId: A.rooms[0], adults: 1 }], `${Y}-12-11`, `${Y}-12-12`);
      check(a1.status === 201, 'the free room was not held by the refused request', a1);
    });

    await tc('6.8', async () => {
      const mails = t.outbox.to(U.email).length;
      const pol = await U.agent.get(`/api/bookings/hotel/${H1}/policies`);
      check(pol.status === 200 && JSON.stringify(pol.body).includes('14:00'), 'policies incl. check-in time', pol);
      await U.agent.post(`/api/bookings/hotel/${H1}/accept-policies`).send({ accepted: true }).expect(200);
      const pay = await U.agent.post(`/api/bookings/hotel/${H1}/pay`);
      check(pay.status === 201 && !!pay.body.clientSecret, 'pay 201', pay);
      await webhookSuccess();
      const b = await doc(H1);
      check(b.status === 'Confirmed' && /^[A-Z]{2}-[A-Z0-9]{8}$/.test(b.reference ?? ''), `Confirmed with reference ${b.reference}`);
      check(JSON.stringify((await U.agent.get('/api/notifications')).body).includes(b.reference), 'notification');
      check(t.outbox.to(U.email).length > mails, 'confirmation email');
    });

    await tc('6.9', async () => {
      const r = await book(W, B.h, [{ roomId: B.rooms[0], adults: 2 }], `${Y}-12-05`, `${Y}-12-06`);
      await t.model(HotelBooking.name).updateOne({ _id: r.body._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
      await t.app.get(HotelBookingJobs).expireHolds();
      check((await doc(r.body._id)).status === 'Expired', 'Expired');
      const again = await book(V, B.h, [{ roomId: B.rooms[0], adults: 2 }], `${Y}-12-05`, `${Y}-12-06`);
      check(again.status === 201, 'room free again', again);
    });

    await tc('6.10', async () => {
      const up = await U.agent.get('/api/hotel-bookings').query({ group: 'upcoming' });
      check(up.status === 200 && JSON.stringify(up.body).includes(H1), 'in Upcoming', up);
      const d = await U.agent.get(`/api/hotel-bookings/${H1}`);
      check(d.status === 200 && JSON.stringify(d.body).includes('14:00'), 'details with check-in time (HTL-09)', d);
      const other = await V.agent.get(`/api/hotel-bookings/${H1}`);
      check(other.status === 404, "another user's stay 404", other);
    });

    // ---------- Cancellation (HTL-21) ----------
    await tc('6.11', async () => {
      const far = await paidStay(V, B.h, B.rooms[0], `${Y}-12-20`, `${Y}-12-22`);
      const q = await V.agent.get(`/api/hotel-bookings/${far}/cancellation`);
      check(q.status === 200 && q.body.refundAmount === 50000, `100% of 50000 far ahead (got ${q.body.refundAmount})`, q);
      const soon = ymd(new Date(Date.now() + 3 * DAY));
      const near = await paidStay(W, C.h, C.rooms[0], soon, ymd(new Date(Date.now() + 4 * DAY)));
      const q2 = await W.agent.get(`/api/hotel-bookings/${near}/cancellation`);
      check(q2.body.refundAmount === 3000, `3 days before check-in -> 50% of 6000 (got ${q2.body.refundAmount}, ${q2.body.daysBeforeCheckIn} days)`, q2);
      (global as any).__far = far;
    });

    await tc('6.12', async () => {
      const far = (global as any).__far as string;
      const stale = await V.agent.post(`/api/hotel-bookings/${far}/cancel`).send({ refundAmount: 1 });
      check(stale.status === 409 && (await doc(far)).status === 'Confirmed', 'stale amount 409, unchanged', stale);
      const ok = await V.agent.post(`/api/hotel-bookings/${far}/cancel`).send({ refundAmount: 50000 });
      check(ok.status === 200 && ok.body.refund?.amount === 50000, 'cancelled with a 50000 refund', ok);
      check((await doc(far)).status === 'Cancelled', 'Cancelled');
      const again = await book(W, B.h, [{ roomId: B.rooms[0], adults: 2 }], `${Y}-12-20`, `${Y}-12-22`);
      check(again.status === 201, 'room free again', again);
    });

    await tc('6.13', async () => {
      const far = (global as any).__far as string;
      const twice = await V.agent.post(`/api/hotel-bookings/${far}/cancel`).send({ refundAmount: 50000 });
      check(twice.status === 409, 'cancel twice 409', twice);
      const other = await U.agent.post(`/api/hotel-bookings/${far}/cancel`).send({ refundAmount: 0 });
      check(other.status === 404, "another user's stay 404", other);
    });

    // ---------- Reviews (HTL-23/24) and replies (HTL-26) ----------
    let RV = '';
    await tc('6.15', async () => {
      const early = await U.agent.post(`/api/hotel-bookings/${H1}/review`).send({ rating: 5 });
      check(early.status === 409, 'before the stay is Completed -> 409', early);
      await t.app.get(HotelStayCompletionJob).completeStays(new Date(`${Y}-12-13T12:00:00Z`));
      check((await doc(H1)).status === 'Completed', 'Confirmed -> Completed after check-out (GEN-11)');
      const other = await V.agent.post(`/api/hotel-bookings/${H1}/review`).send({ rating: 1 });
      check(other.status === 404, "reviewing another user's stay 404", other);
    });

    await tc('6.14', async () => {
      const r = await U.agent.post(`/api/hotel-bookings/${H1}/review`).send({ rating: 4, text: 'TEST nice stay' });
      check(r.status === 201, 'review 201', r);
      RV = r.body._id ?? r.body.id;
      const twice = await U.agent.post(`/api/hotel-bookings/${H1}/review`).send({ rating: 5 });
      check(twice.status === 409, 'second review 409', twice);
    });

    await tc('6.16', async () => {
      for (const rating of [0, 6, 3.5]) {
        const r = await U.agent.patch(`/api/reviews/${RV}`).send({ rating });
        check(r.status === 400, `rating ${rating} -> 400`, r);
      }
      const long = await U.agent.patch(`/api/reviews/${RV}`).send({ text: 'x'.repeat(1001) });
      check(long.status === 400, '1001 characters -> 400', long);
    });

    await tc('6.17', async () => {
      const r = await t.http().get(`/api/hotels/${A.h}/reviews`);
      check(r.status === 200 && r.body.ratingAverage === 4 && r.body.ratingCount === 1, 'average 4 from 1 review', r);
      check(r.body.data[0].text === 'TEST nice stay' && !!r.body.meta, 'review shown, paginated', r);
      const s = await search({ minRating: 4, checkIn: `${Y}-12-24`, checkOut: `${Y}-12-25` });
      check(JSON.stringify(s.body).includes(A.h), 'now found with minRating 4', s);
    });

    await tc('6.18', async () => {
      const e = await U.agent.patch(`/api/reviews/${RV}`).send({ rating: 2 });
      check(e.status === 200, 'edit own review', e);
      check((await t.http().get(`/api/hotels/${A.h}/reviews`)).body.ratingAverage === 2, 'average recalculated to 2');
      const other = await V.agent.patch(`/api/reviews/${RV}`).send({ rating: 5 });
      check(other.status === 404, "another user's review 404", other);
      const del = await V.agent.delete(`/api/reviews/${RV}`);
      check(del.status === 404, "deleting another user's review 404", del);
    });

    await tc('6.19', async () => {
      const r = await A.mod.agent.post(`/api/reviews/${RV}/reply`).send({ text: 'TEST thank you' });
      check(r.status === 201 || r.status === 200, 'reply', r);
      const page = await t.http().get(`/api/hotels/${A.h}/reviews`);
      check(page.body.data[0].reply?.text === 'TEST thank you', 'reply shown under the review', page);
      check(/repl/i.test(JSON.stringify((await U.agent.get('/api/notifications')).body)), 'reviewer notified');
    });

    await tc('6.20', async () => {
      const twice = await A.mod.agent.post(`/api/reviews/${RV}/reply`).send({ text: 'again' });
      const blank = await A.mod.agent.post(`/api/reviews/${RV}/reply`).send({ text: '   ' });
      const unknown = await A.mod.agent.post(`/api/reviews/${new Types.ObjectId()}/reply`).send({ text: 'hi' });
      check(twice.status === 409 && blank.status === 400 && unknown.status === 404, `409/400/404 (got ${twice.status}/${blank.status}/${unknown.status})`);
    });

    await tc('6.21', async () => {
      const air = await airlineModerator(t, await createAirline(t));
      for (const [label, who] of [['other hotel', B.mod], ['user', U], ['airline moderator', air]] as const) {
        const r = await who.agent.post(`/api/reviews/${RV}/reply`).send({ text: 'x' });
        check(r.status === 403, `${label} -> 403`, r);
      }
    });

    await tc('6.18b', async () => {
      const del = await U.agent.delete(`/api/reviews/${RV}`);
      check(del.status === 200 || del.status === 204, 'delete own review', del);
      const page = await t.http().get(`/api/hotels/${A.h}/reviews`);
      check(page.body.ratingCount === 0, 'rating count back to 0', page);
    });

    await tc('6.22', async () => {
      const add = await U.agent.post('/api/favourites').send({ type: 'hotel', id: A.h });
      check(add.status === 201, 'favourite a hotel 201', add);
      const dup = await U.agent.post('/api/favourites').send({ type: 'hotel', id: A.h });
      check(refused(dup) || dup.status === 200, 'twice is not a second favourite', dup);
      const list = await U.agent.get('/api/favourites');
      check(list.status === 200 && JSON.stringify(list.body).split(A.h).length - 1 === 1, 'listed once', list);
      const favId = (list.body.data ?? list.body)[0]._id ?? (list.body.data ?? list.body)[0].id;
      const delOther = await V.agent.delete(`/api/favourites/${favId}`);
      check(delOther.status === 404, "removing another user's favourite 404", delOther);
      const del = await U.agent.delete(`/api/favourites/${favId}`);
      check(del.status === 204 || del.status === 200, 'removed', del);
      const unknown = await U.agent.post('/api/favourites').send({ type: 'hotel', id: String(new Types.ObjectId()) });
      check(unknown.status === 404, 'unknown hotel 404', unknown);
      return `duplicate: ${dup.status}`;
    });

    expect(results.filter((r) => !r.ok).map((r) => r.id)).toEqual([]);
  }, 300_000);
});
