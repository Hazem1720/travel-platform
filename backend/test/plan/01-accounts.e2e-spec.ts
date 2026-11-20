// Milestone 1 test plan (the team's "Milestone 1 Test Plan" doc), Part 1 (accounts &
// authentication), cases 1.1-1.30. Every case runs even if an earlier one
// fails; the results table is printed at the end and the suite fails if
// any case failed. Expected results come from the requirement text.
import * as request from 'supertest';
import { Types } from 'mongoose';
import { User } from '../../src/users/schemas/user.schema';
import { FlightBooking } from '../../src/flight-bookings/schemas/flight-booking.schema';
import { createTestApp, TestApp } from '../e2e/app';
import { admin, login, testEmail, TEST_PASSWORD } from '../e2e/actors';
import { createAirline, seedReference } from '../e2e/fixtures';

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

async function tc(id: string, fn: () => Promise<string | void>) {
  try {
    const note = await fn();
    results.push({ id, ok: true, note: note || '' });
  } catch (e) {
    results.push({ id, ok: false, note: (e as Error).message.slice(0, 400) });
  }
}

const cookie = (res: Res, name: string): string | null => {
  const all = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const c = all.find((x) => x.startsWith(`${name}=`));
  return c ? c.split(';')[0] : null;
};
const rawCookie = (res: Res, name: string): string =>
  ([] as string[])
    .concat(res.headers['set-cookie'] ?? [])
    .find((x) => x.startsWith(`${name}=`)) ?? '';

