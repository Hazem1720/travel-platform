import { INestApplication } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { buildSwaggerDocument, configureApp } from '../src/app.setup';
import { User } from '../src/users/schemas/user.schema';

// Same pipeline as main.ts: /api prefix, cookies, validation pipe, error filter.
async function createApp(fakeDatabase: boolean): Promise<INestApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (fakeDatabase) {
    builder = builder
      .overrideProvider(getConnectionToken())
      .useValue({ models: {}, model: () => ({}), close: async () => undefined });
  }
  const app = (await builder.compile()).createNestApplication({ logger: false });
  configureApp(app);
  await app.init();
  return app;
}

const cookiesOf = (res: request.Response): string[] => {
  const raw = res.headers['set-cookie'] as unknown;
  return Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
};

describe('HTTP pipeline (no database)', () => {
  let app: INestApplication;
  let doc: OpenAPIObject;

  beforeAll(async () => {
    app = await createApp(true);
    doc = buildSwaggerDocument(app);
  });
  afterAll(async () => app?.close());

  it('serves the health check under /api', async () => {
    await request(app.getHttpServer()).get('/api').expect(200).expect('Hello World!');
    await request(app.getHttpServer()).get('/').expect(404);
  });

  it('answers protected routes with 401 in the shared error format (GEN-13)', async () => {
    const res = await request(app.getHttpServer()).get('/api/users/me').expect(401);
    expect(res.body).toEqual({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Authentication required',
      path: '/api/users/me',
      timestamp: expect.any(String),
    });
  });

  it('returns field-keyed validation errors (GEN-02)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ name: '  ', email: 'not-an-email', password: 'short', acceptTerms: false })
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
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        name: 'Sara',
        email: 'sara@example.com',
        password: 'Passw0rd1',
        acceptTerms: true,
        role: 'admin',
      })
      .expect(400);
    expect(res.body.details.role).toBeDefined();
  });

  it('logout always clears both cookies', async () => {
    const res = await request(app.getHttpServer()).post('/api/auth/logout').expect(200);
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
        .filter(({ op }) => !Object.keys(op.responses).some((s) => s.startsWith('2')))
        .map(({ key }) => key);
      expect(missing).toEqual([]);
    });

    it('documents a 401 example on every protected route', () => {
      const missing = operations()
        .filter(({ op }) => (op.security ?? []).some((s: object) => 'access_token' in s))
        .filter(({ key }) => key !== 'POST /api/auth/logout')
        .filter(({ op }) => !op.responses['401']?.content?.['application/json']?.schema?.example)
        .map(({ key }) => key);
      expect(missing).toEqual([]);
    });
  });
});

// Full flow against a real database. Set E2E_MONGODB_URI to a throwaway
// database to run it, e.g. a local mongod or a separate Atlas database.
const withDatabase = process.env.E2E_MONGODB_URI ? describe : describe.skip;

withDatabase('auth flow (database: E2E_MONGODB_URI)', () => {
  let app: INestApplication;
  const email = `e2e-${Date.now()}@example.com`;

  beforeAll(async () => {
    app = await createApp(false);
  });
  afterAll(async () => {
    await app?.get(getModelToken(User.name)).deleteOne({ email });
    await app?.close();
  });

  it('registers, logs in, reads the session and revokes it on logout (ACC-01, ACC-04, ACC-06)', async () => {
    const http = request(app.getHttpServer());
    await http
      .post('/api/auth/register')
      .send({ name: 'E2E User', email, password: 'Passw0rd1', acceptTerms: true })
      .expect(201);

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: 'Passw0rd1' })
      .expect(200);
    const cookies = cookiesOf(login);
    expect(cookies.join(';')).toMatch(/access_token=.+HttpOnly/i);

    const sessionCookie = cookies.map((c) => c.split(';')[0]).join('; ');
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', sessionCookie)
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Cookie', sessionCookie)
      .expect(200);

    // The old access token no longer works, even though it has not expired.
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', sessionCookie)
      .expect(401);
  });
});
