import { ConfigService } from '@nestjs/config';
import * as request from 'supertest';
import { EMAIL_NOT_VERIFIED } from '../../src/common/decorators/verified-email.decorator';
import { AccountStatus } from '../../src/common/enums/role.enum';
import { User } from '../../src/users/schemas/user.schema';
import {
  admin,
  airlineModerator,
  hotelModerator,
  login,
  TEST_PASSWORD,
  testEmail,
  traveler,
} from './actors';
import { createTestApp, TestApp } from './app';

// E2E_PLAN.md section 3, suite 2: accounts and sessions, over real HTTP.
// Every request under test is sent plainly; only arranging requests go
// through actors.ts or setup() (x-e2e-setup), so they do not count as
// coverage.

const NEW_PASSWORD = 'N3wPassw0rd';
const GENERIC_LOGIN_ERROR = 'Invalid email or password';
const LOCKED = 'Account temporarily locked. Try again later.';
const FORGOT_ANSWER =
  'If an account exists for this email, a password reset link has been sent';
const INVALID_RESET_LINK = 'This password reset link is invalid or has expired';
const MINUTE = 60_000;

// Set-Cookie headers by cookie name.
function cookiesOf(res: request.Response): Record<string, string> {
  const raw = res.headers['set-cookie'] as unknown;
  const list = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
  return Object.fromEntries(list.map((c: string) => [c.split('=')[0], c]));
}

// The value of a Set-Cookie header ("name=value; Path=/; ...").
const valueOf = (setCookie: string | undefined) =>
  setCookie?.split(';')[0].split('=').slice(1).join('=') ?? '';