describe('Test plan Part 1: accounts & authentication', () => {
  let t: TestApp;
  const users = () => t.model(User.name);

  const register = (body: Record<string, unknown>) =>
    t.http().post('/api/auth/register').send(body);
  const newUser = (who = 'u') => ({
    name: 'TEST User',
    email: testEmail(who),
    password: TEST_PASSWORD,
    acceptTerms: true,
  });
  const verify = (email: string) =>
    t
      .http()
      .get('/api/auth/verify-email')
      .query({ token: t.outbox.token(email, 'verify-email') });

  beforeAll(async () => {
    t = await createTestApp('part1-accounts');
    await seedReference(t);
  }, 60_000);

  afterAll(async () => {
    const pass = results.filter((r) => r.ok).length;
    console.log(
      `\nPART 1 RESULTS: ${pass}/${results.length} passed\n` +
        results
          .map(
            (r) =>
              `${r.ok ? 'PASS' : 'FAIL'} ${r.id}${r.note ? '  ' + r.note : ''}`,
          )
          .join('\n'),
    );
    await t?.close();
  });

  it('runs cases 1.1-1.30 (ACC-01, ACC-02, ACC-04, ACC-05, ACC-06, ACC-07, ACC-07a, ACC-08, ACC-09, ACC-12, ACC-13, ACC-18)', async () => {
    // ---------- Registration ----------
    const a = newUser('a');
    await tc('1.1', async () => {
      const res = await register(a);
      check(res.status === 201, 'register should be 201', res);
      check(
        !JSON.stringify(res.body).includes('passwordHash'),
        'no hash in body',
        res,
      );
      check(
        t.outbox.links(a.email, 'verify-email').length === 1,
        'verification email sent',
      );
    });
    await tc('1.2', async () => {
      const res = await register({ ...a, email: a.email.toUpperCase() });
      check(res.status === 409, 'same email in other case should be 409', res);
    });
    await tc('1.3', async () => {
      const cases: [string, Record<string, unknown>, string][] = [
        ['7 chars', { ...newUser(), password: 'Abc1234' }, 'password'],
        ['no digit', { ...newUser(), password: 'abcdefgh' }, 'password'],
        ['no letter', { ...newUser(), password: '12345678' }, 'password'],
        ['bad email', { ...newUser(), email: 'not-an-email' }, 'email'],
        ['no name', { ...newUser(), name: undefined }, 'name'],
      ];
      for (const [what, body, field] of cases) {
        const res = await register(body);
        check(res.status === 400, `${what}: 400`, res);
        check(!!res.body?.details?.[field], `${what}: details.${field}`, res);
      }
    });
    await tc('1.4', async () => {
      const r1 = await register({ ...newUser(), acceptTerms: false });
      check(r1.status === 400, 'acceptTerms false -> 400', r1);
      const { acceptTerms: _, ...noTerms } = newUser();
      const r2 = await register(noTerms);
      check(r2.status === 400, 'acceptTerms missing -> 400', r2);
    });
    await tc('1.5', async () => {
      const u = newUser('role');
      const res = await register({ ...u, role: 'admin' });
      check(res.status === 400, 'extra field role -> 400', res);
      check(
        (await users().countDocuments({ email: u.email })) === 0,
        'no account created',
      );
    });

    // ---------- Login / session ----------
    let loginRes: Res | null = null;
    await tc('1.6', async () => {
      const res = await t
        .http()
        .post('/api/auth/login')
        .send({ email: a.email, password: a.password });
      loginRes = res;
      check(res.status === 200, 'login 200', res);
      const ac = rawCookie(res, 'access_token');
      check(/httponly/i.test(ac), 'access_token cookie is httpOnly');
      check(/samesite/i.test(ac), 'access_token cookie has SameSite');
      check(!!cookie(res, 'refresh_token'), 'refresh_token cookie set');
      check(
        !/eyJ[\w-]+\.[\w-]+\./.test(JSON.stringify(res.body)),
        'no token in JSON body',
        res,
      );
    });
    await tc('1.7', async () => {
      const wrong = await t
        .http()
        .post('/api/auth/login')
        .send({ email: a.email, password: 'Wrong1234' });
      const unknown = await t
        .http()
        .post('/api/auth/login')
        .send({ email: testEmail('nobody'), password: 'Wrong1234' });
      check(wrong.status === 401 && unknown.status === 401, 'both 401', wrong);
      check(
        wrong.body.message === unknown.body.message,
        `same message ("${wrong.body.message}" vs "${unknown.body.message}")`,
      );
      await users().updateOne(
        { email: a.email },
        { $set: { failedLoginAttempts: 0 } },
      );
    });
    await tc('1.8', async () => {
      const s = newUser('susp');
      await register(s);
      await users().updateOne(
        { email: s.email },
        { $set: { status: 'suspended' } },
      );
      const res = await t
        .http()
        .post('/api/auth/login')
        .send({ email: s.email, password: s.password });
      check(res.status === 403, 'suspended login 403', res);
      check(/suspend/i.test(res.body.message), 'message says suspended', res);
      return `message: "${res.body.message}"`;
    });
    const aAgent = request.agent(t.server);
    await aAgent
      .post('/api/auth/login')
      .send({ email: a.email, password: a.password });
    await tc('1.9', async () => {
      const me = await aAgent.get('/api/auth/me');
      check(
        me.status === 200 && me.body.email === a.email.toLowerCase(),
        'me 200 with profile',
        me,
      );
      const anon = await t.http().get('/api/auth/me');
      check(anon.status === 401, 'me without session 401', anon);
    });
    await tc('1.10', async () => {
      const lr = await t
        .http()
        .post('/api/auth/login')
        .send({ email: a.email, password: a.password });
      const oldRefresh = cookie(lr, 'refresh_token')!;
      const r1 = await t
        .http()
        .post('/api/auth/refresh')
        .set('Cookie', oldRefresh);
      check(r1.status === 200, 'refresh 200', r1);
      check(
        !!cookie(r1, 'refresh_token') &&
          cookie(r1, 'refresh_token') !== oldRefresh,
        'new refresh cookie',
      );
      const r2 = await t
        .http()
        .post('/api/auth/refresh')
        .set('Cookie', oldRefresh);
      check(r2.status === 401, 'old refresh token reused -> 401', r2);
    });
    await tc('1.11', async () => {
      const ag = request.agent(t.server);
      await ag
        .post('/api/auth/login')
        .send({ email: a.email, password: a.password })
        .expect(200);
      const lr = await ag.post('/api/auth/logout');
      check(lr.status === 200, 'logout 200', lr);
      const me = await ag.get('/api/auth/me');
      check(me.status === 401, 'me after logout 401', me);
    });
    void loginRes;

    // ---------- Email verification (ACC-02) ----------
    await tc('1.12', async () => {
      const res = await verify(a.email);
      check(res.status === 200, 'verify 200', res);
      const u = await users()
        .findOne({ email: a.email.toLowerCase() })
        .lean<any>();
      check(u.emailVerified === true, 'emailVerified true');
    });
    await tc('1.13', async () => {
      const bad = await t
        .http()
        .get('/api/auth/verify-email')
        .query({ token: 'deadbeef' });
      check(bad.status === 400, 'wrong token 400', bad);
      const used = await verify(a.email);
      check(used.status === 400, 'used token 400', used);
    });
    const b = newUser('b');
    await register(b);
    const bAgent = request.agent(t.server);
    await bAgent
      .post('/api/auth/login')
      .send({ email: b.email, password: b.password });
    await tc('1.14', async () => {
      const first = t.outbox.token(b.email, 'verify-email');
      const res = await bAgent.post('/api/auth/resend-verification');
      check(res.status === 200, 'resend 200', res);
      const second = t.outbox.token(b.email, 'verify-email');
      check(second !== first, 'a new link was emailed');
      const old = await t
        .http()
        .get('/api/auth/verify-email')
        .query({ token: first });
      check(old.status === 400, 'old link no longer works', old);
    });
    await tc('1.15', async () => {
      const res = await bAgent.post('/api/flight-bookings/hold').send({});
      check(res.status === 403, 'unverified user cannot book (403)', res);
      return `message: "${res.body.message}"`;
    });
    await verify(b.email);

    // ---------- Password reset (ACC-07) ----------
    await tc('1.16', async () => {
      const before = t.outbox.messages.length;
      const known = await t
        .http()
        .post('/api/auth/forgot-password')
        .send({ email: b.email });
      const unknownEmail = testEmail('ghost');
      const unknown = await t
        .http()
        .post('/api/auth/forgot-password')
        .send({ email: unknownEmail });
      check(
        known.status === 200 && unknown.status === 200,
        'both 200',
        unknown,
      );
      check(
        JSON.stringify(known.body) === JSON.stringify(unknown.body),
        'same response for both',
      );
      check(
        t.outbox.to(unknownEmail).length === 0,
        'no email to unknown address',
      );
      check(
        t.outbox.messages.length === before + 1,
        'one email to the known address',
      );
    });
    const newPass = 'NewPassw0rd2';
    let resetToken = '';
    await tc('1.17', async () => {
      resetToken = t.outbox.token(b.email, 'reset-password');
      const res = await t
        .http()
        .post('/api/auth/reset-password')
        .send({ token: resetToken, newPassword: newPass });
      check(res.status === 200, 'reset 200', res);
      const oldLogin = await t
        .http()
        .post('/api/auth/login')
        .send({ email: b.email, password: b.password });
      check(oldLogin.status === 401, 'old password refused', oldLogin);
      const newLogin = await t
        .http()
        .post('/api/auth/login')
        .send({ email: b.email, password: newPass });
      check(newLogin.status === 200, 'new password works', newLogin);
    });
    await tc('1.18', async () => {
      const used = await t
        .http()
        .post('/api/auth/reset-password')
        .send({ token: resetToken, newPassword: 'Another1x' });
      check(used.status === 400, 'used token 400', used);
      await t.http().post('/api/auth/forgot-password').send({ email: b.email });
      const tok = t.outbox.token(b.email, 'reset-password');
      const weak = await t
        .http()
        .post('/api/auth/reset-password')
        .send({ token: tok, newPassword: 'short' });
      check(weak.status === 400, 'weak new password 400', weak);
    });

    // ---------- Change password / profile ----------
    const c = newUser('c');
    await register(c);
    let cAgent = (await login(t, c.email, c.password)).agent;
    await tc('1.19', async () => {
      const res = await cAgent
        .patch('/api/auth/change-password')
        .send({ currentPassword: c.password, newPassword: 'Changed123' });
      check(res.status === 200, 'change password 200', res);
      const relog = await t
        .http()
        .post('/api/auth/login')
        .send({ email: c.email, password: 'Changed123' });
      check(relog.status === 200, 'new password works', relog);
      c.password = 'Changed123';
      cAgent = (await login(t, c.email, c.password)).agent;
    });
    await tc('1.20', async () => {
      const wrong = await cAgent
        .patch('/api/auth/change-password')
        .send({ currentPassword: 'Wrong1234', newPassword: 'Other1234' });
      check(
        wrong.status === 400 || wrong.status === 401,
        'wrong current password refused',
        wrong,
      );
      const same = await cAgent
        .patch('/api/auth/change-password')
        .send({ currentPassword: c.password, newPassword: c.password });
      check(same.status === 400, 'same as old refused', same);
      const weak = await cAgent
        .patch('/api/auth/change-password')
        .send({ currentPassword: c.password, newPassword: 'abcdefgh' });
      check(weak.status === 400, 'weak new password refused', weak);
    });
    await tc('1.21', async () => {
      const res = await cAgent
        .patch('/api/users/me')
        .send({
          name: 'TEST Renamed',
          phone: '+201001234567',
          preferredCurrency: 'EUR',
        });
      check(res.status === 200, 'profile update 200', res);
      const me = await cAgent.get('/api/users/me');
      check(
        me.body.name === 'TEST Renamed' &&
          me.body.phone === '+201001234567' &&
          me.body.preferredCurrency === 'EUR',
        'saved values returned',
        me,
      );
      const email = await cAgent
        .patch('/api/users/me')
        .send({ email: testEmail('x') });
      check(email.status === 400, 'email cannot be changed here', email);
      const role = await cAgent.patch('/api/users/me').send({ role: 'admin' });
      check(role.status === 400, 'role cannot be changed', role);
    });
    await tc('1.22', async () => {
      for (const [what, body] of [
        ['bad phone', { phone: 'abc' }],
        ['unsupported currency', { preferredCurrency: 'XXX' }],
        ['empty name', { name: '' }],
      ] as const) {
        const res = await cAgent.patch('/api/users/me').send(body);
        check(res.status === 400, `${what} -> 400`, res);
      }
      const me = await cAgent.get('/api/users/me');
      check(
        me.body.name === 'TEST Renamed',
        'nothing saved from the invalid requests',
        me,
      );
    });

    // ---------- Deactivation (ACC-12) ----------
    await tc('1.23', async () => {
      const cu = await users()
        .findOne({ email: c.email.toLowerCase() })
        .lean<any>();
      const dep = new Date(Date.now() + 10 * 86_400_000);
      await t.model(FlightBooking.name).collection.insertOne({
        userId: cu._id,
        status: 'Confirmed',
        segments: [
          { flightId: new Types.ObjectId(), departureAt: dep, arrivalAt: dep },
        ],
        passengers: [],
        totalAmount: 1000,
        currency: 'USD',
        createdAt: new Date(),
      });
      const res = await cAgent.delete('/api/users/me');
      check(
        res.status === 409,
        'deactivation refused while a booking is ahead',
        res,
      );
      const after = await users().findOne({ _id: cu._id }).lean<any>();
      check(after.status === 'active', 'account still active');
    });
    await tc('1.24', async () => {
      const d = newUser('d');
      await register(d);
      const ag = (await login(t, d.email, d.password)).agent;
      const res = await ag.delete('/api/users/me');
      check(res.status === 200, 'deactivate 200', res);
      const me = await ag.get('/api/auth/me');
      check(me.status === 401, 'old session ended', me);
      const relog = await t
        .http()
        .post('/api/auth/login')
        .send({ email: d.email, password: d.password });
      check(
        relog.status === 401 || relog.status === 403,
        'login refused after deactivation',
        relog,
      );
      return `login after deactivation: ${relog.status} "${relog.body.message}"`;
    });

    // ---------- Moderators (ACC-13) ----------
    const adm = await admin(t);
    const airlineId = String(await createAirline(t));
    const modEmail = testEmail('mod');
    await tc('1.25', async () => {
      const res = await adm.agent.post('/api/admin/moderators').send({
        name: 'TEST Mod',
        email: modEmail,
        role: 'airline_moderator',
        providerId: airlineId,
        temporaryPassword: 'TempPass123',
      });
      check(res.status === 201, 'create moderator 201', res);
      check(
        !JSON.stringify(res.body).includes('TempPass123'),
        'temporary password not echoed',
        res,
      );
      return t.outbox.to(modEmail).length
        ? 'invitation email sent'
        : 'no invitation email (GEN-01-B)';
    });
    await tc('1.26', async () => {
      const unknown = await adm.agent.post('/api/admin/moderators').send({
        name: 'TEST Mod',
        email: testEmail('mod'),
        role: 'airline_moderator',
        providerId: String(new Types.ObjectId()),
        temporaryPassword: 'TempPass123',
      });
      check(
        unknown.status === 400 || unknown.status === 404,
        'unknown provider refused',
        unknown,
      );
      const role = await adm.agent.post('/api/admin/moderators').send({
        name: 'TEST Mod',
        email: testEmail('mod'),
        role: 'admin',
        providerId: airlineId,
        temporaryPassword: 'TempPass123',
      });
      check(role.status === 400, 'role admin refused', role);
      const weak = await adm.agent.post('/api/admin/moderators').send({
        name: 'TEST Mod',
        email: testEmail('mod'),
        role: 'airline_moderator',
        providerId: airlineId,
        temporaryPassword: 'short',
      });
      check(weak.status === 400, 'weak temporary password refused', weak);
    });
    await tc('1.27', async () => {
      const mod = (await login(t, modEmail, 'TempPass123')).agent;
      const blocked = await mod
        .patch(`/api/airlines/${airlineId}`)
        .send({ name: 'TEST Renamed Air' });
      check(
        blocked.status === 403,
        'must change temporary password first (403)',
        blocked,
      );
      const ch = await mod
        .patch('/api/auth/change-password')
        .send({ currentPassword: 'TempPass123', newPassword: 'ModPass123' });
      check(ch.status === 200, 'change password 200', ch);
      const ok = await mod
        .patch(`/api/airlines/${airlineId}`)
        .send({ name: 'TEST Renamed Air' });
      check(ok.status === 200, 'works after changing it', ok);
    });
    await tc('1.28', async () => {
      const body = {
        name: 'TEST Mod',
        email: testEmail('mod'),
        role: 'airline_moderator',
        providerId: airlineId,
        temporaryPassword: 'TempPass123',
      };
      const asUser = await cAgent.post('/api/admin/moderators').send(body);
      const mod = (await login(t, modEmail, 'ModPass123')).agent;
      const asMod = await mod.post('/api/admin/moderators').send(body);
      check(
        asUser.status === 403 && asMod.status === 403,
        'user and moderator get 403',
        asUser.status === 403 ? asMod : asUser,
      );
      const anon = await t.http().post('/api/admin/moderators').send(body);
      check(anon.status === 401, 'no session 401', anon);
    });

    // ---------- Admin password reset (ACC-07a) ----------
    await tc('1.29', async () => {
      const e = newUser('e');
      await register(e);
      const eu = await users()
        .findOne({ email: e.email.toLowerCase() })
        .lean<any>();
      let res = await adm.agent
        .post(`/api/admin/users/${eu._id}/reset-password`)
        .send({ temporaryPassword: 'Temp4567x' });
      if (res.status === 404) {
        res = await adm.agent
          .post(`/api/admin/accounts/${eu._id}/reset-password`)
          .send({ temporaryPassword: 'Temp4567x' });
      }
      check(
        res.status === 200 || res.status === 201,
        'admin reset accepted',
        res,
      );
      const old = await t
        .http()
        .post('/api/auth/login')
        .send({ email: e.email, password: e.password });
      check(old.status === 401, 'old password refused', old);
      const ag = (await login(t, e.email, 'Temp4567x')).agent;
      const blocked = await ag.get('/api/users/me');
      check(blocked.status === 403, 'must set a new password first', blocked);
      const ch = await ag
        .patch('/api/auth/change-password')
        .send({ currentPassword: 'Temp4567x', newPassword: 'Fresh1234' });
      check(ch.status === 200, 'new password set', ch);
      const after = await ag.get('/api/users/me');
      check(after.status === 200, 'works afterwards', after);
      const asUser = await cAgent
        .post(`/api/admin/users/${eu._id}/reset-password`)
        .send({ temporaryPassword: 'Temp4567x' });
      check(asUser.status === 403, 'a user cannot reset passwords', asUser);
    });

    // ---------- Lockout (ACC-05) ----------
    await tc('1.30', async () => {
      const f = newUser('f');
      await register(f);
      const attempt = (password: string) =>
        t.http().post('/api/auth/login').send({ email: f.email, password });
      for (let i = 1; i <= 5; i++) {
        const r = await attempt('Wrong1234');
        check(r.status === 401, `failed attempt ${i} -> 401`, r);
      }
      const locked = await attempt(f.password);
      check(
        locked.status === 423 || locked.status === 429 || locked.status === 403,
        'right password refused while locked',
        locked,
      );
      check(/lock/i.test(locked.body.message), 'lockout message', locked);
      const fu = await users()
        .findOne({ email: f.email.toLowerCase() })
        .lean<any>();
      const mins = (new Date(fu.lockUntil).getTime() - Date.now()) / 60_000;
      check(
        mins > 14 && mins <= 15,
        `locked for 15 minutes (got ${mins.toFixed(1)})`,
      );
      await users().updateOne(
        { _id: fu._id },
        { $set: { lockUntil: new Date(Date.now() - 1000) } },
      );
      const after = await attempt(f.password);
      check(after.status === 200, 'login works after the lock ends', after);
      for (let i = 1; i <= 4; i++) await attempt('Wrong1234');
      const ok = await attempt(f.password);
      check(
        ok.status === 200,
        'success resets the counter (4 fails + success not locked)',
        ok,
      );
      for (let i = 1; i <= 4; i++) await attempt('Wrong1234');
      const still = await attempt(f.password);
      check(
        still.status === 200,
        'counter was reset by the earlier success',
        still,
      );
      return `lock status ${locked.status}`;
    });

    expect(results.filter((r) => !r.ok).map((r) => r.id)).toEqual([]);
  }, 120_000);
});
