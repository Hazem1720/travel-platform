// Milestone 1 test plan (the team's "Milestone 1 Test Plan" doc), Part 8 (itineraries),
// cases 8.1-8.18. Every case runs even if an earlier one fails; results are
// printed at the end. Exchange rates are arranged as today's cached rates
// (the FX API is never called); where the spec names no status code, any
// refusal (4xx) passes and the code is recorded.
import * as request from 'supertest';
import { Types } from 'mongoose';
import { SUPPORTED_CURRENCIES } from '../../src/common/constants/currencies';
import { createTestApp, TestApp } from '../e2e/app';
import { Actor, admin, hotelModerator, traveler } from '../e2e/actors';
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
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const idOf = (b: any) => String(b?._id ?? b?.id);

describe('Test plan Part 8: itineraries', () => {
  let t: TestApp;
  let A: Actor, B: Actor;

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

  beforeAll(async () => {
    t = await createTestApp('part8-itineraries');
    await seedReference(t);
    const rates: Record<string, number> = {};
    for (const c of SUPPORTED_CURRENCIES)
      rates[c] = c === 'EGP' ? 50 : c === 'EUR' ? 0.9 : 1;
    rates.USD = 1;
    await t.model('ExchangeRate').create({
      date: new Date().toISOString().slice(0, 10),
      base: 'USD',
      rates,
      fetchedAt: new Date(),
    });
    A = await traveler(t, 'TEST A');
    B = await traveler(t, 'TEST B');
  }, 90_000);

  afterAll(async () => {
    const pass = results.filter((r) => r.ok).length;
    console.log(
      `\nPART 8 RESULTS: ${pass}/${results.length} passed\n` +
        results
          .map(
            (r) =>
              `${r.ok ? 'PASS' : 'FAIL'} ${r.id}${r.note ? '  ' + r.note : ''}`,
          )
          .join('\n'),
    );
    await t?.close();
  });

  it('runs cases 8.1-8.18 (ITN-01, ITN-03, ITN-05, ITN-07, ITN-08, ITN-10, ITN-12, ITN-14, ITN-16, ITN-20, ITN-21, ITN-25, ITN-26, ITN-27, ITN-28) [partial: ACC-11, ACC-12]', async () => {
    const get = (who: Actor, id: string) =>
      who.agent.get(`/api/itineraries/${id}`);
    let I = '';
    await tc('8.1', async () => {
      const r = await A.agent.post('/api/itineraries').send({
        title: 'TEST Egypt in winter',
        countries: ['EG', 'FR'],
        startDate: '2099-12-10',
      });
      check(r.status === 201, 'create 201', r);
      I = idOf(r.body);
      check(r.body.visibility === 'Private', 'Private by default', r);
      check(
        Array.isArray(r.body.days) && r.body.days.length === 0,
        'no days until added',
        r,
      );
    });

    await tc('8.2', async () => {
      for (const [what, body] of [
        [
          'empty title',
          { title: '', countries: ['EG'], startDate: '2099-12-10' },
        ],
        [
          '101-character title',
          {
            title: 'x'.repeat(101),
            countries: ['EG'],
            startDate: '2099-12-10',
          },
        ],
        [
          'no country',
          { title: 'TEST', countries: [], startDate: '2099-12-10' },
        ],
        [
          'unknown country',
          { title: 'TEST', countries: ['XX'], startDate: '2099-12-10' },
        ],
        ['no start date', { title: 'TEST', countries: ['EG'] }],
        [
          'bad date',
          { title: 'TEST', countries: ['EG'], startDate: '2099-13-40' },
        ],
      ] as const) {
        const r = await A.agent.post('/api/itineraries').send(body);
        check(r.status === 400, `${what} -> 400`, r);
      }
      const ok = await A.agent.post('/api/itineraries').send({
        title: 'x'.repeat(100),
        countries: ['EG'],
        startDate: '2099-12-10',
      });
      check(ok.status === 201, '100 characters is fine', ok);
    });

    await tc('8.3', async () => {
      await B.agent
        .post('/api/itineraries')
        .send({
          title: 'TEST B trip',
          countries: ['EG'],
          startDate: '2099-12-10',
        })
        .expect(201);
      const r = await A.agent.get('/api/itineraries');
      check(r.status === 200 && !!r.body.meta, 'list 200, paginated', r);
      check(
        r.body.data.length === 2 &&
          !JSON.stringify(r.body).includes('TEST B trip'),
        "only A's two itineraries",
        r,
      );
    });

    await tc('8.4', async () => {
      const g = await get(B, I);
      const p = await B.agent
        .patch(`/api/itineraries/${I}`)
        .send({ title: 'hacked' });
      const d = await B.agent.delete(`/api/itineraries/${I}`);
      const day = await B.agent
        .post(`/api/itineraries/${I}/days`)
        .send({ cityId: 'cairo' });
      check(
        [g, p, d, day].every((r) => r.status === 404),
        `all 404 (got ${[g, p, d, day].map((r) => r.status)})`,
      );
    });

    const days: string[] = [];
    await tc('8.6', async () => {
      for (const city of ['cairo', 'cairo', 'paris']) {
        const r = await A.agent
          .post(`/api/itineraries/${I}/days`)
          .send({ cityId: city });
        check(r.status === 201, `add day in ${city}`, r);
      }
      const noCity = await A.agent.post(`/api/itineraries/${I}/days`).send({});
      check(noCity.status === 400, 'day without a city 400 (ITN-05)', noCity);
      const badCity = await A.agent
        .post(`/api/itineraries/${I}/days`)
        .send({ cityId: 'atlantis' });
      check(badCity.status === 400, 'unknown city 400', badCity);
      let it = (await get(A, I)).body;
      it.days.forEach((d: any) => days.push(idOf(d)));
      check(
        it.days.map((d: any) => String(d.date).slice(0, 10)).join() ===
          '2099-12-10,2099-12-11,2099-12-12',
        'dates from the start date',
        { status: 200, body: it } as any,
      );
      const s = JSON.stringify(it);
      check(/group/i.test(s), 'city groups shown (ITN-09)', {
        status: 200,
        body: it,
      } as any);
      const ed = await A.agent
        .patch(`/api/itineraries/${I}/days/${days[1]}`)
        .send({ notes: 'TEST museum day' });
      check(ed.status === 200, 'edit a day', ed);
      const re = await A.agent
        .patch(`/api/itineraries/${I}/days/reorder`)
        .send({ dayId: days[2], newPosition: 1 });
      check(re.status === 200, 'move Paris to day 1', re);
      it = (await get(A, I)).body;
      check(
        it.days[0].cityId === 'paris' &&
          String(it.days[0].date).startsWith('2099-12-10'),
        'Paris is now day 1 on the start date',
        { status: 200, body: it } as any,
      );
      const del = await A.agent.delete(`/api/itineraries/${I}/days/${days[0]}`);
      check(del.status === 200 || del.status === 204, 'delete a day', del);
      it = (await get(A, I)).body;
      check(
        it.days.length === 2 &&
          String(it.days[1].date).startsWith('2099-12-11'),
        'renumbered, dates recalculated (ITN-07)',
        { status: 200, body: it } as any,
      );
      days.length = 0;
      it.days.forEach((d: any) => days.push(idOf(d)));
      await A.agent
        .post(`/api/itineraries/${I}/days`)
        .send({ cityId: 'cairo' })
        .expect(201);
      days.push(idOf((await get(A, I)).body.days[2]));
    });

    await tc('8.5', async () => {
      const r = await A.agent
        .patch(`/api/itineraries/${I}`)
        .send({ startDate: '2099-12-20' });
      check(r.status === 200, 'change start date', r);
      const it = (await get(A, I)).body;
      check(
        it.days.map((d: any) => String(d.date).slice(0, 10)).join() ===
          '2099-12-20,2099-12-21,2099-12-22',
        'every day shifts',
        { status: 200, body: it } as any,
      );
    });

    await tc('8.7', async () => {
      const base = `/api/itineraries/${I}/days/${days[1]}/activities`;
      const r = await A.agent.post(base).send({
        name: 'TEST Egyptian Museum',
        time: '10:00',
        cost: { amount: 500, currency: 'EGP' },
      });
      check(r.status === 201, 'add activity', r);
      const it = (await get(A, I)).body;
      const act = it.days[1].activities[0];
      const aid = idOf(act);
      check(act.name === 'TEST Egyptian Museum', 'shown on the day', {
        status: 200,
        body: it,
      } as any);
      const ed = await A.agent
        .patch(`/api/activities/${aid}`)
        .send({ time: '11:30' });
      check(ed.status === 200, 'edit activity', ed);
      const bad = await A.agent
        .post(base)
        .send({ name: 'TEST', time: '25:00' });
      check(bad.status === 400, 'bad time 400', bad);
      const neg = await A.agent
        .post(base)
        .send({ name: 'TEST', cost: { amount: -1, currency: 'EGP' } });
      check(neg.status === 400, 'negative cost 400', neg);
      const img = await A.agent
        .post(`/api/activities/${aid}/images`)
        .attach('images', PNG, 'a.png');
      check(
        img.status === 201 || img.status === 200,
        'activity image upload (ITN-12)',
        img,
      );
      const url =
        JSON.stringify(img.body).match(/\/api\/uploads\/[\w.-]+/)?.[0] ?? '';
      const di = await A.agent.delete(
        `/api/activities/${aid}/images/${url.split('/').pop()}`,
      );
      check(di.status === 200 || di.status === 204, 'delete the image', di);
      await A.agent.post(base).send({ name: 'TEST delete me' }).expect(201);
      const acts = (await get(A, I)).body.days[1].activities;
      const del = await A.agent.delete(
        `/api/activities/${idOf(acts[acts.length - 1])}`,
      );
      check(del.status === 200 || del.status === 204, 'delete activity', del);
      const other = await B.agent
        .patch(`/api/activities/${aid}`)
        .send({ name: 'hacked' });
      check(other.status === 404, "another user's activity 404", other);
      check(
        (await get(A, I)).body.days[1].activities.length === 1,
        'one activity left',
      );
    });

    await tc('8.8', async () => {
      const b1 = await A.agent
        .post(`/api/itineraries/${I}/days/${days[1]}/budgets`)
        .send({ category: 'accommodation', amount: 90, currency: 'EUR' });
      check(b1.status === 201, 'budget 90 EUR', b1);
      const neg = await A.agent
        .post(`/api/itineraries/${I}/days/${days[1]}/budgets`)
        .send({ category: 'food', amount: -5, currency: 'EGP' });
      check(neg.status === 400, 'negative amount 400 (ITN-14)', neg);
      const cat = await A.agent
        .post(`/api/itineraries/${I}/days/${days[1]}/budgets`)
        .send({ category: 'shopping', amount: 5, currency: 'EGP' });
      check(cat.status === 400, 'unknown category 400', cat);
      const cur = await A.agent
        .post(`/api/itineraries/${I}/days/${days[1]}/budgets`)
        .send({ category: 'food', amount: 5, currency: 'XYZ' });
      check(cur.status === 400, 'unsupported currency 400', cur);
      const food = await A.agent
        .post(`/api/itineraries/${I}/days/${days[0]}/budgets`)
        .send({ category: 'food', amount: 250, currency: 'EGP' });
      check(food.status === 201, 'budget 250 EGP food', food);
      const tr = await A.agent
        .post(`/api/itineraries/${I}/transport-costs`)
        .send({
          mode: 'flight',
          fromCityId: 'paris',
          toCityId: 'cairo',
          amount: 500,
          currency: 'EGP',
          dayId: days[1],
        });
      check(tr.status === 201, 'transport cost 500 EGP (ITN-16)', tr);
      const it = (await get(A, I)).body;
      const bid = idOf(it.days[0].budgets[0]);
      const ed = await A.agent
        .patch(`/api/budgets/${bid}`)
        .send({ amount: 250 });
      check(ed.status === 200, 'edit budget', ed);
      const other = await B.agent
        .patch(`/api/budgets/${bid}`)
        .send({ amount: 1 });
      check(other.status === 404, "another user's budget 404", other);
    });

    await tc('8.9', async () => {
      await A.agent
        .patch('/api/users/me')
        .send({ preferredCurrency: 'USD' })
        .expect(200);
      const r = await A.agent.get(`/api/itineraries/${I}/budget-summary`);
      check(r.status === 200, 'summary 200', r);
      check(
        r.body.currency === 'USD' &&
          r.body.rateDate === new Date().toISOString().slice(0, 10),
        'in USD with the rate date (ITN-18)',
        r,
      );
      // 90 EUR = 100 USD; 250 EGP food = 5; activity 500 EGP = 10; train 500 EGP = 10.
      const total = Number(r.body.total?.amount ?? r.body.total);
      check(
        Math.abs(total - 125) < 0.01,
        `total 125 USD (got ${JSON.stringify(r.body.total)})`,
        r,
      );
      check(
        Array.isArray(r.body.byDay) && r.body.byDay.length === 3,
        'per day',
        r,
      );
      check(
        JSON.stringify(r.body.byCategory).includes('accommodation'),
        'per category',
        r,
      );
      const other = await B.agent.get(`/api/itineraries/${I}/budget-summary`);
      check(other.status === 404, "another user's summary 404", other);
    });

    await tc('8.10', async () => {
      const pub = await A.agent
        .patch(`/api/itineraries/${I}`)
        .send({ visibility: 'Public' });
      check(pub.status === 200, 'make public', pub);
      const s = await t
        .http()
        .get('/api/itineraries/public/search')
        .query({ keyword: 'Egypt in winter' });
      check(
        s.status === 200 && JSON.stringify(s.body).includes(I),
        'found by title keyword, logged out',
        s,
      );
      const city = await t
        .http()
        .get('/api/itineraries/public/search')
        .query({ keyword: 'paris' });
      check(
        JSON.stringify(city.body).includes(I),
        'found by city keyword (ITN-21)',
        city,
      );
      const dur = await t
        .http()
        .get('/api/itineraries/public/search')
        .query({ minDays: 5 });
      check(
        !JSON.stringify(dur.body).includes(I),
        'excluded by min 5 days',
        dur,
      );
      const v = await t.http().get(`/api/itineraries/public/${I}`);
      check(v.status === 200, 'public page 200 logged out', v);
      const edit = await B.agent
        .patch(`/api/itineraries/${I}`)
        .send({ title: 'hacked' });
      check(
        edit.status === 404 || edit.status === 403,
        'read-only for others (ITN-20)',
        edit,
      );
      const priv = await A.agent
        .patch(`/api/itineraries/${I}`)
        .send({ visibility: 'Private' });
      check(priv.status === 200, 'make private', priv);
      const gone = await t.http().get(`/api/itineraries/public/${I}`);
      check(gone.status === 404, 'private: public page 404', gone);
      const s2 = await t
        .http()
        .get('/api/itineraries/public/search')
        .query({ keyword: 'Egypt in winter' });
      check(
        !JSON.stringify(s2.body).includes(I),
        'gone from search immediately',
        s2,
      );
      await A.agent
        .patch(`/api/itineraries/${I}`)
        .send({ visibility: 'Public' })
        .expect(200);
    });

    await tc('8.11', async () => {
      const c = await B.agent.post(`/api/itineraries/${I}/clone`);
      check(c.status === 201, 'clone a public itinerary 201', c);
      check(
        c.body.visibility === 'Private' && idOf(c.body) !== I,
        'a private copy',
        c,
      );
      const mine = await B.agent.get(`/api/itineraries/${idOf(c.body)}`);
      check(
        mine.status === 200 && mine.body.days.length === 3,
        "owned by B with A's days",
        mine,
      );
      const priv = (
        await A.agent.post('/api/itineraries').send({
          title: 'TEST secret',
          countries: ['EG'],
          startDate: '2099-12-10',
        })
      ).body;
      const no = await B.agent.post(`/api/itineraries/${idOf(priv)}/clone`);
      check(no.status === 404, 'cloning a private itinerary 404', no);
    });

    await tc('8.12', async () => {
      const r = await A.agent
        .get(`/api/itineraries/${I}/pdf`)
        .buffer(true)
        .parse((res, cb) => {
          const ch: Buffer[] = [];
          res.on('data', (c: Buffer) => ch.push(c));
          res.on('end', () => cb(null, Buffer.concat(ch)));
        });
      check(
        r.status === 200 && /pdf/.test(r.headers['content-type']),
        'PDF 200',
        r,
      );
      check(
        (r.body as Buffer).subarray(0, 4).toString() === '%PDF',
        'a real PDF',
      );
      const other = await B.agent.get(
        `/api/itineraries/${(await A.agent.get('/api/itineraries')).body.data.find((x: any) => x.title === 'TEST secret')._id}/pdf`,
      );
      check(
        other.status === 404,
        "another user's private itinerary 404",
        other,
      );
    });

    const adm = await admin(t);
    const hotel = (
      await adm.agent.post('/api/hotels').send({
        name: 'TEST Cairo Inn',
        address: '1 Nile St',
        cityId: 'cairo',
        countryCode: 'EG',
        starClass: 4,
      })
    ).body._id;
    const mod = await hotelModerator(t, hotel);
    await mod.agent.put(`/api/hotels/${hotel}/policies`).send({
      checkInTime: '14:00',
      checkOutTime: '12:00',
      cancellationTiers: [{ daysBefore: 0, refundPercent: 100 }],
    });
    const room = (
      await mod.agent.post(`/api/hotels/${hotel}/rooms`).send({
        name: '1',
        type: 'Double',
        beds: 2,
        maxOccupancy: 2,
        pricePerNight: 10000,
      })
    ).body;
    const roomId = idOf(room);
    await mod.agent
      .post(`/api/hotels/${hotel}/rooms/${roomId}/availability`)
      .send({ from: '2099-12-01', to: '2099-12-31' });

    await tc('8.13', async () => {
      const r = await A.agent
        .get(`/api/itineraries/${I}/hotels`)
        .query({ groupIndex: 1, guests: 2 });
      check(r.status === 200, 'hotels for the Cairo group 200', r);
      const s = JSON.stringify(r.body);
      check(s.includes(hotel), 'the Cairo hotel offered', r);
      check(
        s.includes('2099-12-21') && s.includes('2099-12-23'),
        'check-in first day, check-out the day after the last (ITN-25)',
        r,
      );
    });

    await tc('8.14', async () => {
      const airline = await createAirline(t);
      // The first day's city is Paris after the reorder in 8.6.
      const f = await createFlight(t, {
        airlineId: airline,
        from: 'DXB',
        to: 'CDG',
        day: 20,
      });
      const r = await A.agent
        .get(`/api/itineraries/${I}/flights`)
        .query({ origin: 'DXB' });
      check(r.status === 200, 'flights from the itinerary 200 (ITN-26)', r);
      check(
        JSON.stringify(r.body).includes(String(f._id)),
        'flight to the first city on the start date',
        r,
      );
    });

    let link = '';
    let hb = '';
    await tc('8.15', async () => {
      const bk = await A.agent.post('/api/hotel-bookings').send({
        hotelId: hotel,
        checkIn: '2099-12-21',
        checkOut: '2099-12-23',
        rooms: [{ roomId, adults: 2, childAges: [] }],
      });
      check(bk.status === 201, 'A books the hotel', bk);
      hb = bk.body._id;
      await A.agent
        .post(`/api/bookings/hotel/${hb}/accept-policies`)
        .send({ accepted: true })
        .expect(200);
      await A.agent.post(`/api/bookings/hotel/${hb}/pay`).expect(201);
      await webhookSuccess();
      const r = await A.agent
        .post(`/api/itineraries/${I}/bookings`)
        .send({ type: 'hotel', bookingId: hb, dayId: days[1] });
      check(r.status === 201, 'link the Confirmed booking (ITN-27)', r);
      const list = await A.agent.get(`/api/itineraries/${I}/bookings`);
      check(
        list.status === 200 && JSON.stringify(list.body).includes(hb),
        'listed',
        list,
      );
      link = idOf((list.body.data ?? list.body)[0]);
      const sum = await A.agent.get(`/api/itineraries/${I}/budget-summary`);
      const total = Number(sum.body.total?.amount ?? sum.body.total);
      check(
        Math.abs(total - 325) < 0.01,
        `its cost (200 USD) in the budget: 125 + 200 = 325 (got ${total})`,
        sum,
      );
    });

    await tc('8.16', async () => {
      const twice = await A.agent
        .post(`/api/itineraries/${I}/bookings`)
        .send({ type: 'hotel', bookingId: hb, dayId: days[1] });
      check(twice.status === 409, 'twice 409', twice);
      const bb = await B.agent.post('/api/hotel-bookings').send({
        hotelId: hotel,
        checkIn: '2099-12-25',
        checkOut: '2099-12-26',
        rooms: [{ roomId, adults: 1, childAges: [] }],
      });
      const other = await A.agent
        .post(`/api/itineraries/${I}/bookings`)
        .send({ type: 'hotel', bookingId: bb.body._id, dayId: days[1] });
      check(other.status === 404, "another user's booking 404", other);
      const own = await A.agent.post('/api/hotel-bookings').send({
        hotelId: hotel,
        checkIn: '2099-12-27',
        checkOut: '2099-12-28',
        rooms: [{ roomId, adults: 1, childAges: [] }],
      });
      const pend = await A.agent
        .post(`/api/itineraries/${I}/bookings`)
        .send({ type: 'hotel', bookingId: own.body._id, dayId: days[1] });
      check(refused(pend), 'a booking that is not Confirmed refused', pend);
      return `pending: ${pend.status}`;
    });

    await tc('8.17', async () => {
      const r = await A.agent.delete(`/api/itineraries/${I}/bookings/${link}`);
      check(r.status === 200 || r.status === 204, 'unlink', r);
      const sum = await A.agent.get(`/api/itineraries/${I}/budget-summary`);
      const total = Number(sum.body.total?.amount ?? sum.body.total);
      check(
        Math.abs(total - 125) < 0.01,
        `budget back to 125 (got ${total})`,
        sum,
      );
    });

    await tc('8.18', async () => {
      await A.agent
        .post(`/api/hotel-bookings/${hb}/cancel`)
        .send({ refundAmount: 20000 });
      const d = await A.agent.delete('/api/users/me');
      check(d.status === 200, 'A deactivates', d);
      const v = await t.http().get(`/api/itineraries/public/${I}`);
      const s = await t
        .http()
        .get('/api/itineraries/public/search')
        .query({ keyword: 'Egypt in winter' });
      check(
        v.status === 404 && !JSON.stringify(s.body).includes(I),
        'public itinerary disappears (ACC-12)',
        v,
      );
    });

    void Types;
    expect(results.filter((r) => !r.ok).map((r) => r.id)).toEqual([]);
  }, 300_000);
});