describe('accounts and sessions', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp('auth');
  });
  afterAll(async () => t?.close());

  const users = () => t.model(User.name);
  const userByEmail = (email: string, select = '') =>
    users().findOne({ email }).select(select).lean<any>();
  const register = (body: Record<string, unknown>) =>
    t.http().post('/api/auth/register').send(body);
  const validForm = (email = testEmail('reg')) => ({
    name: 'TEST Sara Ali',
    email,
    password: TEST_PASSWORD,
    acceptTerms: true,
  });
  const loginWith = (email: string, password: string) =>
    t.http().post('/api/auth/login').send({ email, password });

  // ---------------------------------------------------------------------
  describe('registration', () => {
    it('registers a guest with name, email, password and consent, storing only a hash (ACC-01)', async () => {
      const form = validForm();
      const res = await register(form).expect(201);
      const saved = await userByEmail(form.email, '+passwordHash');
      expect({
        name: saved.name,
        role: saved.role,
        consent: saved.acceptedTermsAt instanceof Date,
        hashed:
          saved.passwordHash !== TEST_PASSWORD &&
          saved.passwordHash.startsWith('$2'),
      }).toEqual({
        name: 'TEST Sara Ali',
        role: 'user',
        consent: true,
        hashed: true,
      });
      // A registration does not log in, so no session cookie is set.
      expect(Object.keys(cookiesOf(res))).toEqual([]);
    });

    it('rejects every invalid form with an error on its field (ACC-01)', async () => {
      const email = testEmail('bad');
      const cases: [string, Record<string, unknown>, string][] = [
        ['invalid email', { ...validForm(), email: 'not-an-email' }, 'email'],
        ['no name', { ...validForm(email), name: '' }, 'name'],
        [
          'password of 7 characters',
          { ...validForm(email), password: 'Abcde12' },
          'password',
        ],
        [
          'password without a digit',
          { ...validForm(email), password: 'Abcdefgh' },
          'password',
        ],
        [
          'password without a letter',
          { ...validForm(email), password: '12345678' },
          'password',
        ],
        [
          'consent not given',
          { ...validForm(email), acceptTerms: false },
          'acceptTerms',
        ],
        [
          'consent missing',
          { ...validForm(email), acceptTerms: undefined },
          'acceptTerms',
        ],
      ];
      const answers: string[] = [];
      for (const [name, body, field] of cases) {
        const res = await register(body);
        answers.push(
          `${name}: ${res.status} ${res.body.details?.[field] ? field : '(no error on the field)'}`,
        );
      }
      expect(answers).toEqual(
        cases.map(([name, , field]) => `${name}: 400 ${field}`),
      );
      expect(await users().countDocuments({ email })).toBe(0);
    });

    it('rejects an email that is already registered, in any letter case (ACC-01)', async () => {
      const form = validForm();
      await register(form).expect(201);
      const again = await register({
        ...form,
        email: form.email.toUpperCase(),
      });
      expect([again.status, again.body.message]).toEqual([
        409,
        'Email is already registered',
      ]);
      expect(await users().countDocuments({ email: form.email })).toBe(1);
    });
  });

  // ---------------------------------------------------------------------
  describe('email verification', () => {
    // ACC-02 (bonus): a link is emailed after registration; booking stays
    // blocked until it is opened.
    const BOOKING_ROUTES: [string, string][] = [
      ['POST', '/api/flight-bookings/hold'],
      ['POST', '/api/hotel-bookings'],
      ['POST', '/api/bookings/flight/000000000000000000000000/pay'],
      ['POST', '/api/payments'],
      ['POST', '/api/payments/000000000000000000000000/retry'],
    ];

    it('emails a verification link, blocks booking until it is opened, then allows it (ACC-02)', async () => {
      const form = validForm();
      await register(form).expect(201);
      expect(t.outbox.links(form.email, 'verify-email')).toHaveLength(1);
      expect((await userByEmail(form.email)).emailVerified).toBe(false);

      const user = await login(t, form.email, TEST_PASSWORD);
      const answers = async () => {
        const out: string[] = [];
        for (const [method, url] of BOOKING_ROUTES) {
          const res = await (user.agent as any)
            [method.toLowerCase()](url)
            .send({});
          out.push(
            `${method} ${url}: ${res.body.message === EMAIL_NOT_VERIFIED ? 'blocked' : 'not blocked'}`,
          );
        }
        return out;
      };
      expect(await answers()).toEqual(
        BOOKING_ROUTES.map(([m, u]) => `${m} ${u}: blocked`),
      );

      await t
        .http()
        .get('/api/auth/verify-email')
        .query({ token: t.outbox.token(form.email, 'verify-email') })
        .expect(200);

      expect((await userByEmail(form.email)).emailVerified).toBe(true);
      expect(await answers()).toEqual(
        BOOKING_ROUTES.map(([m, u]) => `${m} ${u}: not blocked`),
      );
    });
  });

  // ---------------------------------------------------------------------
  describe('login', () => {
    it('logs in every role with email and password and returns the role, so the client can open its home page (ACC-04)', async () => {
      const roles: [string, () => Promise<{ email: string }>][] = [
        ['user', () => traveler(t)],
        ['admin', () => admin(t)],
        [
          'airline_moderator',
          () => airlineModerator(t, '000000000000000000000001'),
        ],
        [
          'hotel_moderator',
          () => hotelModerator(t, '000000000000000000000002'),
        ],
      ];
      const answers: string[] = [];
      for (const [role, make] of roles) {
        const { email } = await make();
        const res = await loginWith(email, TEST_PASSWORD);
        answers.push(
          `${role}: ${res.status} ${res.body.role} ${cookiesOf(res).access_token ? 'session' : 'no session'}`,
        );
      }
      expect(answers).toEqual(
        roles.map(([role]) => `${role}: 200 ${role} session`),
      );
    });

    it('answers a wrong password and an unknown email with the same generic message (ACC-04)', async () => {
      const { email } = await traveler(t);
      const wrongPassword = await loginWith(email, 'Wr0ngPassword');
      const unknownEmail = await loginWith(testEmail('nobody'), TEST_PASSWORD);
      const strip = (r: request.Response) => [
        r.status,
        r.body.error,
        r.body.message,
      ];
      expect(strip(wrongPassword)).toEqual([
        401,
        'Unauthorized',
        GENERIC_LOGIN_ERROR,
      ]);
      expect(strip(unknownEmail)).toEqual(strip(wrongPassword));
    });

    it('tells a suspended account it is suspended, and only with the right password (ACC-04)', async () => {
      const { email } = await traveler(t);
      await users().updateOne(
        { email },
        { $set: { status: AccountStatus.SUSPENDED } },
      );
      const right = await loginWith(email, TEST_PASSWORD);
      const wrong = await loginWith(email, 'Wr0ngPassword');
      expect([
        right.status,
        right.body.message,
        Object.keys(cookiesOf(right)),
      ]).toEqual([403, 'Account is suspended', []]);
      expect([wrong.status, wrong.body.message]).toEqual([
        401,
        GENERIC_LOGIN_ERROR,
      ]);
    });
  });

  // ---------------------------------------------------------------------
  describe('lockout', () => {
    // ACC-05. Whether the 5th failure itself must show the lockout message
    // is spec question #285, so no test asserts it.
    const fail = (email: string, times: number) =>
      (async () => {
        for (let i = 0; i < times; i++) await loginWith(email, 'Wr0ngPassword');
      })();

    it('after 5 failed logins the account is locked for 15 minutes, even for the right password [partial: ACC-05]', async () => {
      const { email } = await traveler(t);
      await fail(email, 5);

      const locked = await loginWith(email, TEST_PASSWORD);
      expect([locked.status, locked.body.message]).toEqual([423, LOCKED]);
      const lockUntil = (await userByEmail(email)).lockUntil.getTime();
      expect(Math.round((lockUntil - Date.now()) / MINUTE)).toBe(15);

      // 15 minutes later (the lock moved into the past) the right password works.
      await users().updateOne(
        { email },
        { $set: { lockUntil: new Date(Date.now() - 1000) } },
      );
      await loginWith(email, TEST_PASSWORD).expect(200);
    });

    it('a successful login resets the counter, so failures must be consecutive [partial: ACC-05]', async () => {
      const { email } = await traveler(t);
      await fail(email, 4);
      await loginWith(email, TEST_PASSWORD).expect(200);
      await fail(email, 4);
      await loginWith(email, TEST_PASSWORD).expect(200);
      expect((await userByEmail(email)).lockUntil).toBeNull();
    });
  });

  // ---------------------------------------------------------------------
  describe('sessions', () => {
    it('logout clears both cookies and revokes the session on the server (ACC-06)', async () => {
      const { email } = await traveler(t);
      const res = await loginWith(email, TEST_PASSWORD).expect(200);
      const cookies = cookiesOf(res);
      const access = `access_token=${valueOf(cookies.access_token)}`;
      const refresh = `refresh_token=${valueOf(cookies.refresh_token)}`;

      const out = await t
        .http()
        .post('/api/auth/logout')
        .set('Cookie', `${access}; ${refresh}`)
        .expect(200);
      const cleared = cookiesOf(out);
      expect([
        valueOf(cleared.access_token),
        valueOf(cleared.refresh_token),
      ]).toEqual(['', '']);

      // Both old cookies are dead on the server, not only in the browser.
      const me = await t.http().get('/api/auth/me').set('Cookie', access);
      const renewed = await t
        .http()
        .post('/api/auth/refresh')
        .set('Cookie', refresh);
      expect([me.status, renewed.status]).toEqual([401, 401]);
      expect(
        (await userByEmail(email, '+refreshTokenHash')).refreshTokenHash,
      ).toBeNull();
    });

    it('the refresh cookie gives a new working session (ACC-06)', async () => {
      const user = await traveler(t);
      const res = await user.agent.post('/api/auth/refresh').expect(200);
      expect(Object.keys(cookiesOf(res)).sort()).toEqual([
        'access_token',
        'refresh_token',
      ]);
      const me = await user.agent.get('/api/auth/me').expect(200);
      expect(me.body.email).toBe(user.email);
    });

    it('a session idle for more than 30 minutes is over, for every request and for refresh (ACC-06)', async () => {
      const user = await traveler(t);
      const idle = (minutes: number) =>
        users().updateOne(
          { email: user.email },
          { $set: { lastActivityAt: new Date(Date.now() - minutes * MINUTE) } },
        );

      await idle(29);
      const stillActive = await user.agent.get('/api/auth/me');
      await idle(31);
      const expired = await user.agent.get('/api/auth/me');
      await idle(31);
      const refreshed = await user.agent.post('/api/auth/refresh');

      expect([stillActive.status, expired.status, refreshed.status]).toEqual([
        200, 401, 401,
      ]);
      expect(expired.body.message).toBe(
        'Session expired. Please log in again.',
      );
    });
  });

  // ---------------------------------------------------------------------
  describe('forgotten password', () => {
    // ACC-07 (bonus).
    const forgot = (email: string) =>
      t.http().post('/api/auth/forgot-password').send({ email });
    const reset = (token: string, newPassword = NEW_PASSWORD) =>
      t.http().post('/api/auth/reset-password').send({ token, newPassword });

    it('answers the same whether or not the email exists, and emails only a real account (ACC-07)', async () => {
      const { email } = await traveler(t);
      const unknown = testEmail('unknown');
      const before = t.outbox.messages.length;
      const known = await forgot(email);
      const missing = await forgot(unknown);
      expect([missing.status, missing.body]).toEqual([
        known.status,
        known.body,
      ]);
      expect(known.body.message).toBe(FORGOT_ANSWER);
      expect(t.outbox.messages.slice(before).map((m) => m.to)).toEqual([email]);
    });

    it('the link sets a new password once, and the old password stops working (ACC-07)', async () => {
      const { email } = await traveler(t);
      await forgot(email).expect(200);
      const token = t.outbox.token(email, 'reset-password');

      await reset(token).expect(200);
      const reused = await reset(token, 'An0therPassword');
      expect([reused.status, reused.body.message]).toEqual([
        400,
        INVALID_RESET_LINK,
      ]);
      expect((await loginWith(email, TEST_PASSWORD)).status).toBe(401);
      expect((await loginWith(email, NEW_PASSWORD)).status).toBe(200);
    });

    it('the link expires after 30 minutes (ACC-07)', async () => {
      const { email } = await traveler(t);
      await forgot(email).expect(200);
      const token = t.outbox.token(email, 'reset-password');
      const saved = await userByEmail(email, '+passwordResetExpiresAt');
      expect(
        Math.round(
          (saved.passwordResetExpiresAt.getTime() - Date.now()) / MINUTE,
        ),
      ).toBe(30);

      await users().updateOne(
        { email },
        { $set: { passwordResetExpiresAt: new Date(Date.now() - 1000) } },
      );
      const late = await reset(token);
      expect([late.status, late.body.message]).toEqual([
        400,
        INVALID_RESET_LINK,
      ]);
      expect((await loginWith(email, TEST_PASSWORD)).status).toBe(200);
    });

    it('a newer request makes the older link invalid (ACC-07)', async () => {
      const { email } = await traveler(t);
      await forgot(email).expect(200);
      const older = t.outbox.token(email, 'reset-password');
      await forgot(email).expect(200);
      const newer = t.outbox.token(email, 'reset-password');
      expect(newer).not.toBe(older);

      expect((await reset(older)).status).toBe(400);
      expect((await reset(newer)).status).toBe(200);
    });

    it('the new password must meet the rules, and a reset ends every open session (ACC-07, ACC-06)', async () => {
      const user = await traveler(t);
      await forgot(user.email).expect(200);
      const token = t.outbox.token(user.email, 'reset-password');

      const weak = await reset(token, 'short1');
      expect([weak.status, Object.keys(weak.body.details ?? {})]).toEqual([
        400,
        ['newPassword'],
      ]);

      await reset(token).expect(200);
      expect((await user.agent.get('/api/auth/me')).status).toBe(401);
    });
  });

  // ---------------------------------------------------------------------
  describe('change password and profile', () => {
    const change = (agent: any, currentPassword: string, newPassword: string) =>
      agent
        .patch('/api/auth/change-password')
        .send({ currentPassword, newPassword });

    it('changes the password only with the right current password and a valid new one (ACC-08)', async () => {
      const user = await traveler(t);
      const wrongCurrent = await change(
        user.agent,
        'Wr0ngPassword',
        NEW_PASSWORD,
      );
      const weakNew = await change(user.agent, TEST_PASSWORD, 'weakpassword');
      expect([wrongCurrent.status, wrongCurrent.body.message]).toEqual([
        400,
        'Current password is incorrect',
      ]);
      expect([weakNew.status, Object.keys(weakNew.body.details ?? {})]).toEqual(
        [400, ['newPassword']],
      );
      expect((await loginWith(user.email, TEST_PASSWORD)).status).toBe(200);
    });

    it('after a change only the new password works; this session continues and the others end (ACC-08)', async () => {
      const user = await traveler(t);
      const otherDevice = await login(t, user.email, TEST_PASSWORD);

      await change(user.agent, TEST_PASSWORD, NEW_PASSWORD).expect(200);

      const sessions = [
        (await user.agent.get('/api/auth/me')).status,
        (await otherDevice.agent.get('/api/auth/me')).status,
      ];
      expect(sessions).toEqual([200, 401]);
      expect((await loginWith(user.email, TEST_PASSWORD)).status).toBe(401);
      expect((await loginWith(user.email, NEW_PASSWORD)).status).toBe(200);
    });

    it('edits name, phone and preferred currency, saving nothing if any field is invalid (ACC-09)', async () => {
      const user = await traveler(t);
      const edit = {
        name: 'TEST Sara Edited',
        phone: '+20 100 123 4567',
        preferredCurrency: 'EGP',
      };
      const res = await user.agent
        .patch('/api/users/me')
        .send(edit)
        .expect(200);
      expect({
        name: res.body.name,
        phone: res.body.phone,
        currency: res.body.preferredCurrency,
      }).toEqual({
        name: edit.name,
        phone: edit.phone,
        currency: 'EGP',
      });

      const before = await userByEmail(user.email);
      const invalid: [string, Record<string, unknown>, string][] = [
        ['bad phone', { name: 'TEST Not Saved', phone: 'call me' }, 'phone'],
        [
          'unsupported currency',
          { name: 'TEST Not Saved', preferredCurrency: 'XYZ' },
          'preferredCurrency',
        ],
        ['empty name', { name: '', phone: '+20 100 000 0000' }, 'name'],
      ];
      const answers: string[] = [];
      for (const [name, body, field] of invalid) {
        const r = await user.agent.patch('/api/users/me').send(body);
        answers.push(
          `${name}: ${r.status} ${r.body.details?.[field] ? field : '(no error on the field)'}`,
        );
      }
      expect(answers).toEqual(
        invalid.map(([name, , field]) => `${name}: 400 ${field}`),
      );
      const after = await userByEmail(user.email);
      expect([after.name, after.phone, after.preferredCurrency]).toEqual([
        before.name,
        before.phone,
        before.preferredCurrency,
      ]);
    });
  });

  // ---------------------------------------------------------------------
  describe('tokens live only in httpOnly cookies', () => {
    it('both cookies are HttpOnly and SameSite=Lax, and no token is in any response body (ACC-19)', async () => {
      const { email } = await traveler(t);
      const res = await loginWith(email, TEST_PASSWORD).expect(200);
      const cookies = cookiesOf(res);
      const flags = (c: string) =>
        [
          /;\s*HttpOnly/i.test(c) ? 'HttpOnly' : '',
          /;\s*SameSite=Lax/i.test(c) ? 'Lax' : '',
        ]
          .filter(Boolean)
          .join(' ');
      expect({
        access: flags(cookies.access_token),
        refresh: flags(cookies.refresh_token),
      }).toEqual({
        access: 'HttpOnly Lax',
        refresh: 'HttpOnly Lax',
      });

      // The token values never appear in a body: login, refresh or /me.
      const tokens = [
        valueOf(cookies.access_token),
        valueOf(cookies.refresh_token),
      ];
      const cookie = tokens
        .map((v, i) => `${i ? 'refresh' : 'access'}_token=${v}`)
        .join('; ');
      const me = await t
        .http()
        .get('/api/auth/me')
        .set('Cookie', cookie)
        .expect(200);
      const renewed = await t
        .http()
        .post('/api/auth/refresh')
        .set('Cookie', cookie)
        .expect(200);
      const bodies = JSON.stringify([res.body, me.body, renewed.body]);
      expect(tokens.filter((v) => v && bodies.includes(v))).toEqual([]);
    });

    it('cookies are Secure unless COOKIE_SECURE=false, as in production (ACC-19)', async () => {
      // The e2e run sets COOKIE_SECURE=false because supertest speaks plain
      // http; here the setting is taken away, as in production.
      const config = t.app.get(ConfigService);
      const realGet = config.get.bind(config);
      const spy = jest
        .spyOn(config, 'get')
        .mockImplementation(((key: string) =>
          key === 'COOKIE_SECURE' ? undefined : realGet(key)) as any);
      try {
        const { email } = await traveler(t);
        const res = await loginWith(email, TEST_PASSWORD).expect(200);
        const cookies = cookiesOf(res);
        expect({
          access: /;\s*Secure/i.test(cookies.access_token),
          refresh: /;\s*Secure/i.test(cookies.refresh_token),
        }).toEqual({ access: true, refresh: true });
      } finally {
        spy.mockRestore();
      }
    });

    it('the client gets the current user from /api/auth/me, and only with a session (ACC-19)', async () => {
      const user = await traveler(t);
      const me = await user.agent.get('/api/auth/me').expect(200);
      expect({
        id: me.body.id,
        email: me.body.email,
        role: me.body.role,
      }).toEqual({
        id: user.id,
        email: user.email,
        role: 'user',
      });
      await t.http().get('/api/auth/me').expect(401);
    });
  });
});
