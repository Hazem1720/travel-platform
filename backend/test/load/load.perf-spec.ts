// Milestone 1 test plan, Part 16 (load and
// performance). The real app listens on a port and is hit by many clients
// at once through keep-alive HTTP, like browsers would. Each scenario
// reports throughput and latency percentiles; it fails on any 5xx, any lost
// request, any oversold seat or room, or a p95 above its budget.
// Runs on a GitHub runner (2 vCPU) with an in-memory MongoDB, so absolute
// numbers are a floor, not what a real server would do.
import * as http from 'http';
import { AddressInfo } from 'net';
import { createTestApp, TestApp } from '../e2e/app';
import {
  admin,
  hotelModerator,
  TEST_PASSWORD,
  traveler,
  Actor,
} from '../e2e/actors';
import { createAirline, createFlight, seedReference } from '../e2e/fixtures';

const results: { id: string; ok: boolean; note: string }[] = [];
async function tc(id: string, fn: () => Promise<string | void>) {
  try {
    results.push({ id, ok: true, note: (await fn()) || '' });
  } catch (e) {
    results.push({ id, ok: false, note: (e as Error).message.slice(0, 600) });
  }
}
function check(cond: boolean, what: string) {
  if (!cond) throw new Error(what);
}

type Hit = { status: number; ms: number; body: string; setCookie?: string[] };
const agent = new http.Agent({ keepAlive: true, maxSockets: 256 });
let PORT = 0;
function call(
  method: string,
  path: string,
  opts: { body?: object; cookie?: string } = {},
): Promise<Hit> {
  return new Promise((resolve) => {
    const data = opts.body ? JSON.stringify(opts.body) : undefined;
    const start = process.hrtime.bigint();
    const req = http.request(
      {
        host: '127.0.0.1',
        port: PORT,
        path,
        method,
        agent,
        headers: {
          ...(data
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data),
              }
            : {}),
          ...(opts.cookie ? { Cookie: opts.cookie } : {}),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            ms: Number(process.hrtime.bigint() - start) / 1e6,
            body,
            setCookie: res.headers['set-cookie'],
          }),
        );
      },
    );
    req.on('error', (e) =>
      resolve({
        status: 0,
        ms: Number(process.hrtime.bigint() - start) / 1e6,
        body: String(e),
      }),
    );
    if (data) req.write(data);
    req.end();
  });
}
async function pool<T>(
  n: number,
  concurrency: number,
  job: (i: number) => Promise<T>,
): Promise<T[]> {
  const out: T[] = new Array(n);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, n) }, async () => {
      while (next < n) {
        const i = next++;
        out[i] = await job(i);
      }
    }),
  );
  return out;
}
function stats(hits: Hit[], wallMs: number) {
  const ms = hits.map((h) => h.ms).sort((a, b) => a - b);
  const p = (q: number) =>
    ms[Math.min(ms.length - 1, Math.floor(q * ms.length))];
  const codes: Record<number, number> = {};
  for (const h of hits) codes[h.status] = (codes[h.status] ?? 0) + 1;
  return {
    n: hits.length,
    rps: Math.round((hits.length / wallMs) * 1000),
    p50: Math.round(p(0.5)),
    p95: Math.round(p(0.95)),
    p99: Math.round(p(0.99)),
    max: Math.round(ms[ms.length - 1]),
    codes,
  };
}
const fmt = (s: ReturnType<typeof stats>) =>
  `${s.n} requests, ${s.rps} req/s, p50 ${s.p50} ms, p95 ${s.p95} ms, p99 ${s.p99} ms, max ${s.max} ms, codes ${JSON.stringify(s.codes)}`;
async function timed(
  n: number,
  conc: number,
  job: (i: number) => Promise<Hit>,
) {
  const t0 = Date.now();
  const hits = await pool(n, conc, job);
  return { hits, s: stats(hits, Date.now() - t0) };
}
const cookieFrom = (h: Hit) =>
  (h.setCookie ?? []).map((c) => c.split(';')[0]).join('; ');

