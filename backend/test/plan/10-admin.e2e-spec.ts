// Milestone 1 test plan (the team's "Milestone 1 Test Plan" doc), Part 10 (admin, audit
// and analytics), cases 10.1-10.12. Every case runs even if an earlier one
// fails; results are printed at the end. Where the spec names no status
// code, any refusal (4xx) passes and the code is recorded.
import * as request from 'supertest';
import { Types } from 'mongoose';
import { createTestApp, TestApp } from '../e2e/app';
import {
  Actor,
  admin,
  airlineModerator,
  hotelModerator,
  login,
  traveler,
  TEST_PASSWORD,
} from '../e2e/actors';
import { createAirline, createFlight, seedReference } from '../e2e/fixtures';
import { paymentIntentEvent, signedWebhook } from '../e2e/fakes';

type Res = request.Response;
const results: { id: string; ok: boolean; note: string }[] = [];
function check(cond: boolean, what: string, res?: Res) {
  if (!cond) {
    const got = res
      ? ` [got ${res.status} ${JSON.stringify(res.body).slice(0, 260)}]`
      : '';
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
const PAX = [
  {
    type: 'adult',
    fullName: 'TEST Pax',
    dateOfBirth: '1990-01-01',
    passportNumber: 'A1234567',
  },
];
const today = () => new Date().toISOString().slice(0, 10);

describe('Test plan Part 10: admin, audit & analytics', () => {
  let t: TestApp;
  let adm: Actor, U: Actor, V: Actor, air: Actor, hot: Actor;
  let airline: Types.ObjectId,
    hotel = '',
    F1 = '',
    F2 = '',
    roomId = '';

  async function webhookSuccess() {
    const intent = t.stripe.lastIntent()!;
    const { payload, signature } = signedWebhook(
      paymentIntentEvent(
        'payment_intent.succeeded',
        t.stripe.succeed(intent.id),
      ),
    );
    return t
      .http()
      .post('/api/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(payload);
  }
  async function paidFlight(who: Actor, flightId: string) {
    const h = await who.agent
      .post('/api/flight-bookings/hold')
      .send({ outboundFlightId: flightId, cabin: 'Economy', passengers: PAX });
    if (h.status !== 201)
      throw new Error(`hold ${h.status} ${JSON.stringify(h.body)}`);
    await who.agent
      .post(`/api/bookings/flight/${h.body._id}/accept-policies`)
      .send({ accepted: true })
      .expect(200);
    await who.agent.post(`/api/bookings/flight/${h.body._id}/pay`).expect(201);
    await webhookSuccess();
    return String(h.body._id);
  }

  beforeAll(async () => {
    t = await createTestApp('part10-admin');
    await seedReference(t);
    adm = await admin(t);
    U = await traveler(t, 'TEST Umar');
    V = await traveler(t, 'TEST Vera');
    airline = await createAirline(t, {
      cancellationTiers: [{ daysBefore: 0, refundPercent: 100 }],
    });
    air = await airlineModerator(t, airline);
    F1 = String(
      (await createFlight(t, { airlineId: airline, price: 20000, day: 10 }))
        ._id,
    );
    F2 = String(
      (await createFlight(t, { airlineId: airline, price: 15000, day: 10 }))
        ._id,
    );
    hotel = (
      await adm.agent
        .post('/api/hotels')
        .send({
          name: 'TEST Admin Hotel',
          address: '1 St',
          cityId: 'cairo',
          countryCode: 'EG',
          starClass: 4,
        })
    ).body._id;
    hot = await hotelModerator(t, hotel);
    await hot.agent
      .put(`/api/hotels/${hotel}/policies`)
      .send({
        checkInTime: '14:00',
        checkOutTime: '12:00',
        cancellationTiers: [],
      });
    const room = (
      await hot.agent
        .post(`/api/hotels/${hotel}/rooms`)
        .send({
          name: '1',
          type: 'Double',
          beds: 2,
          maxOccupancy: 2,
          pricePerNight: 10000,
        })
    ).body;
    roomId = String(room._id ?? room.id);
    await hot.agent
      .post(`/api/hotels/${hotel}/rooms/${roomId}/availability`)
      .send({ from: '2099-12-01', to: '2099-12-31' });
  }, 120_000);

  afterAll(async () => {
    const pass = results.filter((r) => r.ok).length;
    console.log(
      `\nPART 10 RESULTS: ${pass}/${results.length} passed\n` +
        results
          .map(
            (r) =>
              `${r.ok ? 'PASS' : 'FAIL'} ${r.id}${r.note ? '  ' + r.note : ''}`,
          )
          .join('\n'),
    );
    await t?.close();
  });

  it('runs cases 10.1-10.12 (ACC-14, ACC-16, ACC-17, GEN-07, BON-01) [partial: FLT-27]', async () => {
    await tc('10.1', async () => {
      const all = await adm.agent.get('/api/admin/accounts');
      check(all.status === 200 && !!all.body.meta, 'list 200, paginated', all);
      check(
        !/passwordHash|password"/.test(JSON.stringify(all.body)),
        'no password fields',
        all,
      );
      const byName = await adm.agent
        .get('/api/admin/accounts')
        .query({ search: 'Umar' });
      check(
        byName.body.data.length === 1 && byName.body.data[0].email === U.email,
        'search by name',
        byName,
      );
      const byEmail = await adm.agent
        .get('/api/admin/accounts')
        .query({ search: V.email });
      check(
        byEmail.body.data.length === 1 &&
          byEmail.body.data[0].name === 'TEST Vera',
        'search by email',
        byEmail,
      );
      const mods = await adm.agent
        .get('/api/admin/accounts')
        .query({ role: 'airline_moderator' });
      check(
        mods.body.data.length >= 1 &&
          mods.body.data.every((a: any) => a.role === 'airline_moderator'),
        'filter by role',
        mods,
      );
      check(
        mods.body.data.every((a: any) => !!a.createdAt),
        'registration date shown (ACC-14)',
        mods,
      );
      const bad = await adm.agent
        .get('/api/admin/accounts')
        .query({ role: 'pilot' });
      check(bad.status === 400, 'unknown role 400', bad);
    });

    await tc('10.2', async () => {
      const r = await adm.agent
        .patch(`/api/admin/accounts/${V.id}/suspend`)
        .send({ reason: 'TEST spam' });
      check(r.status === 200, 'suspend 200', r);
      const me = await V.agent.get('/api/users/me');
      check(
        me.status === 401 || me.status === 403,
        'open session stops working',
        me,
      );
      const lg = await t
        .http()
        .post('/api/auth/login')
        .send({ email: V.email, password: TEST_PASSWORD });
      check(
        lg.status === 403 && /suspend/i.test(lg.body.message),
        'login refused with "account suspended" (ACC-04)',
        lg,
      );
      const st = await adm.agent
        .get('/api/admin/accounts')
        .query({ status: 'suspended' });
      check(
        JSON.stringify(st.body).includes(V.email),
        'filter by status shows it',
        st,
      );
      const n = await t
        .model('Notification')
        .countDocuments({
          userId: new Types.ObjectId(V.id),
          type: 'ACCOUNT_SUSPENDED',
        });
      check(n === 1, 'suspension notification (GEN-01)');
      return `open session: ${me.status}, login: ${lg.status} "${lg.body.message}"`;
    });

    await tc('10.3', async () => {
      const r = await adm.agent.patch(`/api/admin/accounts/${V.id}/reactivate`);
      check(r.status === 200, 'reactivate 200', r);
      V = await login(t, V.email, TEST_PASSWORD);
      const me = await V.agent.get('/api/users/me');
      check(me.status === 200, 'logs in and works again', me);
      const again = await adm.agent.patch(
        `/api/admin/accounts/${V.id}/reactivate`,
      );
      check(again.status === 409, 'reactivating an active account 409', again);
    });

    await tc('10.4', async () => {
      const adm2 = await admin(t);
      const self = await adm.agent
        .patch(`/api/admin/accounts/${adm.id}/suspend`)
        .send({});
      const other = await adm.agent
        .patch(`/api/admin/accounts/${adm2.id}/suspend`)
        .send({});
      check(
        refused(self) && refused(other),
        `suspending an admin refused (self ${self.status}, other ${other.status})`,
      );
      await adm.agent
        .patch(`/api/admin/accounts/${U.id}/suspend`)
        .send({})
        .expect(200);
      const twice = await adm.agent
        .patch(`/api/admin/accounts/${U.id}/suspend`)
        .send({});
      check(twice.status === 409, 'suspending twice 409', twice);
      await adm.agent
        .patch(`/api/admin/accounts/${U.id}/reactivate`)
        .expect(200);
      U = await login(t, U.email, TEST_PASSWORD);
      const unknown = await adm.agent
        .patch(`/api/admin/accounts/${new Types.ObjectId()}/suspend`)
        .send({});
      check(unknown.status === 404, 'unknown account 404', unknown);
      return `self ${self.status}, other admin ${other.status}`;
    });

    // Money for 10.5 and 10.8-10.11: U pays F1 (20000) twice and cancels one
    // (full refund); V stays 1 night in the hotel (10000).
    const b1 = await paidFlight(U, F1);
    const b2 = await paidFlight(U, F1);
    await U.agent
      .post(`/api/flight-bookings/${b2}/cancel`)
      .send({ refundAmount: 20000 })
      .expect(200);
    const hb = await V.agent
      .post('/api/hotel-bookings')
      .send({
        hotelId: hotel,
        checkIn: '2099-12-10',
        checkOut: '2099-12-11',
        rooms: [{ roomId, adults: 1, childAges: [] }],
      });
    await V.agent
      .post(`/api/bookings/hotel/${hb.body._id}/accept-policies`)
      .send({ accepted: true })
      .expect(200);
    await V.agent.post(`/api/bookings/hotel/${hb.body._id}/pay`).expect(201);
    await webhookSuccess();
    const pend = await V.agent
      .post('/api/flight-bookings/hold')
      .send({ outboundFlightId: F2, cabin: 'Economy', passengers: PAX });

    await tc('10.5', async () => {
      const all = await adm.agent.get('/api/admin/bookings');
      check(
        all.status === 200 && !!all.body.meta,
        'all bookings 200, paginated',
        all,
      );
      const s = JSON.stringify(all.body);
      check(
        [b1, b2, hb.body._id, pend.body._id].every((id) => s.includes(id)),
        'flight and hotel bookings of every user',
        all,
      );
      const fl = await adm.agent
        .get('/api/admin/bookings')
        .query({ type: 'hotel' });
      check(
        JSON.stringify(fl.body).includes(hb.body._id) &&
          !JSON.stringify(fl.body).includes(b1),
        'type filter',
        fl,
      );
      const st = await adm.agent
        .get('/api/admin/bookings')
        .query({ status: 'Cancelled' });
      check(
        JSON.stringify(st.body).includes(b2) &&
          !JSON.stringify(st.body).includes(b1),
        'status filter',
        st,
      );
    });

    await tc('10.6', async () => {
      await adm.agent
        .post('/api/admin/moderators')
        .send({
          name: 'TEST New Mod',
          email: `newmod-${Date.now()}@test.local`,
          role: 'hotel_moderator',
          providerId: hotel,
          temporaryPassword: 'TempPass123',
        })
        .expect(201);
      await adm.agent
        .patch(`/api/admin/providers/hotel/${hotel}/deactivate`)
        .expect(200);
      await adm.agent
        .patch(`/api/admin/providers/hotel/${hotel}/reactivate`)
        .expect(200);
      const r = await adm.agent.get('/api/admin/audit-logs');
      check(r.status === 200 && !!r.body.meta, 'audit log 200, paginated', r);
      const actions = r.body.data.map((x: any) => x.action);
      for (const a of [
        'ACCOUNT_SUSPENDED',
        'ACCOUNT_REACTIVATED',
        'MODERATOR_CREATED',
        'PROVIDER_DEACTIVATED',
        'PROVIDER_REACTIVATED',
      ]) {
        check(
          actions.some((x: string) => String(x).toUpperCase() === a),
          `${a} logged`,
          r,
        );
      }
      check(
        r.body.data.every(
          (x: any) => x.adminId === adm.id && !!x.createdAt && !!x.targetId,
        ),
        'who, when and target on every entry',
        r,
      );
      return `${r.body.meta.total} entries`;
    });

    await tc('10.7', async () => {
      const r = await adm.agent.patch(
        `/api/admin/providers/train/${hotel}/deactivate`,
      );
      check(r.status === 400, 'unknown provider type 400', r);
      const u = await adm.agent.patch(
        `/api/admin/providers/airline/${new Types.ObjectId()}/deactivate`,
      );
      check(u.status === 404, 'unknown airline 404', u);
    });

    const analytics = (
      q: Record<string, string> = { from: today(), to: today() },
    ) => adm.agent.get('/api/admin/analytics').query(q);
    await tc('10.8', async () => {
      const r = await analytics();
      check(r.status === 200, 'analytics 200', r);
      check(
        r.body.currency === 'USD' &&
          !!r.body.totals &&
          Array.isArray(r.body.airlines) &&
          Array.isArray(r.body.hotels),
        'totals, airlines, hotels in USD',
        r,
      );
      const fields = [
        'bookings',
        'cancelled',
        'grossRevenue',
        'refunded',
        'revenue',
      ];
      check(
        fields.every((f) => Number.isInteger(r.body.totals[f])),
        'integer cents',
        r,
      );
    });

    await tc('10.9', async () => {
      const r = await analytics();
      const a = r.body.airlines.find(
        (x: any) => x.providerId === String(airline),
      );
      const h = r.body.hotels.find((x: any) => x.providerId === hotel);
      // Airline: 2 paid x 20000, 1 cancelled with a 20000 refund; the unpaid hold is not counted.
      check(
        !!a &&
          a.bookings === 1 &&
          a.cancelled === 1 &&
          a.grossRevenue === 40000 &&
          a.refunded === 20000 &&
          a.revenue === 20000,
        `airline numbers (got ${JSON.stringify(a)})`,
        r,
      );
      check(
        !!h &&
          h.bookings === 1 &&
          h.cancelled === 0 &&
          h.grossRevenue === 10000 &&
          h.revenue === 10000,
        `hotel numbers (got ${JSON.stringify(h)})`,
        r,
      );
      check(
        r.body.totals.revenue === 30000,
        `total revenue 30000 (got ${r.body.totals.revenue})`,
        r,
      );
    });

    await tc('10.10', async () => {
      const def = await adm.agent.get('/api/admin/analytics');
      check(
        def.status === 200 && def.body.to === today(),
        'default period ends today',
        def,
      );
      const days =
        (Date.parse(def.body.to) - Date.parse(def.body.from)) / 86_400_000;
      check(days === 29, `default is the last 30 days (got ${days + 1})`, def);
      check(def.body.totals.revenue === 30000, 'includes today', def);
      const rev = await analytics({ from: today(), to: '2000-01-01' });
      check(rev.status === 400, 'from after to 400', rev);
      const fmt = await analytics({ from: '31-12-2026' });
      check(fmt.status === 400, 'bad date format 400', fmt);
      const old = await analytics({ from: '2001-01-01', to: '2001-01-31' });
      check(
        old.body.totals.bookings === 0 && old.body.totals.revenue === 0,
        'another period is empty',
        old,
      );
    });

    await tc('10.11', async () => {
      const c = await U.agent
        .patch(`/api/flight-bookings/${b1}/change-flight`)
        .send({ outboundFlightId: F2 });
      check(
        c.status === 200 && c.body.difference === -5000,
        'change to a cheaper flight, 5000 back',
        c,
      );
      const r = await analytics();
      const a = r.body.airlines.find(
        (x: any) => x.providerId === String(airline),
      );
      check(
        a.grossRevenue === 40000 && a.refunded === 25000 && a.revenue === 15000,
        `the change refund is counted (got ${JSON.stringify(a)})`,
        r,
      );
    });

    await tc('10.12', async () => {
      const routes: ['get' | 'post' | 'patch', string][] = [
        ['get', '/api/admin/accounts'],
        ['patch', `/api/admin/accounts/${U.id}/suspend`],
        ['patch', `/api/admin/accounts/${U.id}/reactivate`],
        ['post', '/api/admin/moderators'],
        ['post', `/api/admin/users/${U.id}/reset-password`],
        ['patch', `/api/admin/providers/hotel/${hotel}/deactivate`],
        ['get', '/api/admin/bookings'],
        ['get', '/api/admin/audit-logs'],
        ['get', '/api/admin/analytics'],
        ['get', '/api/admin/reports'],
      ];
      const bad: string[] = [];
      for (const [m, path] of routes) {
        for (const [who, want] of [
          [U.agent, 403],
          [air.agent, 403],
          [hot.agent, 403],
          [t.http(), 401],
        ] as const) {
          const r = await (who as any)[m](path).send({});
          if (r.status !== want)
            bad.push(
              `${m.toUpperCase()} ${path} -> ${r.status} (want ${want})`,
            );
        }
      }
      check(bad.length === 0, bad.join('; '));
      return `${routes.length} routes x 4 callers`;
    });

    expect(results.filter((r) => !r.ok).map((r) => r.id)).toEqual([]);
  }, 300_000);
});
