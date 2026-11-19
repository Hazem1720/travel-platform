// TEMPORARY (test branch only): Milestone 1 test plan, Part 5 (hotels &
// rooms management), cases 5.1-5.19. Every case runs even if an earlier one
// fails; results are printed at the end. Where the spec names no status
// code, any refusal (4xx) passes and the code is recorded.
import * as request from 'supertest';
import { Types } from 'mongoose';
import { HotelBooking } from '../src/hotel-bookings/schemas/hotel-booking.schema';
import { createTestApp, TestApp } from './e2e/app';
import { Actor, admin, hotelModerator, traveler } from './e2e/actors';
import { seedReference } from './e2e/fixtures';
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
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const Y = 2099;

describe('Test plan Part 5: hotels & rooms management', () => {
  let t: TestApp;
  let adm: Actor, U: Actor, V: Actor;

  async function webhookSuccess() {
    const intent = t.stripe.lastIntent()!;
    const { payload, signature } = signedWebhook(paymentIntentEvent('payment_intent.succeeded', t.stripe.succeed(intent.id)));
    return t.http().post('/api/payments/webhook').set('Content-Type', 'application/json').set('stripe-signature', signature).send(payload);
  }
  const stay = (who: Actor, hotelId: string, roomId: string, checkIn: string, checkOut: string) =>
    who.agent.post('/api/hotel-bookings').send({ hotelId, checkIn, checkOut, rooms: [{ roomId, adults: 2, childAges: [] }] });
  async function paidStay(who: Actor, hotelId: string, roomId: string, checkIn: string, checkOut: string) {
    const r = await stay(who, hotelId, roomId, checkIn, checkOut);
    if (r.status !== 201) throw new Error(`booking ${r.status} ${JSON.stringify(r.body)}`);
    await who.agent.post(`/api/bookings/hotel/${r.body._id}/accept-policies`).send({ accepted: true }).expect(200);
    await who.agent.post(`/api/bookings/hotel/${r.body._id}/pay`).expect(201);
    await webhookSuccess();
    return String(r.body._id);
  }
  const booking = (id: string) => t.model(HotelBooking.name).findById(id).lean<any>();

  beforeAll(async () => {
    t = await createTestApp('part5-hotels');
    await seedReference(t);
    adm = await admin(t);
    U = await traveler(t, 'TEST U');
    V = await traveler(t, 'TEST V');
  }, 90_000);

  afterAll(async () => {
    const pass = results.filter((r) => r.ok).length;
    console.log(`\nPART 5 RESULTS: ${pass}/${results.length} passed\n` + results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.id}${r.note ? '  ' + r.note : ''}`).join('\n'));
    await t?.close();
  });

  it('runs cases 5.1-5.19', async () => {
    const hotelBody = (name: string, extra: Record<string, unknown> = {}) => ({ name, address: '1 Nile St', cityId: 'cairo', countryCode: 'EG', starClass: 4, ...extra });
    let H = '';
    await tc('5.1', async () => {
      const r = await adm.agent.post('/api/hotels').send(hotelBody('TEST Nile View', { description: 'TEST', amenities: ['wifi'] }));
      check(r.status === 201, 'create hotel 201', r);
      H = r.body._id;
    });
    const H2 = (await adm.agent.post('/api/hotels').send(hotelBody('TEST Other Hotel'))).body._id;
    const modX = await hotelModerator(t, H);
    const modY = await hotelModerator(t, H2);

    await tc('5.2', async () => {
      const notes: string[] = [];
      for (const [what, body] of [
        ['unknown city', hotelBody('TEST Bad', { cityId: 'atlantis' })],
        ['city in another country', hotelBody('TEST Bad', { countryCode: 'AE' })],
        ['star 0', hotelBody('TEST Bad', { starClass: 0 })],
        ['star 6', hotelBody('TEST Bad', { starClass: 6 })],
        ['no name', hotelBody('', {})],
      ] as const) {
        const r = await adm.agent.post('/api/hotels').send(body);
        check(r.status === 400, `${what} -> 400`, r);
      }
      for (const [who, label] of [[modX, 'hotel moderator'], [U, 'user']] as const) {
        const r = await who.agent.post('/api/hotels').send(hotelBody('TEST X'));
        check(r.status === 403, `${label} cannot create a hotel`, r);
        notes.push(`${label}:${r.status}`);
      }
      return notes.join(' ');
    });

    await tc('5.3', async () => {
      const r = await modX.agent.patch(`/api/hotels/${H}`).send({ description: 'TEST updated', amenities: ['wifi', 'pool'] });
      check(r.status === 200, 'edit own hotel 200', r);
      const v = await t.http().get(`/api/hotels/${H}`);
      check(JSON.stringify(v.body).includes('TEST updated') && JSON.stringify(v.body).includes('pool'), 'saved', v);
    });

    await tc('5.4', async () => {
      const y = await modY.agent.patch(`/api/hotels/${H}`).send({ description: 'hacked' });
      const u = await U.agent.patch(`/api/hotels/${H}`).send({ description: 'hacked' });
      check(y.status === 403 && u.status === 403, 'other moderator and user 403', y.status === 403 ? u : y);
    });

    await tc('5.5', async () => {
      const up = await modX.agent.post(`/api/hotels/${H}/images`).attach('images', PNG, 'a.png').attach('images', PNG, 'b.png');
      check(up.status === 201 || up.status === 200, 'upload 2 images', up);
      let v = await t.http().get(`/api/hotels/${H}`);
      check(v.body.images?.length === 2, 'two images on the hotel', v);
      const file = String(v.body.images[0]).split('/').pop();
      const del = await modX.agent.delete(`/api/hotels/${H}/images/${file}`);
      check(del.status === 200 || del.status === 204, 'delete image', del);
      v = await t.http().get(`/api/hotels/${H}`);
      check(v.body.images.length === 1, 'one image left', v);
      const many = modX.agent.post(`/api/hotels/${H}/images`);
      for (let i = 0; i < 5; i++) many.attach('images', PNG, `m${i}.png`);
      const r = await many;
      check(r.status === 400, 'more than 5 images in total refused (GEN-08)', r);
      const other = await modY.agent.post(`/api/hotels/${H}/images`).attach('images', PNG, 'x.png');
      check(other.status === 403, "another hotel's moderator 403", other);
    });

    await tc('5.6', async () => {
      const r = await modX.agent.put(`/api/hotels/${H}/policies`).send({ checkInTime: '14:00', checkOutTime: '12:00', cancellationTiers: [{ daysBefore: 3, refundPercent: 100 }, { daysBefore: 1, refundPercent: 50 }] });
      check(r.status === 200, 'policies 200', r);
      const v = await t.http().get(`/api/hotels/${H}`);
      const s = JSON.stringify(v.body);
      check(s.includes('14:00') && s.includes('12:00'), 'check-in/out times on the hotel page (HTL-09)', v);
    });

    await tc('5.7', async () => {
      const base = { checkInTime: '14:00', checkOutTime: '12:00', cancellationTiers: [{ daysBefore: 3, refundPercent: 100 }] };
      for (const [what, body] of [
        ['time 25:00', { ...base, checkInTime: '25:00' }],
        ['time 2pm', { ...base, checkOutTime: '2pm' }],
        ['percent 150', { ...base, cancellationTiers: [{ daysBefore: 3, refundPercent: 150 }] }],
        ['duplicate days', { ...base, cancellationTiers: [{ daysBefore: 3, refundPercent: 100 }, { daysBefore: 3, refundPercent: 50 }] }],
      ] as const) {
        const r = await modX.agent.put(`/api/hotels/${H}/policies`).send(body);
        check(r.status === 400, `${what} -> 400`, r);
      }
    });

    const room = (name: string, extra: Record<string, unknown> = {}) => ({ name, type: 'Double', beds: 2, maxOccupancy: 3, pricePerNight: 10000, ...extra });
    let R1 = '';
    await tc('5.8', async () => {
      const r = await modX.agent.post(`/api/hotels/${H}/rooms`).send(room('101'));
      check(r.status === 201, 'add room 201', r);
      R1 = r.body._id ?? r.body.id;
      check(!!R1, 'room id returned', r);
    });
    const R2 = (await modX.agent.post(`/api/hotels/${H}/rooms`).send(room('102'))).body;
    const R2id = R2._id ?? R2.id;

    await tc('5.9', async () => {
      const notes: string[] = [];
      for (const [what, extra] of [['occupancy 0', { maxOccupancy: 0 }], ['beds 0', { beds: 0 }], ['price 0', { pricePerNight: 0 }], ['price -5', { pricePerNight: -5 }], ['price 99.5', { pricePerNight: 99.5 }]] as const) {
        const r = await modX.agent.post(`/api/hotels/${H}/rooms`).send(room('199', extra));
        check(r.status === 400, `${what} -> 400`, r);
      }
      const dup = await modX.agent.post(`/api/hotels/${H}/rooms`).send(room('101'));
      check(refused(dup), 'duplicate room name refused', dup);
      notes.push(`duplicate:${dup.status}`);
      const other = await modY.agent.post(`/api/hotels/${H}/rooms`).send(room('150'));
      check(other.status === 403, "another hotel's moderator 403", other);
      return notes.join(' ');
    });

    await tc('5.12', async () => {
      for (const id of [R1, R2id]) {
        const r = await modX.agent.post(`/api/hotels/${H}/rooms/${id}/availability`).send({ from: `${Y}-12-01`, to: `${Y}-12-31` });
        check(r.status === 201 || r.status === 200, 'add availability range', r);
      }
    });

    await tc('5.13', async () => {
      const over = await modX.agent.post(`/api/hotels/${H}/rooms/${R1}/availability`).send({ from: `${Y}-12-20`, to: `${Y}-12-31` });
      check(refused(over), 'overlapping range refused (HTL-04)', over);
      const rev = await modX.agent.post(`/api/hotels/${H}/rooms/${R1}/availability`).send({ from: `${Y}-11-20`, to: `${Y}-11-10` });
      check(rev.status === 400, 'from after to -> 400', rev);
      const ok = await modX.agent.post(`/api/hotels/${H}/rooms/${R1}/availability`).send({ from: `${Y}-11-01`, to: `${Y}-11-10` });
      check(ok.status === 201 || ok.status === 200, 'a separate range is fine', ok);
      return `overlap: ${over.status}`;
    });

    // A paid stay on room 101, 10-12 Dec.
    let B = '';
    await tc('5.10', async () => {
      B = await paidStay(U, H, R1, `${Y}-12-10`, `${Y}-12-12`);
      const before = await booking(B);
      check(before.status === 'Confirmed' && before.totalAmount === 20000, `Confirmed, 2 nights x 10000 (got ${before.status} ${before.totalAmount})`);
      const r = await modX.agent.patch(`/api/hotels/${H}/rooms/${R1}`).send({ pricePerNight: 15000 });
      check(r.status === 200, 'price change 200', r);
      check((await booking(B)).totalAmount === 20000, 'the existing booking keeps its price');
      const q = await t.http().get(`/api/hotels/${H}/rooms/available`).query({ checkIn: `${Y}-12-20`, checkOut: `${Y}-12-22` });
      check(JSON.stringify(q.body).includes('30000'), 'new searches use 15000 a night', q);
    });

    await tc('5.11', async () => {
      const busy = await modX.agent.delete(`/api/hotels/${H}/rooms/${R1}`);
      check(busy.status === 409, 'delete a room with a Confirmed stay -> 409 (HTL-06)', busy);
      const off = await modX.agent.patch(`/api/hotels/${H}/rooms/${R1}`).send({ isActive: false });
      check(off.status === 409, 'deactivate it -> 409', off);
      const r3 = (await modX.agent.post(`/api/hotels/${H}/rooms`).send(room('103'))).body;
      const free = await modX.agent.delete(`/api/hotels/${H}/rooms/${r3._id ?? r3.id}`);
      check(free.status === 200 || free.status === 204, 'delete an unused room', free);
    });

    await tc('5.14', async () => {
      const onBooked = await modX.agent.patch(`/api/hotels/${H}/rooms/${R1}/availability`).send({ block: { from: `${Y}-12-11`, to: `${Y}-12-11` } });
      check(onBooked.status === 409, 'blocking a booked night -> 409', onBooked);
      const pend = await stay(V, H, R2id, `${Y}-12-05`, `${Y}-12-06`);
      check(pend.status === 201, 'V holds room 102 for 5 Dec (PendingPayment)', pend);
      const onPending = await modX.agent.patch(`/api/hotels/${H}/rooms/${R2id}/availability`).send({ block: { from: `${Y}-12-05`, to: `${Y}-12-05` } });
      check(onPending.status === 409, 'blocking a night held by a PendingPayment stay -> 409', onPending);
      const blk = await modX.agent.patch(`/api/hotels/${H}/rooms/${R2id}/availability`).send({ block: { from: `${Y}-12-15`, to: `${Y}-12-16` } });
      check(blk.status === 200, 'block 15-16 Dec', blk);
      const b = await stay(U, H, R2id, `${Y}-12-15`, `${Y}-12-17`);
      check(refused(b), 'blocked nights cannot be booked', b);
      const two = await modX.agent.patch(`/api/hotels/${H}/rooms/${R2id}/availability`).send({ block: { from: `${Y}-12-20`, to: `${Y}-12-20` }, unblock: { from: `${Y}-12-15`, to: `${Y}-12-15` } });
      check(two.status === 400, 'two actions at once -> 400', two);
      const un = await modX.agent.patch(`/api/hotels/${H}/rooms/${R2id}/availability`).send({ unblock: { from: `${Y}-12-15`, to: `${Y}-12-16` } });
      check(un.status === 200, 'unblock', un);
      const again = await stay(U, H, R2id, `${Y}-12-15`, `${Y}-12-17`);
      check(again.status === 201, 'bookable again after unblocking', again);
      return `blocked booking: ${b.status}`;
    });

    await tc('5.15', async () => {
      await modX.agent.patch(`/api/hotels/${H}/rooms/${R2id}/availability`).send({ block: { from: `${Y}-12-25`, to: `${Y}-12-25` } }).expect(200);
      const r = await modX.agent.get(`/api/hotels/${H}/availability`).query({ from: `${Y}-12-09`, to: `${Y}-12-26` });
      check(r.status === 200, 'calendar 200', r);
      const rooms = r.body.data;
      const r101 = rooms.find((x: any) => x.name === '101');
      const r102 = rooms.find((x: any) => x.name === '102');
      const night = (rm: any, d: string) => rm.nights.find((n: any) => n.date === d)?.status;
      check(night(r101, `${Y}-12-10`) === 'Booked' && night(r101, `${Y}-12-11`) === 'Booked', 'booked nights', r);
      check(night(r101, `${Y}-12-12`) === 'Available', 'check-out day is free', r);
      check(night(r102, `${Y}-12-25`) === 'Blocked', 'blocked night', r);
      const booked = r101.nights.find((n: any) => n.date === `${Y}-12-10`);
      check(!!booked.reference, 'booked night links its reservation', r);
      const late = await modX.agent.get(`/api/hotels/${H}/availability`).query({ from: `${Y}-12-26`, to: `${Y}-12-09` });
      check(late.status === 400, 'from after to -> 400', late);
      const other = await modY.agent.get(`/api/hotels/${H}/availability`).query({ from: `${Y}-12-09`, to: `${Y}-12-26` });
      check(other.status === 403, "another hotel's moderator 403", other);
      const outside = night(r101, `${Y}-12-09`);
      return `nights outside any range show "${outside ?? 'n/a'}"`;
    });

    await tc('5.16', async () => {
      const r = await t.http().get(`/api/hotels/${H}`);
      check(r.status === 200, 'details 200 logged out', r);
      const s = JSON.stringify(r.body);
      check(s.includes('TEST Nile View') && s.includes('101') && s.includes('14:00'), 'name, rooms, policies', r);
      check(/rating/i.test(s), 'rating shown', r);
      check(r.body.images?.length >= 1, 'images', r);
    });

    await tc('5.17', async () => {
      const r = await modX.agent.get(`/api/hotels/${H}/reservations`);
      check(r.status === 200 && !!r.body.meta, 'reservations 200, paginated', r);
      const s = JSON.stringify(r.body);
      const ref = (await booking(B)).reference;
      check(s.includes(ref), `reservation ${ref} listed`, r);
      check(s.includes('101'), 'room shown', r);
    });

    await tc('5.18', async () => {
      const y = await modY.agent.get(`/api/hotels/${H}/reservations`);
      const u = await U.agent.get(`/api/hotels/${H}/reservations`);
      check(y.status === 403 && u.status === 403, 'other moderator and user 403', y.status === 403 ? u : y);
    });

    await tc('5.19', async () => {
      const search = () => t.http().get('/api/hotels/search').query({ city: 'cairo', checkIn: `${Y}-12-20`, checkOut: `${Y}-12-21`, guests: 2 });
      const before = await search();
      check(before.status === 200 && JSON.stringify(before.body).includes(H), 'hotel in search before', before);
      const d = await adm.agent.patch(`/api/admin/providers/hotel/${H}/deactivate`);
      check(d.status === 200, 'deactivate 200', d);
      check(!JSON.stringify((await search()).body).includes(H), 'hidden from search');
      const b = await stay(V, H, R1, `${Y}-12-20`, `${Y}-12-21`);
      check(refused(b), 'cannot be booked while deactivated', b);
      const a = await adm.agent.patch(`/api/admin/providers/hotel/${H}/reactivate`);
      check(a.status === 200, 'reactivate 200', a);
      check(JSON.stringify((await search()).body).includes(H), 'back in search');
      return `booking while deactivated: ${b.status}`;
    });

    void Types;
    expect(results.filter((r) => !r.ok).map((r) => r.id)).toEqual([]);
  }, 240_000);
});
