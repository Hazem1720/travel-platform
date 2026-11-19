// TEMPORARY (test branch only): routes renamed to match the project
// description: ACC-15, ACC-07a, PAY-01.
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { Model, Types } from 'mongoose';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { User } from '../src/users/schemas/user.schema';

const withDatabase = process.env.E2E_MONGODB_URI ? describe : describe.skip;
const Y = new Date().getUTCFullYear() + 1;

withDatabase('M1 endpoint names live check', () => {
  let app: INestApplication;
  let server: any;
  let users: Model<any>;
  let db: any;
  const log: string[] = [];
  const ok = (s: string) => log.push('ok  ' + s);
  const login = async (email: string, password: string) => {
    const a = request.agent(server);
    await a.post('/api/auth/login').send({ email, password }).expect(200);
    return a;
  };

  beforeAll(async () => {
    const ref = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = ref.createNestApplication({ logger: ['error'] });
    configureApp(app);
    await app.init();
    server = app.getHttpServer();
    users = app.get(getModelToken(User.name));
    db = users.db;
    await users.create({
      name: 'TEST Admin',
      email: 'admin@m1.test',
      passwordHash: await bcrypt.hash('Admin12345', 10),
      role: 'admin',
      acceptedTermsAt: new Date(),
    });
  }, 60_000);

  afterAll(async () => {
    console.log(`\nM1 LIVE CHECKS (${log.length}):\n` + log.join('\n'));
    await app?.close();
  });

  it('ACC-15 and ACC-07a', async () => {
    const admin = await login('admin@m1.test', 'Admin12345');
    const airline = (
      await admin
        .post('/api/airlines')
        .send({ name: 'TEST M1 Air', code: 'M1' })
        .expect(201)
    ).body._id;
    await admin
      .post('/api/admin/moderators')
      .send({
        name: 'TEST Mod',
        email: 'mod@m1.test',
        role: 'airline_moderator',
        providerId: airline,
        temporaryPassword: 'Temp12345',
      })
      .expect(201);
    const mod = await login('mod@m1.test', 'Temp12345');
    await mod
      .patch('/api/auth/change-password')
      .send({ currentPassword: 'Temp12345', newPassword: 'NewPass123' })
      .expect(200);
    const f = (
      await mod
        .post('/api/flights')
        .send({
          flightNumber: 'M1100',
          from: 'CAI',
          to: 'DXB',
          departureLocal: `${Y}-12-01T14:30`,
          arrivalLocal: `${Y}-12-01T18:45`,
        })
        .expect(201)
    ).body._id;
    await mod
      .post(`/api/flights/${f}/cabins`)
      .send({
        category: 'Economy',
        totalSeats: 5,
        price: 25000,
        freeBags: 1,
        maxKgPerBag: 23,
      })
      .expect(201);
    const search = () =>
      request(server).get(
        `/api/flights/search?from=CAI&to=DXB&date=${Y}-12-01`,
      );
    expect((await search().expect(200)).body.meta.total).toBe(1);

    const off = await admin
      .patch(`/api/admin/providers/airline/${airline}/deactivate`)
      .send({ reason: 'audit' })
      .expect(200);
    expect(off.body).toMatchObject({ isActive: false, notified: 1 });
    expect((await search().expect(200)).body.meta.total).toBe(0);
    await admin
      .patch(`/api/admin/providers/airline/${airline}/deactivate`)
      .send({})
      .expect(409);
    await admin
      .patch(`/api/admin/providers/airlines/${airline}/deactivate`)
      .send({})
      .expect(400);
    await mod
      .patch(`/api/admin/providers/airline/${airline}/reactivate`)
      .send({})
      .expect(403);
    const notes = (await mod.get('/api/notifications').expect(200)).body;
    expect(JSON.stringify(notes)).toContain('deactivated');
    await admin
      .patch(`/api/admin/providers/airline/${airline}/reactivate`)
      .send({})
      .expect(200);
    expect((await search().expect(200)).body.meta.total).toBe(1);
    await admin
      .patch(`/api/admin/airlines/${airline}/deactivate`)
      .send({})
      .expect(404);
    await admin
      .patch(`/api/admin/providers/hotel/${new Types.ObjectId()}/deactivate`)
      .send({})
      .expect(404);
    ok(
      'PATCH /admin/providers/airline/:id/deactivate hides its flights from search, notifies the moderator; reactivate restores; twice 409; bad type 400; non-admin 403; old path gone (404)',
    );

    const modId = String(
      (await users.findOne({ email: 'mod@m1.test' }).lean<any>())._id,
    );
    await admin
      .post(`/api/admin/users/${modId}/reset-password`)
      .send({ temporaryPassword: 'Reset12345' })
      .expect(200);
    await admin
      .post(`/api/admin/accounts/${modId}/reset-password`)
      .send({ temporaryPassword: 'Reset12345' })
      .expect(404);
    await login('mod@m1.test', 'Reset12345');
    ok(
      'POST /admin/users/:id/reset-password sets a temporary password; old /admin/accounts path gone',
    );
  });

  it('PAY-01: /payments routes', async () => {
    await request(server)
      .post('/api/auth/register')
      .send({
        name: 'TEST U',
        email: 'u@m1.test',
        password: 'User12345',
        acceptTerms: true,
      })
      .expect(201);
    await request(server)
      .post('/api/auth/register')
      .send({
        name: 'TEST V',
        email: 'v@m1.test',
        password: 'User12345',
        acceptTerms: true,
      })
      .expect(201);
    const u = await login('u@m1.test', 'User12345');
    const v = await login('v@m1.test', 'User12345');
    const uid = (await users.findOne({ email: 'u@m1.test' }).lean<any>())._id;
    await users.updateMany({ email: /@m1\.test$/ }, { $set: { emailVerified: true } });
    const ins = async (status: string) =>
      String(
        (
          await db
            .collection('payments')
            .insertOne({
              bookingType: 'flight',
              bookingId: new Types.ObjectId(),
              userId: uid,
              stripePaymentIntentId: 'pi_' + status + Math.random(),
              amount: 1000,
              currency: 'USD',
              status,
              createdAt: new Date(),
              updatedAt: new Date(),
            })
        ).insertedId,
      );
    const failed = await ins('Failed');
    const paid = await ins('Succeeded');
    const got = (await u.get(`/api/payments/${failed}`).expect(200)).body;
    expect(got).toMatchObject({
      status: 'Failed',
      amount: 1000,
      bookingType: 'flight',
    });
    expect(JSON.stringify(got)).not.toContain('pi_');
    await v.get(`/api/payments/${failed}`).expect(404);
    await u.post(`/api/payments/${paid}/retry`).expect(409);
    const r = await u.post(`/api/payments/${failed}/retry`);
    expect([404, 503]).toContain(r.status); // no booking behind it / no Stripe key in CI
    await u
      .post('/api/payments')
      .send({ bookingType: 'boat', bookingId: 'x' })
      .expect(400);
    const p = await u
      .post('/api/payments')
      .send({ bookingType: 'flight', bookingId: String(new Types.ObjectId()) });
    expect([404, 503]).toContain(p.status);
    await request(server).get(`/api/payments/${failed}`).expect(401);
    log.push(
      `info retry without a booking -> ${r.status}; POST /payments unknown booking -> ${p.status}`,
    );
    ok(
      "GET /payments/:id (mine, no Stripe ids; another user's 404; no session 401); retry of a succeeded payment 409; POST /payments validates its body",
    );
  });
});
