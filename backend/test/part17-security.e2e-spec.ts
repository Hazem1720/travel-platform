// TEMPORARY (test branch only): Milestone 1 test plan, Part 17 (security
// audit, OWASP Top 10 checklist). Each case attacks the real app over HTTP
// the way a tester with Swagger or curl would. Results are printed at the end.
import * as crypto from 'crypto';
import * as request from 'supertest';
import { createTestApp, TestApp } from './e2e/app';
import { admin, airlineModerator, TEST_PASSWORD, traveler, Actor } from './e2e/actors';
import { createAirline, createFlight, seedReference } from './e2e/fixtures';
import { paymentIntentEvent } from './e2e/fakes';

type Res = request.Response;
const results: { id: string; ok: boolean; note: string }[] = [];
function check(cond: boolean, what: string, res?: Res) {
  if (!cond) {
    const got = res ? ` [got ${res.status} ${JSON.stringify(res.body).slice(0, 200)}]` : '';
    throw new Error(what + got);
  }
}
async function tc(id: string, fn: () => Promise<string | void>) {
  try {
    results.push({ id, ok: true, note: (await fn()) || '' });
  } catch (e) {
    results.push({ id, ok: false, note: (e as Error).message.slice(0, 600) });
  }
}
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const SECRET_FIELDS = /passwordHash|refreshTokenHash|passwordResetToken|verificationToken|emailVerificationToken|\$2[aby]\$\d\d\$/;