describe('Test plan Part 16: load and performance', () => {
  let t: TestApp;
  let flights: string[] = [];
  let hotelId = '';
  const users: Actor[] = [];
  const cookies: string[] = [];

  beforeAll(async () => {
    t = await createTestApp('part16-load');
    await seedReference(t);
    await new Promise<void>((r) =>
      t.server.listening ? r() : t.server.listen(0, '127.0.0.1', () => r()),
    );
    PORT = (t.server.address() as AddressInfo).port;
    const airline = await createAirline(t, {
      cancellationTiers: [{ daysBefore: 0, refundPercent: 100 }],
    });
    for (let d = 1; d <= 20; d++)
      flights.push(
        String(
          (
            await createFlight(t, {
              airlineId: airline,
              from: 'CAI',
              to: 'DXB',
              day: d,
              seats: 200,
              price: 20000 + d * 100,
            } as any)
          )._id,
        ),
      );
    const adm = await admin(t);
    for (let h = 0; h < 15; h++) {
      const id = String(
        (
          await adm.agent
            .post('/api/hotels')
            .send({
              name: `TEST Load Hotel ${h}`,
              address: `${h} Load St`,
              cityId: 'dubai',
              countryCode: 'AE',
              starClass: 3 + (h % 3),
            })
        ).body._id,
      );
      if (h === 0) hotelId = id;
      const mod = await hotelModerator(t, id);
      await mod.agent
        .put(`/api/hotels/${id}/policies`)
        .send({
          checkInTime: '14:00',
          checkOutTime: '12:00',
          cancellationTiers: [{ daysBefore: 0, refundPercent: 100 }],
        });
      const rooms = h === 0 ? 10 : 3;
      for (let r = 0; r < rooms; r++) {
        const room = String(
          (
            await mod.agent
              .post(`/api/hotels/${id}/rooms`)
              .send({
                name: `${100 + r}`,
                type: 'Double',
                beds: 2,
                maxOccupancy: 2,
                pricePerNight: 9000 + h * 500,
              })
          ).body._id,
        );
        await mod.agent
          .post(`/api/hotels/${id}/rooms/${room}/availability`)
          .send({ from: '2099-12-01', to: '2099-12-31' });
      }
    }
    for (let i = 0; i < 100; i++)
      users.push(await traveler(t, `TEST Load ${i}`));
  }, 600_000);

  afterAll(async () => {
    const pass = results.filter((r) => r.ok).length;
    console.log(
      `\nPART 16 RESULTS: ${pass}/${results.length} passed\n` +
        results
          .map(
            (r) =>
              `${r.ok ? 'PASS' : 'FAIL'} ${r.id}${r.note ? '\n     ' + r.note : ''}`,
          )
          .join('\n'),
    );
    agent.destroy();
    await t?.close();
  });

  it('runs cases 16.1-16.8', async () => {
    await tc(
      '16.1 100 users log in at the same moment (password hashing is the slow part)',
      async () => {
        const { hits, s } = await timed(100, 100, (i) =>
          call('POST', '/api/auth/login', {
            body: { email: users[i].email, password: TEST_PASSWORD },
          }),
        );
        hits.forEach((h) => cookies.push(cookieFrom(h)));
        check(
          s.codes[200] === 100,
          `all 100 logged in (${JSON.stringify(s.codes)})`,
        );
        check(s.p95 < 8000, `p95 under 8 s (got ${s.p95} ms)`);
        return fmt(s);
      },
    );

    await tc(
      '16.2 flight search: 2,000 requests, 50 at a time, as visitors',
      async () => {
        const { s } = await timed(2000, 50, (i) =>
          call(
            'GET',
            `/api/flights/search?from=CAI&to=DXB&date=2099-12-${String((i % 20) + 1).padStart(2, '0')}&passengers=1`,
          ),
        );
        check(s.codes[200] === 2000, `all 200 (${JSON.stringify(s.codes)})`);
        check(s.p95 < 1500, `p95 under 1.5 s (got ${s.p95} ms)`);
        return fmt(s);
      },
    );

    await tc(
      '16.3 hotel search: 2,000 requests, 50 at a time, 15 hotels with prices',
      async () => {
        const { s } = await timed(2000, 50, (i) =>
          call(
            'GET',
            `/api/hotels/search?city=dubai&checkIn=2099-12-${String((i % 20) + 2).padStart(2, '0')}&checkOut=2099-12-${String((i % 20) + 4).padStart(2, '0')}&guests=2&rooms=1&sort=price`,
          ),
        );
        check(s.codes[200] === 2000, `all 200 (${JSON.stringify(s.codes)})`);
        check(s.p95 < 1500, `p95 under 1.5 s (got ${s.p95} ms)`);
        return fmt(s);
      },
    );

    await tc(
      '16.4 logged-in pages: 2,000 requests from 100 sessions (me, notifications, my bookings)',
      async () => {
        const paths = [
          '/api/auth/me',
          '/api/notifications/unread-count',
          '/api/flight-bookings',
          '/api/itineraries',
        ];
        const { s } = await timed(2000, 100, (i) =>
          call('GET', paths[i % paths.length], { cookie: cookies[i % 100] }),
        );
        check(s.codes[200] === 2000, `all 200 (${JSON.stringify(s.codes)})`);
        check(s.p95 < 1500, `p95 under 1.5 s (got ${s.p95} ms)`);
        return fmt(s);
      },
    );

    await tc(
      '16.5 100 users hold seats on a 40-seat flight at the same moment',
      async () => {
        const f = String(
          (
            await createFlight(t, {
              airlineId: (
                await t.model('Flight').findById(flights[0]).lean<any>()
              ).airlineId,
              from: 'CAI',
              to: 'DXB',
              day: 25,
              seats: 40,
              price: 30000,
            } as any)
          )._id,
        );
        const { s } = await timed(100, 100, (i) =>
          call('POST', '/api/flight-bookings/hold', {
            cookie: cookies[i],
            body: {
              outboundFlightId: f,
              cabin: 'Economy',
              passengers: [
                {
                  type: 'adult',
                  fullName: `TEST Load ${i}`,
                  dateOfBirth: '1990-01-01',
                  passportNumber: 'A1234567',
                },
              ],
            },
          }),
        );
        const fl = await t.model('Flight').findById(f).lean<any>();
        const held = fl.cabins.reduce(
          (n: number, c: any) => n + (c.heldSeats ?? 0) + (c.bookedSeats ?? 0),
          0,
        );
        check(
          s.codes[201] === 40,
          `exactly 40 holds (${JSON.stringify(s.codes)})`,
        );
        check((s.codes[409] ?? 0) === 60, 'the other 60 answered 409');
        check(
          held === 40,
          `40 seats taken in the database, no overbooking (got ${held})`,
        );
        return fmt(s);
      },
    );

    await tc(
      '16.6 100 users book the last 10 rooms of one hotel at the same moment',
      async () => {
        const rooms = await t
          .model('Room')
          .find({ hotelId: hotelId })
          .lean<any[]>();
        check(rooms.length === 10, `setup: 10 rooms (got ${rooms.length})`);
        const { s } = await timed(100, 100, (i) =>
          call('POST', '/api/hotel-bookings', {
            cookie: cookies[i],
            body: {
              hotelId,
              checkIn: '2099-12-20',
              checkOut: '2099-12-22',
              rooms: [
                { roomId: String(rooms[i % 10]._id), adults: 1, childAges: [] },
              ],
            },
          }),
        );
        const taken = await t
          .model('HotelBooking')
          .countDocuments({
            hotelId,
            status: { $in: ['PendingPayment', 'Confirmed'] },
          });
        check(
          s.codes[201] === 10,
          `exactly 10 bookings (${JSON.stringify(s.codes)})`,
        );
        check(
          Object.keys(s.codes).every((c) => +c < 500),
          'no 5xx',
        );
        check(
          taken === 10,
          `10 reservations in the database, no double booking (got ${taken})`,
        );
        return fmt(s);
      },
    );

    await tc(
      '16.7 sustained mixed traffic for 20 seconds (searches, pages, reference data)',
      async () => {
        const mix = [
          (i: number) =>
            call(
              'GET',
              `/api/flights/search?from=CAI&to=DXB&date=2099-12-${String((i % 20) + 1).padStart(2, '0')}&passengers=1`,
            ),
          (i: number) =>
            call(
              'GET',
              '/api/hotels/search?city=dubai&checkIn=2099-12-05&checkOut=2099-12-07&guests=1&rooms=1',
            ),
          (i: number) => call('GET', '/api/reference/cities'),
          (i: number) =>
            call('GET', '/api/auth/me', { cookie: cookies[i % 100] }),
          (i: number) => call('GET', '/api/posts'),
          (i: number) => call('GET', `/api/flights/${flights[i % 20]}`),
        ];
        const hits: Hit[] = [];
        const end = Date.now() + 20_000;
        const t0 = Date.now();
        let k = 0;
        await Promise.all(
          Array.from({ length: 60 }, async () => {
            while (Date.now() < end) {
              const i = k++;
              hits.push(await mix[i % mix.length](i));
            }
          }),
        );
        const s = stats(hits, Date.now() - t0);
        check(
          Object.keys(s.codes).every((c) => c === '200'),
          `only 200s (${JSON.stringify(s.codes)})`,
        );
        check(s.p95 < 1500, `p95 under 1.5 s (got ${s.p95} ms)`);
        check(s.rps >= 100, `at least 100 req/s (got ${s.rps})`);
        return fmt(s);
      },
    );

    await tc('16.8 the server is healthy after the load', async () => {
      const mem = process.memoryUsage();
      const r = await call('GET', '/api/auth/me', { cookie: cookies[0] });
      check(r.status === 200, `still answering (${r.status})`);
      check(r.ms < 500, `fast again (${Math.round(r.ms)} ms)`);
      return `heap ${Math.round(mem.heapUsed / 1e6)} MB, rss ${Math.round(mem.rss / 1e6)} MB`;
    });

    expect(results.filter((r) => !r.ok).map((r) => r.id)).toEqual([]);
  }, 900_000);
});
