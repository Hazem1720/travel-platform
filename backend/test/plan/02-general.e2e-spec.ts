// Milestone 1 test plan (the team's "Milestone 1 Test Plan" doc), Part 2 (cross-cutting
// rules), cases 2.1-2.20. Every case runs even if an earlier one fails; the
// results table is printed at the end. Expected results come from the
// requirement text and docs/api/conventions.md.
import * as request from 'supertest';
import { Types } from 'mongoose';
import { Airline } from '../../src/airlines/schemas/airline.schema';
import { buildSwaggerDocument } from '../../src/app.setup';
import { NotificationType } from '../../src/notifications/schemas/notification.schema';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { UploadsService } from '../../src/uploads/uploads.service';
import { readdirSync } from 'fs';
import { createTestApp, TestApp } from '../e2e/app';
import {
  Actor,
  admin,
  airlineModerator,
  hotelModerator,
  traveler,
} from '../e2e/actors';
import { createAirline, createFlight, seedReference } from '../e2e/fixtures';

type Res = request.Response;
const results: { id: string; ok: boolean; note: string }[] = [];

function check(cond: boolean, what: string, res?: Res) {
  if (!cond) {
    const got = res
      ? ` [got ${res.status} ${JSON.stringify(res.body).slice(0, 220)}]`
      : '';
    throw new Error(what + got);
  }
}
// A refused upload. Multer stops reading at its size or file-count limit
// and answers while the client is still sending, so on some systems the
// client sees the connection reset instead of the 400/413. A reset counts
// as refused only if the server stored no new file.
async function refusedUpload(
  send: () => Promise<Res>,
  storedFiles: () => number,
): Promise<string> {
  const before = storedFiles();
  try {
    const res = await send();
    return `${res.status}`;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== 'ECONNRESET' && code !== 'EPIPE') throw err;
    return storedFiles() === before
      ? 'reset, nothing stored'
      : 'reset, FILE STORED';
  }
}
async function tc(id: string, fn: () => Promise<string | void>) {
  try {
    const note = await fn();
    results.push({ id, ok: true, note: note || '' });
  } catch (e) {
    results.push({ id, ok: false, note: (e as Error).message.slice(0, 500) });
  }
}

