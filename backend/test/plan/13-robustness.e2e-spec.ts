// Milestone 1 test plan (the team's "Milestone 1 Test Plan" doc), Part 13 (robustness
// sweep, the kind of checks a grader runs by hand in Swagger). Every route in
// the Swagger document is called by every role with bad ids, bad queries and
// bodies broken one field at a time. Nothing may return 5xx, every error must
// use the agreed format, protected routes must answer 401 when logged out,
// and clearly invalid bodies must never be accepted.
import * as request from 'supertest';
import { Types } from 'mongoose';
import { buildSwaggerDocument } from '../../src/app.setup';
import { SUPPORTED_CURRENCIES } from '../../src/common/constants/currencies';
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
const idOf = (b: any) => String(b?._id ?? b?.id ?? '');
const oid = () => String(new Types.ObjectId());

const problems: Record<string, string[]> = {
  '5xx': [],
  'error format': [],
  'logged out not 401': [],
  'invalid body accepted': [],
  'bad JSON not 400': [],
  'bad query accepted': [],
  swagger: [],
};
const info: Record<string, number> = {};
let requests = 0;

describe('Test plan Part 13: robustness sweep', () => {
  let t: TestApp;
  let doc: any;
  const ids: Record<string, string> = {};
  let callers: Record<string, Actor | null> = {};

  beforeAll(async () => {
    t = await createTestApp('part13-robust');
    await seedReference(t);
    doc = buildSwaggerDocument(t.app);
    const rates: Record<string, number> = {};
    for (const c of SUPPORTED_CURRENCIES) rates[c] = 1;
    await t
      .model('ExchangeRate')
      .create({
        date: new Date().toISOString().slice(0, 10),
        base: 'USD',
        rates,
        fetchedAt: new Date(),
      });
    const adm = await admin(t);
    const airline = await createAirline(t, {
      cancellationTiers: [{ daysBefore: 0, refundPercent: 100 }],
    });
    const airline2 = await createAirline(t);
    const airMod = await airlineModerator(t, airline);
    const flight = await createFlight(t, {
      airlineId: airline,
      from: 'CAI',
      to: 'DXB',
      day: 10,
      price: 30000,
    } as any);
    const hotel = idOf(
      (
        await adm.agent
          .post('/api/hotels')
          .send({
            name: 'TEST Robust Hotel',
            address: '1 St',
            cityId: 'dubai',
            countryCode: 'AE',
            starClass: 4,
          })
      ).body,
    );
    const hotel2 = idOf(
      (
        await adm.agent
          .post('/api/hotels')
          .send({
            name: 'TEST Robust Hotel 2',
            address: '2 St',
            cityId: 'cairo',
            countryCode: 'EG',
            starClass: 3,
          })
      ).body,
    );
    const hotMod = await hotelModerator(t, hotel);
    await hotMod.agent
      .put(`/api/hotels/${hotel}/policies`)
      .send({
        checkInTime: '14:00',
        checkOutTime: '12:00',
        cancellationTiers: [{ daysBefore: 0, refundPercent: 100 }],
      });
    const room = idOf(
      (
        await hotMod.agent
          .post(`/api/hotels/${hotel}/rooms`)
          .send({
            name: '1',
            type: 'Double',
            beds: 2,
            maxOccupancy: 2,
            pricePerNight: 10000,
          })
      ).body,
    );
    await hotMod.agent
      .post(`/api/hotels/${hotel}/rooms/${room}/availability`)
      .send({ from: '2099-12-01', to: '2099-12-31' });
    const u = await traveler(t, 'TEST Robust User');
    const victim = await traveler(t, 'TEST Robust Victim');
    const fb = idOf(
      (
        await u.agent
          .post('/api/flight-bookings/hold')
          .send({
            outboundFlightId: String(flight._id),
            cabin: 'Economy',
            passengers: [
              {
                type: 'adult',
                fullName: 'TEST Pax',
                dateOfBirth: '1990-01-01',
                passportNumber: 'A1234567',
              },
            ],
          })
      ).body,
    );
    await u.agent
      .post(`/api/bookings/flight/${fb}/accept-policies`)
      .send({ accepted: true });
    const pay = (await u.agent.post(`/api/bookings/flight/${fb}/pay`)).body;
    const hb = idOf(
      (
        await u.agent
          .post('/api/hotel-bookings')
          .send({
            hotelId: hotel,
            checkIn: '2099-12-05',
            checkOut: '2099-12-07',
            rooms: [{ roomId: room, adults: 1, childAges: [] }],
          })
      ).body,
    );
    const it = idOf(
      (
        await u.agent
          .post('/api/itineraries')
          .send({
            title: 'TEST Robust trip',
            countries: ['EG'],
            startDate: '2099-12-10',
          })
      ).body,
    );
    const day = await u.agent
      .post(`/api/itineraries/${it}/days`)
      .send({ cityId: 'cairo' });
    const itin = (await u.agent.get(`/api/itineraries/${it}`)).body;
    const dayId = idOf(itin.days?.[0] ?? day.body);
    await u.agent
      .post(`/api/itineraries/${it}/days/${dayId}/activities`)
      .send({
        name: 'TEST Museum',
        time: '10:00',
        cost: { amount: 500, currency: 'EGP' },
      });
    const bud = await u.agent
      .post(`/api/itineraries/${it}/days/${dayId}/budgets`)
      .send({ category: 'food', amount: 90, currency: 'EUR' });
    const tr = await u.agent
      .post(`/api/itineraries/${it}/transport-costs`)
      .send({
        mode: 'flight',
        fromCityId: 'paris',
        toCityId: 'cairo',
        amount: 500,
        currency: 'EGP',
        dayId,
      });
    const itin2 = (await u.agent.get(`/api/itineraries/${it}`)).body;
    const post = idOf(
      (
        await u.agent
          .post('/api/posts')
          .send({
            title: 'TEST Robust post',
            body: 'TEST body',
            tags: ['robust'],
            status: 'Published',
          })
      ).body,
    );
    const comment = idOf(
      (
        await u.agent
          .post(`/api/posts/${post}/comments`)
          .send({ body: 'TEST comment' })
      ).body,
    );
    const comment2 = idOf(
      (
        await u.agent
          .post(`/api/posts/${post}/comments`)
          .send({ body: 'TEST comment 2' })
      ).body,
    );
    const report = idOf(
      (
        await victim.agent
          .post('/api/reports')
          .send({ targetType: 'comment', targetId: comment, reason: 'TEST' })
      ).body,
    );
    const fl = await t.model('Flight').findById(flight._id).lean<any>();
    Object.assign(ids, {
      airline: String(airline),
      airline2: String(airline2),
      flight: String(flight._id),
      cabin: idOf(fl.cabins[0]),
      hotel,
      hotel2,
      room,
      fb,
      hb,
      payment: String(pay?.paymentId ?? oid()),
      it,
      dayId,
      activity: idOf(itin2.days?.[0]?.activities?.[0]),
      budget: idOf(bud.body?.budgets?.[0] ?? bud.body),
      transport: idOf(tr.body),
      post,
      comment,
      comment2,
      report,
      user: u.id,
      victim: victim.id,
    });
    callers = { anon: null, user: u, airMod, hotMod, admin: adm };
  }, 180_000);

  afterAll(async () => {
    const lines = Object.entries(problems).map(
      ([k, v]) =>
        `${v.length ? 'FAIL' : 'PASS'} ${k}: ${v.length}${v.length ? '\n   ' + [...new Set(v)].slice(0, 60).join('\n   ') : ''}`,
    );
    console.log(
      `\nPART 13 RESULTS (${requests} requests)\n${lines.join('\n')}\nINFO ${JSON.stringify(info)}`,
    );
    await t?.close();
  });

  // ---- helpers -------------------------------------------------------------
  const deref = (s: any): any =>
    s?.$ref ? doc.components.schemas[s.$ref.split('/').pop()] : s;
  function sample(s0: any, depth = 0): any {
    const s = deref(s0) ?? {};
    if (s.example !== undefined) return s.example;
    if (s.default !== undefined) return s.default;
    if (s.enum) return s.enum[0];
    if (s.allOf)
      return Object.assign({}, ...s.allOf.map((x: any) => sample(x, depth)));
    if (s.oneOf || s.anyOf) return sample((s.oneOf || s.anyOf)[0], depth);
    if (s.type === 'array')
      return depth > 3 ? [] : [sample(s.items, depth + 1)];
    if (s.type === 'object' || s.properties) {
      const o: any = {};
      for (const [k, v] of Object.entries<any>(s.properties ?? {}))
        o[k] = sample(v, depth + 1);
      return o;
    }
    if (s.type === 'integer' || s.type === 'number') return s.minimum ?? 1;
    if (s.type === 'boolean') return true;
    if (s.format === 'date' || s.format === 'date-time') return '2099-12-10';
    return 'TEST';
  }
  function wrongType(v: any) {
    if (typeof v === 'number') return 'not-a-number';
    if (typeof v === 'boolean') return 'not-a-boolean';
    if (Array.isArray(v)) return 'not-an-array';
    if (v && typeof v === 'object') return 'not-an-object';
    return 12345;
  }
  function realPath(
    path: string,
    variant: 'real' | 'random' | 'invalid',
  ): string {
    const pick = (name: string, seg: string) => {
      if (variant === 'invalid') return name === 'type' ? 'zzz' : 'not-an-id';
      if (name === 'type')
        return path.includes('/admin/providers')
          ? 'airline'
          : path.includes('/admin/content')
            ? 'comment'
            : 'flight';
      if (name === 'tag') return 'robust';
      if (variant === 'random') return oid();
      const p = path;
      const map: [RegExp, string][] = [
        [/^\/api\/airlines\/\{id\}/, ids.airline],
        [/^\/api\/flights\/\{id\}\/cabins\/\{cabinId\}/, ''],
        [/^\/api\/flights\/\{id\}/, ids.flight],
        [/^\/api\/flight-bookings\/\{id\}/, ids.fb],
        [/^\/api\/hotels\/\{id\}/, ids.hotel],
        [/^\/api\/hotel-bookings\/\{id\}/, ids.hb],
        [/^\/api\/bookings\/\{type\}\/\{id\}/, ids.fb],
        [/^\/api\/payments\/\{id\}/, ids.payment],
        [/^\/api\/itineraries\/public\/\{id\}/, ids.it],
        [/^\/api\/itineraries\/\{id\}/, ids.it],
        [/^\/api\/activities\/\{id\}/, ids.activity],
        [/^\/api\/budgets\/\{id\}/, ids.budget],
        [/^\/api\/transport-costs\/\{id\}/, ids.transport],
        [/^\/api\/posts\/\{id\}/, ids.post],
        [/^\/api\/comments\/\{id\}/, ids.comment],
        [/^\/api\/authors\/\{id\}/, ids.user],
        [/^\/api\/admin\/(accounts|users)\/\{id\}/, ids.victim],
        [/^\/api\/admin\/providers/, ids.airline2],
        [/^\/api\/admin\/reports\/\{id\}/, ids.report],
        [/^\/api\/admin\/content/, ids.comment2],
      ];
      if (name === 'cabinId') return ids.cabin;
      if (name === 'roomId') return ids.room;
      if (name === 'dayId') return ids.dayId;
      for (const [re, v] of map) if (re.test(p) && v) return v;
      return oid();
    };
    return path.replace(/\{(\w+)\}/g, (seg, name) => pick(name, seg));
  }
  function send(
    who: Actor | null,
    method: string,
    path: string,
    body?: any,
    query?: any,
    raw?: string,
  ): Promise<Res> {
    requests++;
    const base: any = who ? who.agent : t.http();
    let r = base[method](path);
    if (query) r = r.query(query);
    if (raw !== undefined)
      return r.set('Content-Type', 'application/json').send(raw);
    if (body !== undefined) r = r.send(body);
    return r;
  }
  function inspect(res: Res, where: string) {
    if (res.status >= 500)
      problems['5xx'].push(
        `${where} -> ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`,
      );
    if (res.status >= 400 && res.type === 'application/json') {
      const b = res.body ?? {};
      const ok =
        b.statusCode === res.status &&
        typeof b.error === 'string' &&
        (typeof b.message === 'string' || Array.isArray(b.message)) &&
        typeof b.path === 'string' &&
        !Number.isNaN(Date.parse(b.timestamp));
      if (!ok)
        problems['error format'].push(
          `${where} -> ${res.status} ${JSON.stringify(b).slice(0, 160)}`,
        );
    }
  }

  it('sweeps every route', async () => {
    const ops: { method: string; path: string; op: any }[] = [];
    for (const [path, item] of Object.entries<any>(doc.paths))
      for (const method of ['get', 'post', 'patch', 'put', 'delete'])
        if (item[method]) ops.push({ method, path, op: item[method] });
    info.operations = ops.length;
    // Session-ending and destructive routes last, so the rest keep their sessions and data.
    const late = (o: { method: string; path: string }) =>
      /logout|change-password|users\/me$|suspend|deactivate|reset-password|cancel|reject|\/content\//.test(
        o.path,
      ) || o.method === 'delete'
        ? 1
        : 0;
    ops.sort((a, b) => late(a) - late(b));

    for (const { method, path, op } of ops) {
      const label = `${method.toUpperCase()} ${path}`;
      if (path === '/api/payments/webhook') {
        for (const raw of ['{}', 'garbage']) {
          const r = await send(null, 'post', path, undefined, undefined, raw);
          inspect(r, `${label} unsigned`);
          if (r.status !== 400)
            problems['bad JSON not 400'].push(
              `${label} unsigned -> ${r.status}`,
            );
        }
        continue;
      }
      // Swagger quality: summary, a success response, documented path params.
      if (!op.summary) problems.swagger.push(`${label} has no summary`);
      if (!Object.keys(op.responses ?? {}).some((c) => /^2/.test(c)))
        problems.swagger.push(`${label} documents no 2xx response`);
      for (const name of [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))
        if (
          !(op.parameters ?? []).some(
            (p: any) => p.in === 'path' && p.name === name,
          )
        )
          problems.swagger.push(`${label} path param ${name} undocumented`);

      const jsonSchema = op.requestBody?.content?.['application/json']?.schema;
      const multipart = !!op.requestBody?.content?.['multipart/form-data'];
      const valid = jsonSchema ? sample(jsonSchema) : undefined;
      const realP = realPath(path, 'real');

      // 1. Logged out.
      const anon = await send(null, method, realP, valid);
      inspect(anon, `${label} anon`);
      // Login answers 401 for wrong credentials, which is not a missing session.
      const isPublic =
        anon.status !== 401 ||
        /^\/api\/auth\/(login|refresh|register|forgot|reset|verify)/.test(path);
      // Refresh is reached without an access token but needs the refresh cookie, so its lock is right.
      if (isPublic && op.security?.length && path !== '/api/auth/refresh')
        problems.swagger.push(`${label} is public but shows a lock`);
      if (!isPublic && !op.security?.length)
        problems.swagger.push(`${label} needs login but shows no lock`);

      // 2. Each role with real, random and invalid ids.
      let worker: Actor | null = null;
      for (const [role, who] of Object.entries(callers)) {
        if (!who) continue;
        for (const variant of ['invalid', 'random', 'real'] as const) {
          if (variant === 'real' && late({ method, path })) continue;
          const r = await send(who, method, realPath(path, variant), valid);
          inspect(r, `${label} ${role} ${variant}-id`);
          if (variant === 'invalid' && /\{id\}|Id\}/.test(path))
            info[`invalid id ${r.status}`] =
              (info[`invalid id ${r.status}`] ?? 0) + 1;
          if (variant === 'real' && !worker && ![401, 403].includes(r.status))
            worker = who;
        }
      }
      if (late({ method, path })) {
        // Destructive routes: one real call by the first allowed role, at the very end.
        for (const who of Object.values(callers)) {
          if (!who) continue;
          const r = await send(who, method, realP, valid);
          inspect(r, `${label} real`);
          if (![401, 403].includes(r.status)) {
            worker = who;
            break;
          }
        }
      }
      const actor = worker ?? callers.admin!;

      // 3. Bad queries on GET lists.
      if (method === 'get') {
        const hasPage = (op.parameters ?? []).some(
          (p: any) => p.name === 'page',
        );
        const bads: Record<string, any> = {
          'page=0': { page: 0 },
          'page=-1': { page: -1 },
          'page=abc': { page: 'abc' },
          'limit=11': { limit: 11 },
          'limit=0': { limit: 0 },
          'sort=zzz': { sort: 'zzz:sideways' },
          'unknown=1': { unknownParam: 1 },
          array: { 'page[]': 1 },
        };
        for (const [name, q] of Object.entries(bads)) {
          const r = await send(actor, 'get', realP, undefined, q);
          inspect(r, `${label} ?${name}`);
          if (hasPage && /page|limit/.test(name) && r.status < 400)
            problems['bad query accepted'].push(
              `${label} ?${name} -> ${r.status}`,
            );
        }
        for (const p of (op.parameters ?? []).filter(
          (x: any) =>
            x.in === 'query' && x.name !== 'page' && x.name !== 'limit',
        )) {
          for (const v of [
            '',
            'x'.repeat(2000),
            '-1',
            '9999999999999',
            '2099-13-45',
            '[object Object]',
          ]) {
            const r = await send(actor, 'get', realP, undefined, {
              [p.name]: v,
            });
            inspect(r, `${label} ?${p.name}=${v.slice(0, 12)}`);
          }
        }
      }

      // 4. Broken bodies.
      if (multipart) {
        const r = await send(actor, method, realP, { not: 'a file' });
        inspect(r, `${label} json-to-upload`);
      }
      if (!jsonSchema) continue;
      for (const raw of ['{"broken": ', '[]', 'null', '"text"', '12']) {
        const r = await send(actor, method, realP, undefined, undefined, raw);
        inspect(r, `${label} body ${raw}`);
        if (r.status < 400)
          problems['bad JSON not 400'].push(
            `${label} body ${raw} -> ${r.status}`,
          );
      }
      const schema = deref(jsonSchema);
      const required: string[] = schema.required ?? [];
      const base = await send(actor, method, realP, valid);
      inspect(base, `${label} sample body`);
      const baseOk = base.status < 300;
      info[`sample body ${baseOk ? 'accepted' : 'rejected'}`] =
        (info[`sample body ${baseOk ? 'accepted' : 'rejected'}`] ?? 0) + 1;
      const muts: [string, (b: any, k: string) => void, boolean][] = [
        ['missing', (b, k) => delete b[k], true],
        ['null', (b, k) => (b[k] = null), true],
        ['wrong type', (b, k) => (b[k] = wrongType(b[k])), true],
        ['empty string', (b, k) => (b[k] = ''), false],
        ['5000 chars', (b, k) => (b[k] = 'x'.repeat(5000)), false],
        ['negative', (b, k) => (b[k] = -1), false],
        ['huge', (b, k) => (b[k] = 1e15), false],
        ['object', (b, k) => (b[k] = { $gt: '' }), true],
      ];
      const keys = Object.keys(valid ?? {});
      for (const k of keys) {
        for (const [name, mut, mustReject] of muts) {
          const body = JSON.parse(JSON.stringify(valid));
          mut(body, k);
          const r = await send(actor, method, realP, body);
          inspect(r, `${label} ${k}: ${name}`);
          const isObj = valid[k] && typeof valid[k] === 'object';
          const strict =
            mustReject &&
            !(name === 'object' && isObj) &&
            (name !== 'missing' && name !== 'null'
              ? true
              : required.includes(k));
          if (baseOk && strict && r.status < 300)
            problems['invalid body accepted'].push(
              `${label} ${k}: ${name} -> ${r.status}`,
            );
        }
        // One level down for arrays of objects (passengers, rooms, tiers...).
        const v = valid[k];
        const inner =
          Array.isArray(v) && v[0] && typeof v[0] === 'object' ? v[0] : null;
        if (inner)
          for (const ik of Object.keys(inner))
            for (const [name, mut] of muts) {
              const body = JSON.parse(JSON.stringify(valid));
              mut(body[k][0], ik);
              const r = await send(actor, method, realP, body);
              inspect(r, `${label} ${k}[0].${ik}: ${name}`);
            }
      }
      const extra = await send(actor, method, realP, {
        ...(valid ?? {}),
        unexpectedField: 'x',
      });
      inspect(extra, `${label} extra field`);
      if (extra.status < 300)
        problems['invalid body accepted'].push(
          `${label} extra field -> ${extra.status}`,
        );
    }
    info.requests = requests;
    expect(
      Object.entries(problems)
        .filter(([, v]) => v.length)
        .map(([k]) => k),
    ).toEqual([]);
  }, 1_500_000);
});
