// Milestone 1 test plan (the team's "Milestone 1 Test Plan" doc), Part 12 second half
// (cases 12.27-12.52: hotels, payments, itineraries, blog, general rules).
// Every case runs even if an earlier one fails; results are printed at the
// end. The exchange-rate API is faked with nock (as the harness intends).
import * as request from 'supertest';
import * as nock from 'nock';
import { Types } from 'mongoose';
import { SUPPORTED_CURRENCIES } from '../../src/common/constants/currencies';
import { ExchangeRatesService } from '../../src/exchange-rates/exchange-rates.service';
import { HotelStayCompletionJob } from '../../src/hotel-bookings/hotel-stay-completion.job';
import { User } from '../../src/users/schemas/user.schema';
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
const idOf = (b: any) => String(b?._id ?? b?.id);
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);
const today = () => new Date().toISOString().slice(0, 10);
const adult = () => ({
  type: 'adult',
  fullName: 'TEST Pax',
  dateOfBirth: '1990-01-01',
  passportNumber: 'A1234567',
});

describe('Test plan Part 12b: hotels, payments, itineraries, blog, general', () => {
  let t: TestApp;
  let adm: Actor, U: Actor, V: Actor;

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
  async function pay(who: Actor, kind: 'flight' | 'hotel', id: string) {
    await who.agent
      .post(`/api/bookings/${kind}/${id}/accept-policies`)
      .send({ accepted: true })
      .expect(200);
    await who.agent.post(`/api/bookings/${kind}/${id}/pay`).expect(201);
    await webhookSuccess();
  }

  beforeAll(async () => {
    t = await createTestApp('part12b');
    await seedReference(t);
    adm = await admin(t);
    U = await traveler(t, 'TEST Una');
    V = await traveler(t, 'TEST Viv');
  }, 120_000);

  afterAll(async () => {
    nock.cleanAll();
    const pass = results.filter((r) => r.ok).length;
    console.log(
      `\nPART 12b RESULTS: ${pass}/${results.length} passed\n` +
        results
          .map(
            (r) =>
              `${r.ok ? 'PASS' : 'FAIL'} ${r.id}${r.note ? '  ' + r.note : ''}`,
          )
          .join('\n'),
    );
    await t?.close();
  });

  it('runs cases 12.27-12.52 (ITN-09, ITN-18, BLG-09) [partial: ACC-07, HTL-20, HTL-23, PAY-02, PAY-03, ITN-05, ITN-07, ITN-08, ITN-14, ITN-20, ITN-21, ITN-25, ITN-26, BLG-01, BLG-05, BLG-08, BLG-10, BLG-12, GEN-01, GEN-01-B, GEN-07, GEN-08, GEN-09, GEN-10, GEN-11, BON-02]', async () => {
    // A hotel with two rooms for the hotel cases.
    const hotel = (
      await adm.agent
        .post('/api/hotels')
        .send({
          name: 'TEST Part12 Hotel',
          address: '1 St',
          cityId: 'cairo',
          countryCode: 'EG',
          starClass: 4,
        })
    ).body._id;
    const mod = await hotelModerator(t, hotel);
    await mod.agent
      .put(`/api/hotels/${hotel}/policies`)
      .send({
        checkInTime: '14:00',
        checkOutTime: '12:00',
        cancellationTiers: [{ daysBefore: 10, refundPercent: 100 }],
      });
    const rooms: string[] = [];
    for (const nm of ['1', '2']) {
      const r = await mod.agent
        .post(`/api/hotels/${hotel}/rooms`)
        .send({
          name: nm,
          type: 'Double',
          beds: 2,
          maxOccupancy: 2,
          pricePerNight: 10000,
        });
      rooms.push(idOf(r.body));
      await mod.agent
        .post(`/api/hotels/${hotel}/rooms/${idOf(r.body)}/availability`)
        .send({ from: today(), to: '2099-12-31' });
    }
    const book = (who: Actor, ci: string, co: string, rs = [rooms[0]]) =>
      who.agent
        .post('/api/hotel-bookings')
        .send({
          hotelId: hotel,
          checkIn: ci,
          checkOut: co,
          rooms: rs.map((roomId) => ({ roomId, adults: 1, childAges: [] })),
        });

    await tc('12.27', async () => {
      const G = await traveler(t, 'TEST Hgroups');
      const up = await book(G, '2099-12-10', '2099-12-11');
      await pay(G, 'hotel', up.body._id);
      const pastB = await book(G, '2099-12-12', '2099-12-13');
      await pay(G, 'hotel', pastB.body._id);
      await t.app
        .get(HotelStayCompletionJob)
        .completeStays(new Date('2099-12-14T12:00:00Z'));
      await t
        .model('HotelBooking')
        .updateOne(
          { _id: up.body._id },
          { $set: { status: 'Confirmed', completedAt: null } },
        );
      const can = await book(G, '2099-12-20', '2099-12-21');
      await pay(G, 'hotel', can.body._id);
      await G.agent
        .post(`/api/hotel-bookings/${can.body._id}/cancel`)
        .send({ refundAmount: 10000 })
        .expect(200);
      const g = async (group: string) =>
        JSON.stringify(
          (await G.agent.get('/api/hotel-bookings').query({ group })).body,
        );
      check((await g('upcoming')).includes(up.body._id), 'Upcoming');
      check((await g('past')).includes(pastB.body._id), 'Past');
      check((await g('cancelled')).includes(can.body._id), 'Cancelled');
    });

    await tc('12.28', async () => {
      const two = await book(U, '2099-12-15', '2099-12-16', rooms);
      check(two.status === 201, 'a 2-room reservation', two);
      await pay(U, 'hotel', two.body._id);
      await t.app
        .get(HotelStayCompletionJob)
        .completeStays(new Date('2099-12-17T12:00:00Z'));
      check(
        (await t.model('HotelBooking').findById(two.body._id).lean<any>())
          .status === 'Completed',
        'Completed after check-out',
      );
      const long = await U.agent
        .post(`/api/hotel-bookings/${two.body._id}/review`)
        .send({ rating: 4, text: 'x'.repeat(1001) });
      check(long.status === 400, '1001 characters 400', long);
      const r1 = await U.agent
        .post(`/api/hotel-bookings/${two.body._id}/review`)
        .send({ rating: 4 });
      const r2 = await U.agent
        .post(`/api/hotel-bookings/${two.body._id}/review`)
        .send({ rating: 5 });
      check(
        r1.status === 201 && r2.status === 409,
        'one review per reservation, whatever the rooms',
        r2,
      );
      const del = await U.agent.delete(`/api/reviews/${idOf(r1.body)}`);
      check(del.status === 200 || del.status === 204, 'delete it', del);
    });

    await tc('12.29', async () => {
      const b = await book(V, '2099-12-22', '2099-12-23');
      const early = await V.agent.post(`/api/bookings/hotel/${b.body._id}/pay`);
      check(
        early.status === 400,
        'payment refused before accepting the policies',
        early,
      );
      const before = Date.now();
      await V.agent
        .post(`/api/bookings/hotel/${b.body._id}/accept-policies`)
        .send({ accepted: true })
        .expect(200);
      const at = (
        await t.model('HotelBooking').findById(b.body._id).lean<any>()
      ).policiesAcceptedAt;
      check(
        !!at && new Date(at).getTime() >= before - 1000,
        'acceptance stored with its time (PAY-02)',
      );
    });

    await tc('12.30', async () => {
      const soon = new Date(Date.now() + 2 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const after = new Date(Date.now() + 3 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const b = await book(V, soon, after);
      await pay(V, 'hotel', b.body._id);
      const n = t.stripe.calls.filter(
        (c) => c.method === 'createRefund',
      ).length;
      const c = await V.agent
        .post(`/api/hotel-bookings/${b.body._id}/cancel`)
        .send({ refundAmount: 0 });
      check(
        c.status === 200 && c.body.refund === null,
        '0% tier: cancelled, refund null',
        c,
      );
      check(
        t.stripe.calls.filter((x) => x.method === 'createRefund').length === n,
        'nothing sent to Stripe',
      );
      const b2 = await book(V, '2099-12-25', '2099-12-26');
      await pay(V, 'hotel', b2.body._id);
      const c2 = await V.agent
        .post(`/api/hotel-bookings/${b2.body._id}/cancel`)
        .send({ refundAmount: 10000 });
      check(
        ['Pending', 'Refunded'].includes(c2.body.refund?.status),
        `refund status shown (${c2.body.refund?.status})`,
        c2,
      );
      const d = await V.agent.get(`/api/hotel-bookings/${b2.body._id}`);
      check(
        /Pending|Refunded/.test(JSON.stringify(d.body)),
        'and on the booking details',
        d,
      );
    });

    // ---------- Itineraries ----------
    const I = idOf(
      (
        await U.agent
          .post('/api/itineraries')
          .send({
            title: 'TEST Long trip',
            countries: ['EG', 'FR'],
            startDate: '2099-12-01',
          })
      ).body,
    );
    const add = (cityId?: string) =>
      U.agent.post(`/api/itineraries/${I}/days`).send(cityId ? { cityId } : {});
    const it = async () => (await U.agent.get(`/api/itineraries/${I}`)).body;

    await tc('12.31', async () => {
      check((await add()).status === 400, 'a day without a city 400 (ITN-09)');
      for (const c of ['cairo', 'cairo', 'cairo', 'paris', 'paris'])
        await add(c).expect(201);
      const d = await it();
      await U.agent
        .post(`/api/itineraries/${I}/days/${idOf(d.days[0])}/budgets`)
        .send({ category: 'food', amount: 30, currency: 'USD' })
        .expect(201);
      await U.agent
        .post(`/api/itineraries/${I}/days/${idOf(d.days[4])}/budgets`)
        .send({ category: 'food', amount: 20, currency: 'USD' })
        .expect(201);
      const g = JSON.stringify((await it()).cityGroups);
      check(
        /"cityId":"cairo"[^}]*"(dayCount|days)":3/.test(g) ||
          /"days":3/.test(g) ||
          g.includes('"dayCount":3'),
        `Cairo group of 3 days (${g.slice(0, 200)})`,
      );
      check(/budgetSubtotal/.test(g), 'group budget subtotal');
    });

    await tc('12.32', async () => {
      const d0 = await it();
      await U.agent
        .patch(`/api/itineraries/${I}/days/reorder`)
        .send({ dayId: idOf(d0.days[4]), newPosition: 1 })
        .expect(200);
      const d1 = await it();
      check(
        d1.days[0].cityId === 'paris' &&
          String(d1.days[0].date).startsWith('2099-12-01'),
        'moved day becomes day 1 on the start date',
      );
      await U.agent
        .delete(`/api/itineraries/${I}/days/${idOf(d1.days[1])}`)
        .expect(200);
      const d2 = await it();
      check(
        d2.days.length === 4 &&
          String(d2.days[3].date).startsWith('2099-12-04'),
        'renumbered and dates recalculated after a delete',
      );
    });

    await tc('12.33', async () => {
      const day = idOf((await it()).days[1]);
      const neg = await U.agent
        .post(`/api/itineraries/${I}/days/${day}/budgets`)
        .send({ category: 'food', amount: -1, currency: 'USD' });
      check(neg.status === 400, 'negative 400', neg);
      for (const cat of ['accommodation', 'in_city_transport', 'activities']) {
        await U.agent
          .post(`/api/itineraries/${I}/days/${day}/budgets`)
          .send({ category: cat, amount: 10, currency: 'USD' })
          .expect(201);
      }
      return 'totals per category checked in 12.34';
    });

    await tc('12.34', async () => {
      await t.model('ExchangeRate').deleteMany({});
      // Forget any failed fetch from an earlier case (the service waits before retrying).
      (t.app.get(ExchangeRatesService) as any).lastFailureAt = 0;
      const rates: Record<string, number> = {};
      for (const c of SUPPORTED_CURRENCIES) rates[c] = c === 'EUR' ? 0.5 : 1;
      let calls = 0;
      nock('https://api.fxratesapi.com')
        .persist()
        .get('/latest')
        .query(true)
        .reply(200, () => {
          calls++;
          return { success: true, date: today(), rates };
        });
      await U.agent
        .patch('/api/users/me')
        .send({ preferredCurrency: 'EUR' })
        .expect(200);
      const s1 = await U.agent.get(`/api/itineraries/${I}/budget-summary`);
      const s2 = await U.agent.get(`/api/itineraries/${I}/budget-summary`);
      check(
        s1.status === 200 &&
          s1.body.currency === 'EUR' &&
          s1.body.rateDate === today(),
        'in EUR with the rate date',
        s1,
      );
      check(
        calls === 1,
        `rates fetched once a day and cached (API called ${calls} times)`,
      );
      const total = Number(s2.body.total?.amount ?? s2.body.total);
      check(
        Math.abs(total - 25) < 0.01,
        `20 + 3 x 10 = 50 USD = 25 EUR (12.32 deleted the day with the 30 USD entry; got ${total})`,
        s2,
      );
      check(
        ['food', 'accommodation', 'in_city_transport', 'activities'].every(
          (c) => JSON.stringify(s2.body.byCategory).includes(c),
        ),
        'by category (ITN-14)',
        s2,
      );
      nock.cleanAll();
      await t
        .model('ExchangeRate')
        .updateMany({}, { $set: { date: '2000-01-01' } });
      nock('https://api.fxratesapi.com')
        .persist()
        .get('/latest')
        .query(true)
        .reply(503, { success: false });
      (t.app.get(ExchangeRatesService) as any).lastFailureAt = 0;
      const s3 = await U.agent.get(`/api/itineraries/${I}/budget-summary`);
      check(
        s3.status === 200 &&
          s3.body.rateDate === '2000-01-01' &&
          s3.body.ratesAreOld === true,
        'API down: the last cached rates are used, marked old',
        s3,
      );
      nock.cleanAll();
    });

    await tc('12.35', async () => {
      await U.agent
        .patch(`/api/itineraries/${I}`)
        .send({ visibility: 'Public' })
        .expect(200);
      const edit = await V.agent
        .patch(`/api/itineraries/${I}`)
        .send({ title: 'hacked' });
      const day = await V.agent
        .post(`/api/itineraries/${I}/days`)
        .send({ cityId: 'cairo' });
      check(refused(edit) && refused(day), 'read-only for other users', edit);
      await U.agent
        .patch(`/api/itineraries/${I}`)
        .send({ visibility: 'Private' })
        .expect(200);
      check(
        (await t.http().get(`/api/itineraries/public/${I}`)).status === 404,
        'private: gone at once',
      );
      await U.agent
        .patch(`/api/itineraries/${I}`)
        .send({ visibility: 'Public' })
        .expect(200);
    });

    await tc('12.36', async () => {
      const s = (q: Record<string, unknown>) =>
        t.http().get('/api/itineraries/public/search').query(q);
      check(
        JSON.stringify((await s({ keyword: 'Paris' })).body).includes(I),
        'keyword matches a city',
      );
      check(
        JSON.stringify((await s({ keyword: 'Long trip' })).body).includes(I),
        'keyword matches the title',
      );
      check(
        JSON.stringify((await s({ country: 'FR' })).body).includes(I),
        'country filter',
      );
      check(
        JSON.stringify((await s({ minDays: 4, maxDays: 4 })).body).includes(I),
        '4 days: in a 4-4 filter',
      );
      check(
        !JSON.stringify((await s({ maxDays: 3 })).body).includes(I),
        'excluded by max 3 days',
      );
      const pub = await t.http().get(`/api/itineraries/public/${I}`);
      check(
        /TEST Una/.test(JSON.stringify(pub.body)) &&
          pub.body.days?.length === 4,
        'read-only view with author and days',
        pub,
      );
      const c = await V.agent.post(`/api/itineraries/${I}/clone`);
      check(
        c.status === 201 && c.body.visibility === 'Private',
        'clone is private',
        c,
      );
      check(
        /TEST Una|clonedFrom/.test(JSON.stringify(c.body)),
        'credits the original',
        c,
      );
      await V.agent
        .patch(`/api/itineraries/${idOf(c.body)}`)
        .send({ title: 'TEST my copy' })
        .expect(200);
      check(
        (await U.agent.get(`/api/itineraries/${I}`)).body.title ===
          'TEST Long trip',
        'independent of the original',
      );
    });

    await tc('12.37', async () => {
      const r = await U.agent
        .get(`/api/itineraries/${I}/hotels`)
        .query({ groupIndex: 1, guests: 1 });
      const s = JSON.stringify(r.body);
      check(
        r.status === 200 &&
          s.includes('"checkIn":"2099-12-02"') &&
          s.includes('"checkOut":"2099-12-04"'),
        `Cairo group (days 2-3): check-in 2 Dec, check-out 4 Dec, the day after its last day (${s.slice(0, 160)})`,
        r,
      );
    });

    await tc('12.38', async () => {
      const airline = await createAirline(t);
      const out = await createFlight(t, {
        airlineId: airline,
        from: 'DXB',
        to: 'CDG',
        day: 1,
      });
      const back = await createFlight(t, {
        airlineId: airline,
        from: 'CDG',
        to: 'DXB',
        day: 4,
      });
      const r = await U.agent
        .get(`/api/itineraries/${I}/flights`)
        .query({ origin: 'DXB', roundTrip: true });
      const s = JSON.stringify(r.body);
      check(
        r.status === 200 &&
          s.includes(String(out._id)) &&
          s.includes(String(back._id)),
        'outbound on the start date, return on the last day, to the first city',
        r,
      );
    });

    // ---------- Blog & general ----------
    const A = await traveler(t, 'TEST Writer');
    await tc('12.39', async () => {
      const d = await A.agent
        .post('/api/posts')
        .send({ title: 'TEST draftonly', body: 'x' });
      check(d.body.status === 'Draft', 'draft', d);
      check(
        !JSON.stringify(
          (await t.http().get('/api/posts').query({ search: 'draftonly' }))
            .body,
        ).includes(idOf(d.body)),
        'not in search',
      );
      check(
        !JSON.stringify(
          (await t.http().get(`/api/authors/${A.id}`)).body,
        ).includes(idOf(d.body)),
        'not on the author page',
      );
    });

    await tc('12.40', async () => {
      const p = await A.agent
        .post('/api/posts')
        .send({
          title: 'TEST tagged',
          body: 'x',
          tags: ['nile'],
          status: 'Published',
        });
      const e = await A.agent
        .patch(`/api/posts/${idOf(p.body)}`)
        .send({ tags: ['nile', 'cairo'] });
      check(e.status === 200, 'edit tags later', e);
      const six = await A.agent
        .patch(`/api/posts/${idOf(p.body)}`)
        .send({ tags: ['a', 'b', 'c', 'd', 'e', 'f'] });
      check(six.status === 400, '6 tags 400', six);
      check(
        JSON.stringify(
          (await t.http().get('/api/tags/cairo/posts')).body,
        ).includes(idOf(p.body)),
        'tag lists the post',
      );
    });

    await tc('12.41', async () => {
      const mk = async (title: string) =>
        idOf(
          (
            await A.agent
              .post('/api/posts')
              .send({ title, body: 'x', status: 'Published' })
          ).body,
        );
      const low = await mk('TEST zebra one');
      const high = await mk('TEST zebra two');
      const newer = await mk('TEST zebra three');
      await V.agent.post(`/api/posts/${high}/like`);
      await U.agent.post(`/api/posts/${high}/comments`).send({ body: 'nice' });
      const r = await t.http().get('/api/posts').query({ search: 'zebra' });
      const ids = r.body.data.map((x: any) => idOf(x));
      check(ids[0] === high, 'highest likes + comments first');
      check(ids.indexOf(newer) < ids.indexOf(low), 'ties: newest first');
      check(
        r.body.data.every(
          (x: any) =>
            x.title &&
            x.author &&
            (x.publishedAt || x.createdAt) &&
            x.excerpt !== undefined,
        ),
        'title, author, date and excerpt',
        r,
      );
    });

    await tc('12.42', async () => {
      const p = idOf(
        (
          await A.agent
            .post('/api/posts')
            .send({ title: 'TEST chat', body: 'x', status: 'Published' })
        ).body,
      );
      for (const b of ['one', 'two', 'three'])
        await U.agent
          .post(`/api/posts/${p}/comments`)
          .send({ body: `TEST ${b}` })
          .expect(201);
      const l = JSON.stringify(
        (await t.http().get(`/api/posts/${p}/comments`)).body,
      );
      check(
        l.indexOf('TEST one') < l.indexOf('TEST two') &&
          l.indexOf('TEST two') < l.indexOf('TEST three'),
        'chronological',
      );
    });

    await tc('12.43', async () => {
      await A.agent
        .patch(
          `/api/itineraries/${idOf((await A.agent.post('/api/itineraries').send({ title: 'TEST writer trip', countries: ['EG'], startDate: '2099-12-01' })).body)}`,
        )
        .send({ visibility: 'Public' })
        .expect(200);
      const r = await t.http().get(`/api/authors/${A.id}`);
      const s = JSON.stringify(r.body);
      check(
        s.includes('TEST Writer') &&
          s.includes('TEST tagged') &&
          s.includes('TEST writer trip'),
        'name, posts, public itineraries',
        r,
      );
      const u = await t.model(User.name).findById(A.id).lean<any>();
      check(
        s.includes(new Date(u.createdAt).toISOString().slice(0, 10)),
        'join date',
        r,
      );
    });

    await tc('12.44', async () => {
      const p = idOf(
        (
          await A.agent
            .post('/api/posts')
            .send({ title: 'TEST pics', body: 'x', status: 'Published' })
        ).body,
      );
      const five = A.agent.post(`/api/posts/${p}/images`);
      for (let i = 0; i < 5; i++) five.attach('images', PNG, `p${i}.png`);
      check((await five).status === 201, '5 images ok');
      check(
        (
          await A.agent
            .post(`/api/posts/${p}/images`)
            .attach('images', PNG, 'x.png')
        ).status === 400,
        'a 6th 400',
      );
      const big = await A.agent
        .post('/api/uploads/images')
        .attach(
          'images',
          Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024 + 100)]),
          'big.png',
        );
      check(big.status === 400 || big.status === 413, 'over 5 MB refused', big);
      const gif = await A.agent
        .post('/api/uploads/images')
        .attach('images', GIF, 'a.gif');
      check(gif.status === 400, 'GIF refused', gif);
      const air = await airlineModerator(t, await createAirline(t));
      const aid =
        (air as any).providerId ??
        (await t.model(User.name).findById(air.id).lean<any>())
          .assignedProviderId;
      const two = await air.agent
        .post(`/api/airlines/${aid}/logo`)
        .attach('logo', PNG, 'a.png')
        .attach('logo', PNG, 'b.png');
      check(
        refused(two),
        'two logos at once refused (1 logo per airline)',
        two,
      );
      return `two logos: ${two.status}`;
    });

    await tc('12.45', async () => {
      const it2 = idOf(
        (
          await A.agent
            .post('/api/itineraries')
            .send({
              title: 'TEST reported trip',
              countries: ['EG'],
              startDate: '2099-12-01',
            })
        ).body,
      );
      await A.agent
        .patch(`/api/itineraries/${it2}`)
        .send({ visibility: 'Public' })
        .expect(200);
      const r = await V.agent
        .post('/api/reports')
        .send({ targetType: 'itinerary', targetId: it2, reason: 'TEST' });
      const r2 = await V.agent
        .post('/api/reports')
        .send({ targetType: 'itinerary', targetId: it2, reason: 'TEST' });
      check(r.status === 201 && r2.status === 409, 'once per item', r2);
    });

    await tc('12.46', async () => {
      const p = idOf(
        (
          await A.agent
            .post('/api/posts')
            .send({ title: 'TEST to hide', body: 'x', status: 'Published' })
        ).body,
      );
      await adm.agent
        .patch(`/api/admin/content/post/${p}/hide`)
        .send({ hidden: true })
        .expect(200);
      const [a, o, ad, anon] = [
        await A.agent.get(`/api/posts/${p}`),
        await V.agent.get(`/api/posts/${p}`),
        await adm.agent.get(`/api/posts/${p}`),
        await t.http().get(`/api/posts/${p}`),
      ];
      check(
        a.status === 200 &&
          ad.status === 200 &&
          o.status === 404 &&
          anon.status === 404,
        `author ${a.status}, admin ${ad.status}, other ${o.status}, visitor ${anon.status}`,
      );
      const it2 = idOf(
        (
          await A.agent
            .post('/api/itineraries')
            .send({
              title: 'TEST hidden trip',
              countries: ['EG'],
              startDate: '2099-12-01',
            })
        ).body,
      );
      await A.agent
        .patch(`/api/itineraries/${it2}`)
        .send({ visibility: 'Public' })
        .expect(200);
      await adm.agent
        .patch(`/api/admin/content/itinerary/${it2}/hide`)
        .send({ hidden: true })
        .expect(200);
      check(
        (await t.http().get(`/api/itineraries/public/${it2}`)).status === 404,
        'hidden itinerary gone from public',
      );
      check(
        (await A.agent.get(`/api/itineraries/${it2}`)).status === 200,
        'its owner still opens it',
      );
    });

    await tc('12.47', async () => {
      const p = idOf(
        (
          await A.agent
            .post('/api/posts')
            .send({ title: 'TEST to delete', body: 'x', status: 'Published' })
        ).body,
      );
      await adm.agent.delete(`/api/admin/content/post/${p}`).expect(200);
      const S = await traveler(t, 'TEST Suspendme');
      await adm.agent
        .patch(`/api/admin/accounts/${S.id}/suspend`)
        .send({ reason: 'TEST' })
        .expect(200);
      const log = JSON.stringify(
        (await adm.agent.get('/api/admin/audit-logs')).body,
      );
      check(
        /DELET/i.test(log) && log.includes(p),
        'deletion logged with its target',
      );
      check(
        /SUSPEND/i.test(log) && log.includes(S.id),
        'suspension logged with its target',
      );
    });

    await tc('12.48', async () => {
      const airline = await createAirline(t);
      const f = String(
        (await createFlight(t, { airlineId: airline, day: 3 }))._id,
      );
      const h = await U.agent
        .post('/api/flight-bookings/hold')
        .send({ outboundFlightId: f, cabin: 'Economy', passengers: [adult()] });
      await t
        .model('FlightBooking')
        .updateOne({ _id: h.body._id }, { $set: { status: 'Expired' } });
      const c1 = await U.agent
        .post(`/api/flight-bookings/${h.body._id}/cancel`)
        .send({ refundAmount: 0 });
      check(c1.status === 409, 'cancel an Expired booking 409', c1);
      const b = await U.agent
        .post('/api/flight-bookings/hold')
        .send({ outboundFlightId: f, cabin: 'Economy', passengers: [adult()] });
      await pay(U, 'flight', b.body._id);
      await t
        .model('FlightBooking')
        .updateOne({ _id: b.body._id }, { $set: { status: 'Completed' } });
      const c2 = await U.agent
        .post(`/api/flight-bookings/${b.body._id}/cancel`)
        .send({ refundAmount: 20000 });
      check(c2.status === 409, 'cancel a Completed booking 409', c2);
      const x = await U.agent
        .post('/api/flight-bookings/hold')
        .send({ outboundFlightId: f, cabin: 'Economy', passengers: [adult()] });
      await U.agent
        .post(`/api/bookings/flight/${x.body._id}/accept-policies`)
        .send({ accepted: true })
        .expect(200);
      await U.agent.post(`/api/bookings/flight/${x.body._id}/pay`).expect(201);
      await t
        .model('FlightBooking')
        .updateOne({ _id: x.body._id }, { $set: { status: 'Cancelled' } });
      await webhookSuccess();
      check(
        (await t.model('FlightBooking').findById(x.body._id).lean<any>())
          .status === 'Cancelled',
        'a payment for a Cancelled booking does not confirm it',
      );
    });

    await tc('12.49', async () => {
      const airline = await createAirline(t);
      const air = await airlineModerator(t, airline);
      const f = String(
        (await createFlight(t, { airlineId: airline, day: 6 }))._id,
      );
      const b = await U.agent
        .post('/api/flight-bookings/hold')
        .send({ outboundFlightId: f, cabin: 'Economy', passengers: [adult()] });
      await pay(U, 'flight', b.body._id);
      await air.agent
        .patch(`/api/flights/${f}`)
        .send({
          departureLocal: '2099-12-06T13:00',
          arrivalLocal: '2099-12-06T18:00',
        })
        .expect(200);
      const types = async (id: string) =>
        (
          await t
            .model('Notification')
            .find({ userId: new Types.ObjectId(id) })
            .lean<any[]>()
        ).map((x) => x.type);
      check(
        (await types(U.id)).includes('FLIGHT_SCHEDULE_CHANGED'),
        'schedule change notified',
      );
      const S = await traveler(t, 'TEST Notify');
      await adm.agent
        .patch(`/api/admin/accounts/${S.id}/suspend`)
        .send({})
        .expect(200);
      check(
        (await types(S.id)).includes('ACCOUNT_SUSPENDED'),
        'account suspension notified',
      );
      await adm.agent
        .patch(`/api/admin/providers/airline/${airline}/deactivate`)
        .expect(200);
      check(
        (await types(air.id)).includes('PROVIDER_SUSPENDED'),
        'provider deactivation notified to its moderator',
      );
    });

    await tc('12.50', async () => {
      const email = `invite-${Date.now()}@test.local`;
      await adm.agent
        .post('/api/admin/moderators')
        .send({
          name: 'TEST Invitee',
          email,
          role: 'hotel_moderator',
          providerId: hotel,
          temporaryPassword: 'TempPass123',
        })
        .expect(201);
      check(t.outbox.to(email).length === 1, 'invitation email (GEN-01-B)');
    });

    await tc('12.51', async () => {
      const pub = (
        await t
          .http()
          .get('/api/itineraries/public/search')
          .query({ keyword: 'Long trip' })
      ).body.data[0];
      const ok = await V.agent
        .post('/api/favourites')
        .send({ type: 'itinerary', id: idOf(pub) });
      check(ok.status === 201, 'favourite a public itinerary', ok);
      const priv = idOf(
        (
          await A.agent
            .post('/api/itineraries')
            .send({
              title: 'TEST secret',
              countries: ['EG'],
              startDate: '2099-12-01',
            })
        ).body,
      );
      const no = await V.agent
        .post('/api/favourites')
        .send({ type: 'itinerary', id: priv });
      check(no.status === 404, 'a private itinerary 404', no);
      const list = await V.agent.get('/api/favourites');
      check(
        JSON.stringify(list.body).includes(idOf(pub)),
        'listed (BON-02)',
        list,
      );
    });

    await tc('12.52', async () => {
      const R = await traveler(t, 'TEST Reset');
      await t
        .http()
        .post('/api/auth/forgot-password')
        .send({ email: R.email })
        .expect(200);
      const first = t.outbox.token(R.email, 'reset-password');
      await t
        .http()
        .post('/api/auth/forgot-password')
        .send({ email: R.email })
        .expect(200);
      const second = t.outbox.token(R.email, 'reset-password');
      const old = await t
        .http()
        .post('/api/auth/reset-password')
        .send({ token: first, newPassword: 'Another123' });
      check(
        old.status === 400,
        'the first link is invalidated by the newer request',
        old,
      );
      await t
        .model(User.name)
        .updateOne(
          { _id: R.id },
          { $set: { passwordResetExpiresAt: new Date(Date.now() - 1000) } },
        );
      const late = await t
        .http()
        .post('/api/auth/reset-password')
        .send({ token: second, newPassword: 'Another123' });
      check(late.status === 400, 'an expired link 400', late);
      const u = await t.model(User.name).findById(R.id).lean<any>();
      void u;
      return 'the 30-minute expiry itself is set in auth.service (RESET_MINUTES)';
    });

    void login;
    void TEST_PASSWORD;
    expect(results.filter((r) => !r.ok).map((r) => r.id)).toEqual([]);
  }, 480_000);
});