// A 1x1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('Test plan Part 2: cross-cutting rules', () => {
  let t: TestApp;
  let A: Actor,
    B: Actor,
    adm: Actor,
    airModX: Actor,
    airModY: Actor,
    hotModX: Actor,
    hotModY: Actor;
  let airlineX: Types.ObjectId, flightX: any, hotelX: string, hotelY: string;

  beforeAll(async () => {
    t = await createTestApp('part2-general');
    await seedReference(t);
    A = await traveler(t, 'TEST A');
    B = await traveler(t, 'TEST B');
    adm = await admin(t);
    airlineX = await createAirline(t);
    const airlineY = await createAirline(t);
    airModX = await airlineModerator(t, airlineX);
    airModY = await airlineModerator(t, airlineY);
    flightX = await createFlight(t, { airlineId: airlineX });
    const hotel = (name: string) =>
      adm.agent.post('/api/hotels').send({
        name,
        address: '1 Nile St',
        cityId: 'cairo',
        countryCode: 'EG',
        starClass: 4,
      });
    hotelX = (await hotel('TEST Hotel X')).body._id;
    hotelY = (await hotel('TEST Hotel Y')).body._id;
    hotModX = await hotelModerator(t, hotelX);
    hotModY = await hotelModerator(t, hotelY);
  }, 90_000);

  afterAll(async () => {
    const pass = results.filter((r) => r.ok).length;
    console.log(
      `\nPART 2 RESULTS: ${pass}/${results.length} passed\n` +
        results
          .map(
            (r) =>
              `${r.ok ? 'PASS' : 'FAIL'} ${r.id}${r.note ? '  ' + r.note : ''}`,
          )
          .join('\n'),
    );
    await t?.close();
  });

  it('runs cases 2.1-2.20 (ACC-11, FLT-02, PAY-04, GEN-01, GEN-01-B, GEN-06, GEN-08, GEN-12, GEN-13) [partial: FLT-03]', async () => {
    const anon = () => t.http();

    await tc('2.1', async () => {
      const samples: [string, Res][] = [
        ['400', await anon().post('/api/auth/register').send({})],
        ['401', await anon().get('/api/auth/me')],
        ['403', await A.agent.get('/api/admin/accounts')],
        [
          '404',
          await A.agent.get(`/api/flight-bookings/${new Types.ObjectId()}`),
        ],
        [
          '409',
          await anon().post('/api/auth/register').send({
            name: 'TEST',
            email: A.email,
            password: 'Passw0rd1',
            acceptTerms: true,
          }),
        ],
      ];
      for (const [code, res] of samples) {
        check(String(res.status) === code, `expected ${code}`, res);
        for (const k of [
          'statusCode',
          'error',
          'message',
          'path',
          'timestamp',
        ]) {
          check(k in res.body, `${code}: body has ${k}`, res);
        }
        check(
          !JSON.stringify(res.body).includes('    at '),
          `${code}: no stack trace`,
          res,
        );
      }
      const v = samples[0][1];
      check(
        v.body.message === 'Validation failed' &&
          typeof v.body.details === 'object',
        '400 has message "Validation failed" + details',
        v,
      );
    });

    await tc('2.2', async () => {
      const res = await A.agent.post('/api/itineraries').send({
        title: 'TEST',
        countries: ['EG'],
        startDate: '2099-01-01',
        hacker: true,
      });
      check(res.status === 400, 'unknown field -> 400', res);
      check(
        JSON.stringify(res.body.details ?? {}).includes('hacker'),
        'details names the field',
        res,
      );
    });

    await tc('2.3', async () => {
      const r1 = await A.agent
        .post('/api/itineraries')
        .send({ title: 123, countries: 'EG', startDate: 'not-a-date' });
      check(r1.status === 400, 'wrong types -> 400', r1);
      const r2 = await anon().get('/api/flights/search').query({
        from: 'CAI',
        to: 'DXB',
        date: '2099-13-45',
        passengers: 'abc',
      });
      check(r2.status === 400, 'bad date / number in query -> 400', r2);
    });

    await tc('2.4', async () => {
      const notes: string[] = [];
      for (const [who, path] of [
        [anon(), '/api/flights/abc'],
        [anon(), '/api/hotels/abc'],
        [anon(), '/api/posts/abc'],
        [A.agent, '/api/itineraries/abc'],
        [A.agent, '/api/flight-bookings/abc'],
        [A.agent, '/api/hotel-bookings/abc'],
      ] as const) {
        const res = await (who as any).get(path);
        check(
          res.status === 400 || res.status === 404,
          `${path} -> 400/404`,
          res,
        );
        notes.push(`${path}:${res.status}`);
      }
      return notes.join(' ');
    });

    await tc('2.5', async () => {
      for (const path of [
        '/api/flight-bookings',
        '/api/hotel-bookings',
        '/api/itineraries',
        '/api/notifications',
        '/api/users/me',
        '/api/admin/accounts',
        '/api/posts/mine',
        '/api/favourites',
      ]) {
        const res = await anon().get(path);
        check(res.status === 401, `${path} without session -> 401`, res);
      }
    });

    await tc('2.6', async () => {
      const pairs: [Actor, 'get' | 'post', string][] = [
        [A, 'get', '/api/admin/accounts'],
        [A, 'post', '/api/flights'],
        [A, 'post', '/api/hotels'],
        [airModX, 'get', '/api/admin/bookings'],
        [airModX, 'post', '/api/hotels'],
        [hotModX, 'post', '/api/flights'],
        [hotModX, 'post', '/api/admin/moderators'],
      ];
      for (const [who, m, path] of pairs) {
        const res = await (who.agent as any)[m](path).send({});
        check(res.status === 403, `${path} with the wrong role -> 403`, res);
      }
    });

    await tc('2.7', async () => {
      const it = await A.agent.post('/api/itineraries').send({
        title: 'TEST private',
        countries: ['EG'],
        startDate: '2099-01-01',
      });
      check(it.status === 201, 'A creates an itinerary', it);
      const id = it.body._id ?? it.body.id;
      for (const [m, path] of [
        ['get', `/api/itineraries/${id}`],
        ['patch', `/api/itineraries/${id}`],
        ['delete', `/api/itineraries/${id}`],
      ] as const) {
        const res = await (B.agent as any)
          [m](path)
          .send(m === 'patch' ? { title: 'hacked' } : undefined);
        check(res.status === 404, `B ${m} A's itinerary -> 404`, res);
      }
      const hold = await A.agent.post('/api/flight-bookings/hold').send({
        outboundFlightId: String(flightX._id),
        cabin: 'Economy',
        passengers: [
          {
            type: 'adult',
            fullName: 'TEST A',
            dateOfBirth: '1990-01-01',
            passportNumber: 'A1234567',
          },
        ],
      });
      check(hold.status === 201, 'A holds a flight', hold);
      const fb = await B.agent.get(`/api/flight-bookings/${hold.body._id}`);
      check(fb.status === 404, "B opens A's booking -> 404", fb);
      const n = await t.app
        .get(NotificationsService)
        .create(
          new Types.ObjectId(A.id),
          NotificationType.BOOKING_CONFIRMED,
          'TEST',
          {},
        );
      const nid = String((n as any)._id ?? (n as any).id);
      const rn = await B.agent.patch(`/api/notifications/${nid}/read`);
      check(rn.status === 404, "B marks A's notification read -> 404", rn);
      const adminView = await adm.agent.get(
        `/api/flight-bookings/${hold.body._id}`,
      );
      return `admin GET /flight-bookings/:id of A: ${adminView.status}`;
    });

    await tc('2.8', async () => {
      const f = await airModY.agent.patch(`/api/flights/${flightX._id}`).send({
        departureLocal: '2099-12-02T11:00',
        arrivalLocal: '2099-12-02T17:00',
      });
      check(f.status === 403, "airline Y edits airline X's flight -> 403", f);
      const c = await airModY.agent
        .post(`/api/flights/${flightX._id}/cabins`)
        .send({
          category: 'Business',
          totalSeats: 2,
          price: 50000,
          freeBags: 2,
          maxKgPerBag: 32,
        });
      check(c.status === 403, "airline Y adds a cabin to X's flight -> 403", c);
      const h = await hotModY.agent
        .patch(`/api/hotels/${hotelX}`)
        .send({ description: 'hacked' });
      check(h.status === 403, 'hotel Y edits hotel X -> 403', h);
      const r = await hotModY.agent.get(`/api/hotels/${hotelX}/reservations`);
      check(r.status === 403, "hotel Y lists X's reservations -> 403", r);
    });

    await tc('2.9', async () => {
      for (const [path, q] of [
        [
          '/api/flights/search',
          { from: 'CAI', to: 'DXB', date: '2099-12-02', passengers: 1 },
        ],
        [`/api/flights/${flightX._id}`, {}],
        [`/api/hotels/${hotelX}`, {}],
        [`/api/hotels/${hotelX}/reviews`, {}],
        ['/api/itineraries/public/search', {}],
        ['/api/posts', {}],
        ['/api/reference/countries', {}],
        ['/api/airports', {}],
      ] as const) {
        const res = await anon()
          .get(path)
          .query(q as any);
        check(res.status === 200, `${path} logged out -> 200`, res);
      }
    });

    await tc('2.10', async () => {
      for (let i = 1; i <= 12; i++) {
        const r = await A.agent.post('/api/posts').send({
          title: `TEST post ${i}`,
          body: 'TEST body text',
          status: 'Published',
        });
        check(r.status === 201, `post ${i} created`, r);
      }
      const p1 = await anon().get('/api/posts').query({ page: 1 });
      check(
        p1.status === 200 && p1.body.data.length === 10,
        'page 1 has 10 items',
        p1,
      );
      const m = p1.body.meta;
      check(
        m &&
          m.page === 1 &&
          m.limit === 10 &&
          m.total >= 12 &&
          m.totalPages >= 2,
        'meta page/limit/total/totalPages',
        p1,
      );
      const p2 = await anon().get('/api/posts').query({ page: 2 });
      check(p2.body.data.length >= 2, 'page 2 has the rest', p2);
      const ids1 = new Set(p1.body.data.map((x: any) => x._id ?? x.id));
      check(
        !p2.body.data.some((x: any) => ids1.has(x._id ?? x.id)),
        'no item on both pages',
      );
      const far = await anon().get('/api/posts').query({ page: 999 });
      check(
        far.status === 200 &&
          Array.isArray(far.body.data) &&
          far.body.data.length === 0,
        'page 999 -> empty data',
        far,
      );
    });

    await tc('2.11', async () => {
      for (const page of ['0', '-1', 'abc', '1.5']) {
        const res = await anon().get('/api/posts').query({ page });
        check(res.status === 400, `page=${page} -> 400`, res);
      }
    });

    await tc('2.12', async () => {
      const counts: string[] = [];
      for (const path of [
        '/api/reference/countries',
        '/api/reference/cities',
        '/api/reference/currencies',
        '/api/reference/attractions',
        '/api/airports',
      ]) {
        const res = await anon().get(path);
        check(res.status === 200, `${path} 200`, res);
        const list = Array.isArray(res.body) ? res.body : res.body.data;
        check(
          Array.isArray(list) && list.length > 0,
          `${path} has seeded values`,
          res,
        );
        check(
          !JSON.stringify(res.body).includes('"__v"'),
          `${path} has no __v`,
          res,
        );
        counts.push(`${path.split('/').pop()}:${list.length}`);
      }
      const cur = await anon().get('/api/reference/currencies');
      const codes = JSON.stringify(cur.body);
      check(codes.includes('USD'), 'USD is a supported currency', cur);
      return counts.join(' ');
    });

    await tc('2.13', async () => {
      const f = await anon().get(`/api/flights/${flightX._id}`);
      const prices: string[] =
        JSON.stringify(f.body).match(/"price":\s*([\d.]+)/g) ?? [];
      check(prices.length > 0, 'flight shows a price', f);
      check(
        prices.every((p) => Number.isInteger(Number(p.split(':')[1]))),
        'prices are integer cents',
        f,
      );
      const q = await A.agent.post('/api/flight-bookings').send({
        outboundFlightId: String(flightX._id),
        cabin: 'Economy',
        passengers: [
          {
            type: 'adult',
            fullName: 'TEST A',
            dateOfBirth: '1990-01-01',
            passportNumber: 'A1234567',
            extraBags: [{ weightKg: 20 }],
          },
        ],
      });
      check(q.status === 200 || q.status === 201, 'quote ok', q);
      const total = q.body?.price?.total;
      check(Number.isInteger(total), 'quote total is integer cents', q);
      check(JSON.stringify(q.body).includes('USD'), 'currency is USD', q);
      return `quote total ${total}`;
    });

    await tc('2.14', async () => {
      const code = (await t.model(Airline.name).findById(airlineX).lean<any>())
        .code;
      const res = await airModX.agent.post('/api/flights').send({
        flightNumber: `${code}777`,
        from: 'CAI',
        to: 'DXB',
        departureLocal: '2099-12-10T10:00',
        arrivalLocal: '2099-12-10T15:30',
      });
      check(res.status === 201, 'flight created', res);
      const stored = await t.model('Flight').findById(res.body._id).lean<any>();
      check(
        new Date(stored.departureAt).toISOString() ===
          '2099-12-10T08:00:00.000Z',
        `CAI 10:00 stored as 08:00 UTC (got ${new Date(stored.departureAt).toISOString()})`,
      );
      check(
        new Date(stored.arrivalAt).toISOString() === '2099-12-10T11:30:00.000Z',
        `DXB 15:30 stored as 11:30 UTC (got ${new Date(stored.arrivalAt).toISOString()})`,
      );
      const view = await anon().get(`/api/flights/${res.body._id}`);
      const s = JSON.stringify(view.body);
      check(
        s.includes('10:00') && s.includes('15:30'),
        'details show each airport local time',
        view,
      );
    });

    await tc('2.15', async () => {
      const code = (await t.model(Airline.name).findById(airlineX).lean<any>())
        .code;
      const past = await airModX.agent.post('/api/flights').send({
        flightNumber: `${code}778`,
        from: 'CAI',
        to: 'DXB',
        departureLocal: '2020-01-01T10:00',
        arrivalLocal: '2020-01-01T14:00',
      });
      check(
        past.status === 400 || past.status === 409,
        'past flight refused',
        past,
      );
      const neg = await airModX.agent
        .post(`/api/flights/${flightX._id}/cabins`)
        .send({
          category: 'Business',
          totalSeats: 2,
          price: -5,
          freeBags: 1,
          maxKgPerBag: 23,
        });
      check(neg.status === 400, 'negative price refused', neg);
      const same = await airModX.agent.post('/api/flights').send({
        flightNumber: `${code}779`,
        from: 'CAI',
        to: 'CAI',
        departureLocal: '2099-01-01T10:00',
        arrivalLocal: '2099-01-01T12:00',
      });
      check(same.status === 400, 'same airports refused', same);
    });

    await tc('2.16', async () => {
      const doc: any = buildSwaggerDocument(t.app);
      let ops = 0;
      const noSummary: string[] = [];
      const no401: string[] = [];
      for (const [path, item] of Object.entries<any>(doc.paths)) {
        for (const [method, op] of Object.entries<any>(item)) {
          ops++;
          const label = `${method.toUpperCase()} ${path}`;
          if (!op.summary) noSummary.push(label);
          const isPublic = !op.security || op.security.length === 0;
          if (!isPublic && !op.responses?.['401']) no401.push(label);
        }
      }
      check(
        noSummary.length === 0,
        `routes without a summary: ${noSummary.join(', ')}`,
      );
      check(
        no401.length === 0,
        `protected routes without a 401: ${no401.join(', ')}`,
      );
      return `${ops} operations documented`;
    });

    await tc('2.17', async () => {
      const ns = t.app.get(NotificationsService);
      for (let i = 0; i < 3; i++)
        await ns.create(
          new Types.ObjectId(B.id),
          NotificationType.BOOKING_CONFIRMED,
          `TEST ${i}`,
          {},
        );
      const list = await B.agent.get('/api/notifications');
      check(
        list.status === 200 && list.body.data.length >= 3,
        'list shows them',
        list,
      );
      const c1 = await B.agent.get('/api/notifications/unread-count');
      const before = c1.body.count ?? c1.body.unread ?? c1.body;
      check(Number(before) >= 3, 'unread count >= 3', c1);
      const one = await B.agent.patch(
        `/api/notifications/${list.body.data[0]._id ?? list.body.data[0].id}/read`,
      );
      check(one.status === 200, 'mark one read 200', one);
      const c2 = await B.agent.get('/api/notifications/unread-count');
      check(
        Number(c2.body.count ?? c2.body.unread ?? c2.body) ===
          Number(before) - 1,
        'count drops by 1',
        c2,
      );
      const all = await B.agent.patch('/api/notifications/read-all');
      check(all.status === 200, 'read-all 200', all);
      const c3 = await B.agent.get('/api/notifications/unread-count');
      check(
        Number(c3.body.count ?? c3.body.unread ?? c3.body) === 0,
        'count 0 after read-all',
        c3,
      );
    });

    await tc('2.18', async () => {
      const ns = t.app.get(NotificationsService);
      const before = t.outbox.to(A.email).length;
      await ns.create(
        new Types.ObjectId(A.id),
        NotificationType.BOOKING_CONFIRMED,
        'TEST booking confirmed',
        {},
      );
      await new Promise((r) => setTimeout(r, 300));
      const mails = t.outbox.to(A.email);
      check(
        mails.length === before + 1,
        'an email was sent for the notification',
      );
      return `subject: "${mails[mails.length - 1]?.subject}"`;
    });

    await tc('2.19', async () => {
      const ok = await A.agent
        .post('/api/uploads/images')
        .attach('images', PNG, 'pic.png');
      check(ok.status === 201, 'PNG upload 201', ok);
      const txt = await A.agent
        .post('/api/uploads/images')
        .attach('images', Buffer.from('hello'), 'notes.png');
      check(txt.status === 400, 'non-image named .png -> 400', txt);
      const stored = () => {
        try {
          return readdirSync(t.app.get(UploadsService).dir).length;
        } catch {
          return 0;
        }
      };
      const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024 + 10)]);
      const large = await refusedUpload(
        () =>
          A.agent.post('/api/uploads/images').attach('images', big, 'big.png'),
        stored,
      );
      check(
        ['400', '413', 'reset, nothing stored'].includes(large),
        `over 5 MB refused (got ${large})`,
      );
      const r6 = await refusedUpload(() => {
        const six = A.agent.post('/api/uploads/images');
        for (let i = 0; i < 6; i++) six.attach('images', PNG, `p${i}.png`);
        return six;
      }, stored);
      check(
        ['400', 'reset, nothing stored'].includes(r6),
        `more than 5 files refused (got ${r6})`,
      );
      const anonUp = await anon()
        .post('/api/uploads/images')
        .attach('images', PNG, 'pic.png');
      check(anonUp.status === 401, 'upload needs a session', anonUp);
    });

    await tc('2.20', async () => {
      const bad = await anon()
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"email": "x",');
      check(bad.status === 400, 'malformed JSON -> 400', bad);
      check(
        !JSON.stringify(bad.body).includes('    at '),
        'no stack trace',
        bad,
      );
      const next = await anon().get('/api/reference/countries');
      check(next.status === 200, 'API keeps answering', next);
    });

    expect(results.filter((r) => !r.ok).map((r) => r.id)).toEqual([]);
  }, 180_000);
});