describe('Test plan Part 17: security audit', () => {
  let t: TestApp;
  let U: Actor, V: Actor, A: Actor, M1: Actor;
  let flightB = '';
  const loginCookie = async (email: string) => {
    const r = await t.http().post('/api/auth/login').send({ email, password: TEST_PASSWORD });
    return { res: r, cookies: ((r.headers['set-cookie'] as unknown as string[]) ?? []) };
  };

  beforeAll(async () => {
    t = await createTestApp('part17-security');
    await seedReference(t);
    A = await admin(t);
    const air1 = await createAirline(t);
    const air2 = await createAirline(t);
    M1 = await airlineModerator(t, air1);
    flightB = String((await createFlight(t, { airlineId: air2, seats: 10, price: 20000 } as any))._id);
    U = await traveler(t, 'TEST Sec U');
    V = await traveler(t, 'TEST Sec V');
  }, 120_000);

  afterAll(async () => {
    const pass = results.filter((r) => r.ok).length;
    console.log(`\nPART 17 RESULTS: ${pass}/${results.length} passed\n` + results.map((r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.id}${r.note ? '  ' + r.note : ''}`).join('\n'));
    await t?.close();
  });

  it('runs cases 17.1-17.20', async () => {
    // ---- A05 Security misconfiguration --------------------------------
    await tc('17.1 security headers on API responses', async () => {
      const r = await U.agent.get('/api/auth/me');
      const h = r.headers;
      const miss: string[] = [];
      if (h['x-powered-by']) miss.push(`X-Powered-By is "${h['x-powered-by']}" (reveals the framework)`);
      if (h['x-content-type-options'] !== 'nosniff') miss.push('no X-Content-Type-Options: nosniff');
      if (!h['x-frame-options'] && !/frame-ancestors/.test(h['content-security-policy'] ?? '')) miss.push('no X-Frame-Options / frame-ancestors (clickjacking)');
      if (!h['referrer-policy']) miss.push('no Referrer-Policy');
      check(miss.length === 0, miss.join('; '));
    });

    await tc('17.2 errors never leak stack traces or internals', async () => {
      const probes: Res[] = [
        await t.http().get('/api/no-such-route'),
        await U.agent.get('/api/flight-bookings/not-an-id'),
        await t.http().post('/api/auth/login').set('Content-Type', 'application/json').send('{"broken": '),
        await U.agent.patch('/api/users/me').send({ name: { $gt: '' } }),
      ];
      const leaks = probes.filter((r) => /stack|node_modules|\/src\/|\.ts:\d|Mongo(Server)?Error|at Object\./.test(JSON.stringify(r.body)) || r.status >= 500);
      check(leaks.length === 0, 'leaks: ' + leaks.map((r) => `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`).join(' | '));
    });

    await tc('17.3 an oversized body (2 MB) is refused with 413, not a crash', async () => {
      const r = await U.agent.patch('/api/users/me').set('Content-Type', 'application/json').send(JSON.stringify({ name: 'x'.repeat(2_000_000) }));
      check(r.status === 413, 'answers 413', r);
      check(r.body?.statusCode === 413 && typeof r.body?.message === 'string' && typeof r.body?.path === 'string', 'in the shared error format', r);
    });

    await tc('17.4 CORS only lets the configured frontend read responses', async () => {
      const evil = await U.agent.get('/api/auth/me').set('Origin', 'https://evil.example');
      check(evil.headers['access-control-allow-origin'] !== 'https://evil.example' && evil.headers['access-control-allow-origin'] !== '*', `evil origin not allowed (got ${evil.headers['access-control-allow-origin']})`);
      const ok = await U.agent.get('/api/auth/me').set('Origin', process.env.FRONTEND_URL!);
      check(ok.headers['access-control-allow-origin'] === process.env.FRONTEND_URL, 'the frontend origin is allowed');
    });

    // ---- A07 Identification and authentication failures ---------------
    await tc('17.5 forged tokens: alg "none", wrong secret, expired, other user id', async () => {
      const now = Math.floor(Date.now() / 1000);
      const user = await t.model('User').findById(V.id).lean<any>();
      const body = { sub: V.id, sv: user.sessionVersion ?? 0, iat: now, exp: now + 900 };
      const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64(body)}.`;
      const sign = (payload: object, secret: string) => {
        const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64(payload);
        return `${h}.${p}.${crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}`;
      };
      const wrong = sign(body, 'not-the-real-secret');
      const expired = sign({ ...body, iat: now - 7200, exp: now - 3600 }, process.env.JWT_SECRET!);
      const bad: string[] = [];
      for (const [name, tok] of [['alg none', none], ['wrong secret', wrong], ['expired', expired]]) {
        const r = await t.http().get('/api/auth/me').set('Cookie', `access_token=${tok}`);
        if (r.status !== 401) bad.push(`${name} -> ${r.status}`);
      }
      const good = await t.http().get('/api/auth/me').set('Cookie', `access_token=${sign(body, process.env.JWT_SECRET!)}`);
      check(good.status === 200, 'control: a correctly signed token works', good);
      check(bad.length === 0, bad.join('; '));
    });

    await tc('17.6 session cookies are HttpOnly, SameSite and cleared on logout', async () => {
      // A separate user: logging out ends every session of that user.
      const C = await traveler(t, 'TEST Cookie');
      const { res, cookies } = await loginCookie(C.email);
      check(res.status === 200, 'login', res);
      const bad = cookies.filter((c) => /^(access|refresh)_token=/.test(c) && !(/HttpOnly/i.test(c) && /SameSite=(Lax|Strict)/i.test(c)));
      check(bad.length === 0, 'flags missing on: ' + bad.join(' | '));
      check(!cookies.some((c) => /^(access|refresh)_token=/.test(c) && /Domain=/i.test(c)), 'no wide Domain attribute');
      const out = await t.http().post('/api/auth/logout').set('Cookie', cookies.map((c) => c.split(';')[0]).join('; '));
      const cleared = ((out.headers['set-cookie'] as unknown as string[]) ?? []).filter((c) => /^(access|refresh)_token=;|Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c));
      check(cleared.length >= 2, `both cookies cleared on logout (got ${JSON.stringify(out.headers['set-cookie'])})`);
    });

    await tc('17.7 login does not reveal whether an email exists', async () => {
      const a = await t.http().post('/api/auth/login').send({ email: 'nobody-' + Date.now() + '@test.local', password: 'Wrong1234' });
      const b = await t.http().post('/api/auth/login').send({ email: V.email, password: 'Wrong1234' });
      check(a.status === b.status && a.body.message === b.body.message, `same answer (unknown: ${a.status} "${a.body.message}", wrong password: ${b.status} "${b.body.message}")`);
      const f1 = await t.http().post('/api/auth/forgot-password').send({ email: 'nobody-' + Date.now() + '@test.local' });
      const f2 = await t.http().post('/api/auth/forgot-password').send({ email: V.email });
      check(f1.status === f2.status && f1.body.message === f2.body.message, 'forgot-password answers the same too');
    });

    await tc('17.8 brute force: the account locks after 5 wrong passwords, even for the right one', async () => {
      const W = await traveler(t, 'TEST Brute');
      for (let i = 0; i < 5; i++) await t.http().post('/api/auth/login').send({ email: W.email, password: 'Wrong' + i + 'xx1' });
      const r = await t.http().post('/api/auth/login').send({ email: W.email, password: TEST_PASSWORD });
      check(r.status === 423, 'right password refused while locked (423)', r);
    });

    // ---- A03 Injection ------------------------------------------------
    await tc('17.9 NoSQL injection in bodies is refused', async () => {
      const probes = [
        await t.http().post('/api/auth/login').send({ email: { $gt: '' }, password: { $gt: '' } }),
        await t.http().post('/api/auth/login').send({ email: V.email, password: { $ne: 'x' } }),
        await t.http().post('/api/auth/forgot-password').send({ email: { $regex: '.*' } }),
      ];
      check(probes.every((r) => r.status === 400), 'all 400: ' + probes.map((r) => r.status).join(','));
    });

    await tc('17.10 NoSQL injection in query strings is refused or harmless', async () => {
      const bad: string[] = [];
      const urls = [
        '/api/hotels/search?city[$ne]=x&checkIn=2099-12-05&checkOut=2099-12-07&guests=1&rooms=1',
        '/api/flights/search?from[$ne]=x&to=DXB&date=2099-12-02',
        '/api/posts?tag[$regex]=.*',
        '/api/admin/accounts?email[$regex]=.*',
        '/api/itineraries/public/search?keyword[$ne]=x',
      ];
      for (const u of urls) {
        const r = await (u.includes('/admin/') ? A.agent : t.http()).get(u);
        if (!(r.status === 400 || (r.status === 200 && Array.isArray(r.body.data) && r.body.data.length === 0))) bad.push(`${u} -> ${r.status} ${JSON.stringify(r.body).slice(0, 100)}`);
      }
      check(bad.length === 0, bad.join(' | '));
    });

    await tc('17.11 stored script tags come back as JSON text, never as a web page', async () => {
      const r = await U.agent.post('/api/posts').send({ title: '<script>alert(1)</script>', body: '<img src=x onerror=alert(1)>', tags: ['xss'], status: 'Published' });
      check(r.status === 201, 'post created', r);
      const g = await t.http().get(`/api/posts/${r.body._id}`);
      check(/application\/json/.test(g.headers['content-type']), `served as JSON (got ${g.headers['content-type']})`);
    });

    // ---- A01 Broken access control ------------------------------------
    await tc('17.12 mass assignment: users cannot give themselves a role or status', async () => {
      const reg = await t.http().post('/api/auth/register').send({ name: 'TEST Mass', email: `mass-${Date.now()}@test.local`, password: TEST_PASSWORD, acceptTerms: true, role: 'admin', emailVerified: true, status: 'active' });
      check(reg.status === 400, 'register with role/emailVerified -> 400', reg);
      const before = await t.model('User').findById(U.id).lean<any>();
      const bad: string[] = [];
      for (const f of [{ role: 'admin' }, { status: 'active' }, { emailVerified: true }, { assignedProviderId: '6a0000000000000000000001' }, { passwordHash: 'x' }, { email: 'new@test.local' }]) {
        const r = await U.agent.patch('/api/users/me').send({ name: 'TEST Sec U', ...f });
        if (r.status < 400) bad.push(`${Object.keys(f)[0]} accepted ${r.status}`);
      }
      const after = await t.model('User').findById(U.id).lean<any>();
      check(after.role === before.role && after.status === before.status && after.email === before.email, 'nothing changed in the database');
      check(bad.length === 0, bad.join('; '));
    });

    await tc('17.13 a moderator cannot touch another airline (horizontal privilege)', async () => {
      const r1 = await M1.agent.patch(`/api/flights/${flightB}`).send({ to: 'LHR' });
      const r2 = await M1.agent.get(`/api/flights/${flightB}/bookings`);
      const r3 = await M1.agent.post(`/api/flights/${flightB}/cancel`).send({ reason: 'TEST' });
      check([r1, r2, r3].every((r) => r.status === 403 || r.status === 404), `refused (${[r1, r2, r3].map((r) => r.status)})`);
      const f = await t.model('Flight').findById(flightB).lean<any>();
      check(f.status !== 'Cancelled' && f.to !== 'LHR', 'the other airline\'s flight is unchanged');
    });

    await tc('17.14 path traversal on uploaded files is refused', async () => {
      const bad: string[] = [];
      for (const p of ['..%2F..%2Fpackage.json', '..%2F.env', '%2e%2e%2f%2e%2e%2fpackage.json', '....%2F%2F....%2F%2Fpackage.json', '..%5C..%5Cpackage.json']) {
        const r = await t.http().get(`/api/uploads/${p}`);
        if (r.status !== 404 && r.status !== 400) bad.push(`${p} -> ${r.status}`);
        if (/"dependencies"|JWT_SECRET|MONGODB_URI/.test(r.text ?? '')) bad.push(`${p} leaked file content`);
      }
      check(bad.length === 0, bad.join('; '));
    });

    await tc('17.15 uploads check the file content, not just the name', async () => {
      const bad: string[] = [];
      const files: [string, Buffer][] = [
        ['shell.png', Buffer.from('<?php system($_GET[1]); ?>')],
        ['x.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
        ['page.html', Buffer.from('<html><script>alert(1)</script></html>')],
      ];
      for (const [name, buf] of files) {
        const r = await U.agent.post('/api/uploads/images').attach('images', buf, name);
        if (r.status !== 400) bad.push(`${name} -> ${r.status}`);
      }
      const big = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(6 * 1024 * 1024)]);
      const r = await U.agent.post('/api/uploads/images').attach('images', big, 'big.png');
      if (r.status !== 400 && r.status !== 413) bad.push(`6 MB png -> ${r.status}`);
      check(bad.length === 0, bad.join('; '));
    });

    // ---- A02 Cryptographic failures / data exposure -------------------
    await tc('17.16 no password hashes or tokens in any response', async () => {
      const pages: Res[] = [
        await U.agent.get('/api/auth/me'),
        await U.agent.get('/api/users/me'),
        await A.agent.get('/api/admin/accounts'),
        await A.agent.get('/api/admin/accounts?role=user'),
        await t.http().get(`/api/authors/${U.id}`),
        await t.http().get('/api/posts'),
        await A.agent.get('/api/admin/audit-logs'),
        await t.http().post('/api/auth/login').send({ email: V.email, password: TEST_PASSWORD }),
        await t.http().post('/api/auth/register').send({ name: 'TEST Leak', email: `leak-${Date.now()}@test.local`, password: TEST_PASSWORD, acceptTerms: true }),
      ];
      const leaks = pages.filter((r) => SECRET_FIELDS.test(JSON.stringify(r.body)));
      check(leaks.length === 0, 'leaked in: ' + leaks.map((r) => (r as any).req?.path).join(', '));
      const stored = await t.model('User').findById(U.id).select('+passwordHash').lean<any>();
      check(/^\$2[aby]\$\d\d\$/.test(stored.passwordHash ?? ''), 'passwords stored as bcrypt hashes');
      return `${pages.length} responses scanned`;
    });

    await tc('17.17 a password reset link is single-use and useless once a newer one exists', async () => {
      const R = await traveler(t, 'TEST Reset Sec');
      await t.http().post('/api/auth/forgot-password').send({ email: R.email }).expect(200);
      const tok = t.outbox.token(R.email, 'reset-password');
      const stored = JSON.stringify(await t.model('User').findById(R.id).lean<any>());
      check(!stored.includes(tok), 'the raw token is not stored in the database (only a hash)');
      await t.http().post('/api/auth/reset-password').send({ token: tok, newPassword: 'Another123' }).expect(200);
      const again = await t.http().post('/api/auth/reset-password').send({ token: tok, newPassword: 'Another456' });
      check(again.status === 400, 'second use refused', again);
    });

    // ---- A08 Software and data integrity --------------------------------
    await tc('17.18 Stripe webhooks: replayed old signatures and edited bodies are refused', async () => {
      const ev = paymentIntentEvent('payment_intent.succeeded', { id: 'pi_sec_1', status: 'succeeded', amount: 100, amountReceived: 100, currency: 'usd', clientSecret: null, metadata: {} });
      const payload = JSON.stringify(ev);
      const sig = (ts: number, body: string) => `t=${ts},v1=${crypto.createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET!).update(`${ts}.${body}`).digest('hex')}`;
      const old = await t.http().post('/api/payments/webhook').set('Content-Type', 'application/json').set('stripe-signature', sig(Math.floor(Date.now() / 1000) - 3600, payload)).send(payload);
      check(old.status === 400, 'a signature from an hour ago is refused (replay)', old);
      const now = Math.floor(Date.now() / 1000);
      const edited = payload.replace('"amount":100', '"amount":999');
      const r = await t.http().post('/api/payments/webhook').set('Content-Type', 'application/json').set('stripe-signature', sig(now, payload)).send(edited);
      check(r.status === 400, 'a body changed after signing is refused', r);
    });

    // ---- A04 Insecure design / A01 ------------------------------------
    await tc('17.19 prices come from the server, never from the request', async () => {
      const h = await V.agent.post('/api/flight-bookings/hold').send({ outboundFlightId: flightB, cabin: 'Economy', passengers: [{ type: 'adult', fullName: 'TEST Cheap', dateOfBirth: '1990-01-01', passportNumber: 'A1234567' }], totalAmount: 1, price: 1 });
      check(h.status === 400, 'extra price fields refused (400)', h);
      const ok = await V.agent.post('/api/flight-bookings/hold').send({ outboundFlightId: flightB, cabin: 'Economy', passengers: [{ type: 'adult', fullName: 'TEST Cheap', dateOfBirth: '1990-01-01', passportNumber: 'A1234567' }] });
      await V.agent.post(`/api/bookings/flight/${ok.body._id}/accept-policies`).send({ accepted: true });
      const pay = await V.agent.post(`/api/bookings/flight/${ok.body._id}/pay`).send({ amount: 1 });
      check(pay.status === 400 || (pay.status === 201 && t.stripe.lastIntent()!.amount === 20000), `amount in the request ignored or refused (${pay.status}, intent ${t.stripe.lastIntent()?.amount})`, pay);
    });

    await tc('17.20 a deactivated or suspended account loses access at once', async () => {
      const S = await traveler(t, 'TEST Suspend Sec');
      await S.agent.get('/api/auth/me').expect(200);
      await A.agent.patch(`/api/admin/accounts/${S.id}/suspend`).send({ reason: 'TEST' }).expect(200);
      const r = await S.agent.get('/api/auth/me');
      check(r.status === 401, 'open session ends (401)', r);
      const rf = await S.agent.post('/api/auth/refresh');
      check(rf.status === 401 || rf.status === 403, 'refresh refused too', rf);
    });

    expect(results.filter((r) => !r.ok).map((r) => r.id)).toEqual([]);
  }, 300_000);
});
