import { OpenAPIObject } from '@nestjs/swagger';
import * as request from 'supertest';
import { buildSwaggerDocument } from '../../src/app.setup';
import { User } from '../../src/users/schemas/user.schema';
import { createTestApp, TestApp } from './app';
import { testEmail } from './actors';

// Moved from test/app.e2e-spec.ts onto the harness. The checks are the same;
// they now run on the real database instead of a fake connection.

const cookiesOf = (res: request.Response): string[] => {
  const raw = res.headers['set-cookie'] as unknown;
  return Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
};

describe('HTTP pipeline', () => {
  let t: TestApp;
  let doc: OpenAPIObject;

  beforeAll(async () => {
    t = await createTestApp('app-pipeline');
    doc = buildSwaggerDocument(t.app);
  });
  afterAll(async () => t?.close());

  it('serves the health check under /api', async () => {
    await t.http().get('/api').expect(200).expect('Hello World!');
    await t.http().get('/').expect(404);
  });

  it('answers protected routes with 401 in the shared error format (GEN-13)', async () => {
    const res = await t.http().get('/api/users/me').expect(401);
    expect(res.body).toEqual({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Authentication required',
      path: '/api/users/me',
      timestamp: expect.any(String),
    });
  });

  it('returns field-keyed validation errors (GEN-02)', async () => {
    const res = await t
      .http()
      .post('/api/auth/register')
      .send({
        name: '  ',
        email: 'not-an-email',
        password: 'short',
        acceptTerms: false,
      })
      .expect(400);
    expect(res.body.message).toBe('Validation failed');
    expect(Object.keys(res.body.details).sort()).toEqual([
      'acceptTerms',
      'email',
      'name',
      'password',
    ]);
  });

  it('rejects unknown body fields such as a self-assigned role', async () => {
    const res = await t
      .http()
      .post('/api/auth/register')
      .send({
        name: 'TEST Sara',
        email: testEmail('role'),
        password: 'Passw0rd1',
        acceptTerms: true,
        role: 'admin',
      })
      .expect(400);
    expect(res.body.details.role).toBeDefined();
  });

  it('logout always clears both cookies', async () => {
    const res = await t.http().post('/api/auth/logout').expect(200);
    const cookies = cookiesOf(res).join(';');
    expect(cookies).toMatch(/access_token=;/);
    expect(cookies).toMatch(/refresh_token=;/);
  });

  describe('Swagger (IM-12)', () => {
    const operations = () =>
      Object.entries(doc.paths).flatMap(([path, item]) =>
        Object.entries(item as Record<string, any>).map(([method, op]) => ({
          key: `${method.toUpperCase()} ${path}`,
          op,
        })),
      );

    it('declares both cookie security schemes used by the routes', () => {
      expect(doc.components?.securitySchemes).toMatchObject({
        access_token: { type: 'apiKey', in: 'cookie', name: 'access_token' },
        refresh_token: { type: 'apiKey', in: 'cookie', name: 'refresh_token' },
      });
      const used = operations().flatMap(({ op }) =>
        (op.security ?? []).flatMap((s: object) => Object.keys(s)),
      );
      for (const name of used) {
        expect(doc.components?.securitySchemes).toHaveProperty(name);
      }
    });

    it('documents a success response on every route', () => {
      const missing = operations()
        .filter(
          ({ op }) => !Object.keys(op.responses).some((s) => s.startsWith('2')),
        )
        .map(({ key }) => key);
      expect(missing).toEqual([]);
    });

    it('documents a 401 example on every protected route', () => {
      const missing = operations()
        .filter(({ op }) =>
          (op.security ?? []).some((s: object) => 'access_token' in s),
        )
        .filter(({ key }) => key !== 'POST /api/auth/logout')
        .filter(
          ({ op }) =>
            !op.responses['401']?.content?.['application/json']?.schema
              ?.example,
        )
        .map(({ key }) => key);
      expect(missing).toEqual([]);
    });
  });
});

describe('auth flow', () => {
  let t: TestApp;
  const email = testEmail('flow');

  beforeAll(async () => {
    t = await createTestApp('app-auth-flow');
  });
  afterAll(async () => t?.close());

  // One test: each step needs the one before it (random order, plan 1).
  it('registers, logs in, reads the session and revokes it on logout (ACC-01, ACC-04, ACC-06)', async () => {
    await t
      .http()
      .post('/api/auth/register')
      .send({
        name: 'TEST E2E User',
        email,
        password: 'Passw0rd1',
        acceptTerms: true,
      })
      .expect(201);
    expect(await t.model(User.name).countDocuments({ email })).toBe(1);

    const login = await t
      .http()
      .post('/api/auth/login')
      .send({ email, password: 'Passw0rd1' })
      .expect(200);
    const cookies = cookiesOf(login);
    expect(cookies.join(';')).toMatch(/access_token=.+HttpOnly/i);

    const sessionCookie = cookies.map((c) => c.split(';')[0]).join('; ');
    await t.http().get('/api/auth/me').set('Cookie', sessionCookie).expect(200);

    await t
      .http()
      .post('/api/auth/logout')
      .set('Cookie', sessionCookie)
      .expect(200);

    // The old access token no longer works, even though it has not expired.
    await t.http().get('/api/auth/me').set('Cookie', sessionCookie).expect(401);
  });
});
