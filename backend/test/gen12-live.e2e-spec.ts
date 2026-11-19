// TEMPORARY (test branch only, never merged): GEN-12 seeding and the reference
// lists, and GEN-13 checks, over HTTP with a real MongoDB.
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { ReferenceSeedService } from '../src/reference/reference-seed.service';
import { User } from '../src/users/schemas/user.schema';

const withDatabase = process.env.E2E_MONGODB_URI ? describe : describe.skip;

withDatabase('GEN-12 / GEN-13 live check', () => {
  let app: INestApplication;
  let server: any;
  let db: any;
  const log: string[] = [];
  const ok = (s: string) => log.push('ok  ' + s);

  beforeAll(async () => {
    const ref = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = ref.createNestApplication({ logger: ['error'] });
    configureApp(app);
    await app.init();
    server = app.getHttpServer();
    db = app.get(getModelToken(User.name)).db;
    await db.dropDatabase();
  }, 60_000);

  afterAll(async () => {
    console.log(`\nGEN-12/13 LIVE CHECKS (${log.length}):\n` + log.join('\n'));
    await app?.close();
  });

  it('seeds an empty database at start-up, idempotently', async () => {
    process.env.NODE_ENV = 'development';
    await app.get(ReferenceSeedService).onApplicationBootstrap();
    process.env.NODE_ENV = 'test';
    const counts = async () =>
      Promise.all(
        ['countries', 'cities', 'airports', 'attractions', 'currencies'].map(
          (c) => db.collection(c).countDocuments(),
        ),
      );
    expect(await counts()).toEqual([8, 8, 8, 8, 7]);
    await app.get(ReferenceSeedService).seed();
    expect(await counts()).toEqual([8, 8, 8, 8, 7]);
    const fra = await db.collection('airports').findOne({ _id: 'FRA' });
    expect(fra.timeZone).toBe('Europe/Berlin');
    ok(
      'start-up seed fills 8 countries, cities, airports, attractions and 7 currencies; a second run adds nothing',
    );
  });

  it('lists reference data publicly', async () => {
    const c = await request(server).get('/api/reference/countries').expect(200);
    expect(c.body.meta.total).toBe(8);
    expect(c.body.data[0]).toEqual({
      _id: 'EG',
      name: 'Egypt',
      currency: 'EGP',
    });
    const cities = await request(server)
      .get('/api/reference/cities?country=de')
      .expect(200);
    expect(cities.body.data.map((x: any) => x._id)).toEqual(['frankfurt']);
    await request(server)
      .get('/api/reference/cities?country=Germany')
      .expect(400);
    const att = await request(server)
      .get('/api/reference/attractions?city=cairo')
      .expect(200);
    expect(att.body.data[0]._id).toBe('att-1');
    const cur = await request(server)
      .get('/api/reference/currencies')
      .expect(200);
    expect(cur.body.data.find((x: any) => x._id === 'EUR').countries).toEqual([
      'DE',
      'FR',
    ]);
    await request(server).get('/api/reference/currencies?limit=50').expect(400);
    const ap = await request(server).get('/api/airports').expect(200);
    expect(ap.body.meta.total).toBe(8);
    ok(
      'countries, cities?country, attractions?city, currencies and airports; bad query 400',
    );
  });

  it('GEN-13 over HTTP: unknown fields, hashes, guards', async () => {
    const reg = await request(server)
      .post('/api/auth/register')
      .send({
        name: 'G',
        email: 'g13@x.test',
        password: 'Passw0rd1',
        acceptTerms: true,
        role: 'admin',
      })
      .expect(400);
    expect(reg.body.details.role).toBeDefined();
    await request(server)
      .post('/api/auth/register')
      .send({
        name: 'G',
        email: 'g13@x.test',
        password: 'Passw0rd1',
        acceptTerms: true,
      })
      .expect(201);
    const raw = await db.collection('users').findOne({ email: 'g13@x.test' });
    expect(raw.passwordHash).toMatch(/^\$2[aby]\$10\$/);
    expect(JSON.stringify(raw)).not.toContain('Passw0rd1');
    const agent = request.agent(server);
    const login = await agent
      .post('/api/auth/login')
      .send({ email: 'g13@x.test', password: 'Passw0rd1' })
      .expect(200);
    expect(JSON.stringify(login.body)).not.toContain('$2');
    const me = await agent.get('/api/auth/me').expect(200);
    expect(JSON.stringify(me.body)).not.toMatch(
      /passwordHash|refreshTokenHash/,
    );
    await agent
      .post('/api/airlines')
      .send({ name: 'X', code: 'XX' })
      .expect(403);
    await request(server).get('/api/users/me').expect(401);
    ok(
      'self-assigned role 400; password stored as bcrypt hash, never returned; user cannot do admin work (403); no session 401',
    );
  });
});
