// TEMPORARY (test branch only, never merged): Memo's bonus items over HTTP,
// with a real MongoDB and a real SMTP test inbox (Mailpit): GEN-01-B,
// ITN-28, BLG-13, FLT-28, ITN-27, ACC-02, ACC-07.
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { Model, Types } from 'mongoose';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { User } from '../src/users/schemas/user.schema';

const withDatabase =
  process.env.E2E_MONGODB_URI && process.env.MAILPIT_API
    ? describe
    : describe.skip;
const Y = new Date().getUTCFullYear() + 1;
const MAILPIT = process.env.MAILPIT_API as string;

async function mails(to: string): Promise<{ Subject: string; Text: string }[]> {
  const out: { Subject: string; Text: string }[] = [];
  const list = await (
    await fetch(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`,
    )
  ).json();
  for (const m of list.messages ?? []) {
    const full = await (
      await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)
    ).json();
    out.push({ Subject: full.Subject, Text: full.Text });
  }
  return out;
}
async function waitMail(to: string, subject: RegExp, count = 1) {
  for (let i = 0; i < 40; i++) {
    const found = (await mails(to)).filter((m) => subject.test(m.Subject));
    if (found.length >= count) return found;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no email "${subject}" to ${to}`);
}
const tokenIn = (text: string) => /token=([0-9a-f]{64})/.exec(text)![1];

withDatabase('BONUS live check', () => {
  let app: INestApplication;
  let server: any;
  let users: Model<any>;
  let db: any;
  let admin: any, mod: any, u: any, v: any;
  let flightId: string;
  const log: string[] = [];
  const ok = (s: string) => log.push('ok  ' + s);
  const login = async (email: string, password: string) => {
    const a = request.agent(server);
    await a.post('/api/auth/login').send({ email, password }).expect(200);
    return a;
  };
  const adult = (n: string) => ({
    type: 'adult',
    fullName: n,
    dateOfBirth: '1990-05-01',
    passportNumber: 'A1234567' + n.length,
  });
  const hold = (agent: any, passengers: object[]) =>
    agent
      .post('/api/flight-bookings/hold')
      .send({ outboundFlightId: flightId, cabin: 'Economy', passengers });

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
      email: 'admin@bonus.test',
      passwordHash: await bcrypt.hash('Admin12345', 10),
      role: 'admin',
      acceptedTermsAt: new Date(),
    });
    admin = await login('admin@bonus.test', 'Admin12345');
  }, 60_000);

  afterAll(async () => {
    console.log(`\nBONUS LIVE CHECKS (${log.length}):\n` + log.join('\n'));
    await app?.close();
  });

  it('GEN-01-B: moderator invitation and notification emails', async () => {
    const airline = (
      await admin
        .post('/api/airlines')
        .send({ name: 'TEST Bonus Air', code: 'BN' })
        .expect(201)
    ).body._id;
    await admin
      .post('/api/admin/moderators')
      .send({
        name: 'TEST Mod',
        email: 'mod@bonus.test',
        role: 'airline_moderator',
        providerId: airline,
        temporaryPassword: 'Temp12345',
      })
      .expect(201);
    const [invite] = await waitMail(
      'mod@bonus.test',
      /invited to manage an airline/,
    );
    expect(invite.Text).not.toContain('Temp12345');
    mod = await login('mod@bonus.test', 'Temp12345');
    await mod
      .patch('/api/auth/change-password')
      .send({ currentPassword: 'Temp12345', newPassword: 'NewPass123' })
      .expect(200);
    flightId = (
      await mod
        .post('/api/flights')
        .send({
          flightNumber: 'BN101',
          from: 'CAI',
          to: 'DXB',
          departureLocal: `${Y}-12-01T14:30`,
          arrivalLocal: `${Y}-12-01T18:45`,
        })
        .expect(201)
    ).body._id;
    await mod
      .post(`/api/flights/${flightId}/cabins`)
      .send({
        category: 'Economy',
        totalSeats: 12,
        price: 25000,
        freeBags: 1,
        maxKgPerBag: 23,
      })
      .expect(201);

    await request(server)
      .post('/api/auth/register')
      .send({
        name: 'TEST Sus',
        email: 'sus@bonus.test',
        password: 'User12345',
        acceptTerms: true,
      })
      .expect(201);
    const sus = await users.findOne({ email: 'sus@bonus.test' }).lean<any>();
    await admin
      .patch(`/api/admin/accounts/${sus._id}/suspend`)
      .send({ reason: 'test' })
      .expect(200);
    await waitMail('sus@bonus.test', /suspended/);
    ok(
      'moderator invitation emailed without the temporary password; a notification (account suspended) emailed too',
    );
  });

  it('ACC-02: verify the email before booking', async () => {
    const reg = await request(server)
      .post('/api/auth/register')
      .send({
        name: 'TEST Una',
        email: 'u@bonus.test',
        password: 'User12345',
        acceptTerms: true,
      })
      .expect(201);
    expect(reg.body.emailVerified).toBe(false);
    u = await login('u@bonus.test', 'User12345');
    const blocked = await hold(u, [adult('Una')]).expect(403);
    expect(blocked.body.message).toMatch(/Verify your email/);
    const [mail] = await waitMail('u@bonus.test', /Verify your email/);
    const token = tokenIn(mail.Text);
    await request(server)
      .get(`/api/auth/verify-email?token=${token}`)
      .expect(200);
    await request(server)
      .get(`/api/auth/verify-email?token=${token}`)
      .expect(400);
    await request(server).get('/api/auth/verify-email?token=abc').expect(400);
    expect((await u.get('/api/auth/me').expect(200)).body.emailVerified).toBe(
      true,
    );
    ok(
      'new account unverified; hold 403; emailed link verifies once (reuse 400); /auth/me shows it',
    );
  });

  let bookingU: string;
  it('FLT-28: seat selection with a real race', async () => {
    const b = await hold(u, [
      adult('Una'),
      adult('Omar'),
      {
        type: 'infant',
        fullName: 'Baby',
        dateOfBirth: `${Y}-03-01`,
        passportNumber: 'B7654321',
      },
    ]).expect(201);
    bookingU = b.body._id ?? b.body.bookingId;
    const map = (
      await u.get(`/api/flight-bookings/${bookingU}/seats`).expect(200)
    ).body;
    expect(map[0].seats).toHaveLength(12);
    expect(map[0].seats[0].seat).toBe('1A');
    await u
      .patch(`/api/flight-bookings/${bookingU}/seat`)
      .send({ segment: 0, passengerIndex: 0, seat: '1a' })
      .expect(200);
    await u
      .patch(`/api/flight-bookings/${bookingU}/seat`)
      .send({ segment: 0, passengerIndex: 1, seat: '1A' })
      .expect(409);
    await u
      .patch(`/api/flight-bookings/${bookingU}/seat`)
      .send({ segment: 0, passengerIndex: 2, seat: '2A' })
      .expect(400);
    await u
      .patch(`/api/flight-bookings/${bookingU}/seat`)
      .send({ segment: 0, passengerIndex: 1, seat: '3A' })
      .expect(400);
    await u
      .patch(`/api/flight-bookings/${bookingU}/seat`)
      .send({ segment: 0, passengerIndex: 0, seat: '1B' })
      .expect(200);

    await request(server)
      .post('/api/auth/register')
      .send({
        name: 'TEST Vic',
        email: 'v@bonus.test',
        password: 'User12345',
        acceptTerms: true,
      })
      .expect(201);
    await users.updateOne(
      { email: 'v@bonus.test' },
      { $set: { emailVerified: true } },
    );
    v = await login('v@bonus.test', 'User12345');
    const bv = (await hold(v, [adult('Vic')]).expect(201)).body;
    const bookingV = bv._id ?? bv.bookingId;
    await v.get(`/api/flight-bookings/${bookingU}/seats`).expect(404);
    await v
      .patch(`/api/flight-bookings/${bookingU}/seat`)
      .send({ segment: 0, passengerIndex: 0, seat: '2B' })
      .expect(404);
    const race = await Promise.all([
      u
        .patch(`/api/flight-bookings/${bookingU}/seat`)
        .send({ segment: 0, passengerIndex: 1, seat: '2C' }),
      v
        .patch(`/api/flight-bookings/${bookingV}/seat`)
        .send({ segment: 0, passengerIndex: 0, seat: '2C' }),
    ]);
    expect(race.map((r) => r.status).sort()).toEqual([200, 409]);
    const after = (
      await v.get(`/api/flight-bookings/${bookingV}/seats`).expect(200)
    ).body[0].seats;
    expect(after.find((s: any) => s.seat === '1B').taken).toBe(true);
    expect(after.find((s: any) => s.seat === '1A').taken).toBe(false);
    await db
      .collection('flightbookings')
      .updateOne(
        { _id: new Types.ObjectId(bookingV) },
        { $set: { status: 'Expired' } },
      );
    await u
      .patch(`/api/flight-bookings/${bookingU}/seat`)
      .send({ segment: 0, passengerIndex: 1, seat: '2C' })
      .expect(200);
    ok(
      'seat map 12 seats; choose and change; taken 409; infant and bad seat 400; other user 404; simultaneous same seat 200 + 409; expired booking frees its seat',
    );
  });

  let itn: string;
  it('ITN-27: link bookings to days, feeding the budget', async () => {
    itn = (
      await u
        .post('/api/itineraries')
        .send({
          title: 'TEST Dubai',
          countries: ['AE'],
          startDate: `${Y}-12-01`,
        })
        .expect(201)
    ).body._id;
    const d1 = (
      await u
        .post(`/api/itineraries/${itn}/days`)
        .send({ cityId: 'dubai' })
        .expect(201)
    ).body;
    const dayId = String((d1.days ?? d1.itinerary?.days)[0]._id);
    await u
      .post(`/api/itineraries/${itn}/bookings`)
      .send({ type: 'flight', bookingId: bookingU, dayId })
      .expect(400);
    await db
      .collection('flightbookings')
      .updateOne(
        { _id: new Types.ObjectId(bookingU) },
        { $set: { status: 'Confirmed', reference: 'FL-TEST0001' } },
      );
    const total = (
      await db
        .collection('flightbookings')
        .findOne({ _id: new Types.ObjectId(bookingU) })
    ).totalAmount;
    const linked = (
      await u
        .post(`/api/itineraries/${itn}/bookings`)
        .send({ type: 'flight', bookingId: bookingU, dayId })
        .expect(201)
    ).body;
    expect(linked.linkedBookings[0]).toMatchObject({
      type: 'flight',
      reference: 'FL-TEST0001',
      dayNumber: 1,
      amount: total / 100,
      currency: 'USD',
    });
    expect(linked.budget.byCategory.intercity_transport).toEqual({
      USD: total / 100,
    });
    await u
      .post(`/api/itineraries/${itn}/bookings`)
      .send({ type: 'flight', bookingId: bookingU, dayId })
      .expect(409);
    await v
      .post(`/api/itineraries/${itn}/bookings`)
      .send({ type: 'flight', bookingId: bookingU, dayId })
      .expect(404);
    await u
      .post(`/api/itineraries/${itn}/bookings`)
      .send({ type: 'hotel', bookingId: bookingU, dayId })
      .expect(404);
    const budget = (await u.get(`/api/itineraries/${itn}/budget`)).body;
    log.push(
      `info GET /itineraries/:id/budget -> ${JSON.stringify(budget.total ?? budget).slice(0, 80)}`,
    );
    await u
      .patch(`/api/itineraries/${itn}`)
      .send({ visibility: 'Public' })
      .expect(200);
    const pub = (
      await request(server).get(`/api/itineraries/public/${itn}`).expect(200)
    ).body;
    expect(pub.linkedBookings).toEqual([]);
    expect(pub.budget.total).toEqual({});
    ok(
      'pending booking 400; confirmed flight linked to day 1 counts under intercity transport; twice 409; others 404; public view shows no linked bookings',
    );
  });

  it('#208: stored ownerId string is matched', async () => {
    const raw = await db
      .collection('itineraries')
      .findOne({ _id: new Types.ObjectId(itn) });
    const mine = (await u.get('/api/itineraries').expect(200)).body;
    log.push(
      `info itinerary ownerId stored as ${raw.ownerId?.constructor?.name}; GET /itineraries total=${mine.meta?.total}`,
    );
    expect(mine.meta.total).toBe(1);
    const page = (
      await request(server)
        .get(`/api/authors/${String(raw.ownerId)}`)
        .expect(200)
    ).body;
    expect(page.itineraries.meta.total).toBe(1);
    ok(
      'fix #208: GET /itineraries lists my itinerary; the author page lists my public itinerary',
    );
  });

  it('BLG-13: attach an itinerary to a post', async () => {
    const post = (
      await u
        .post('/api/posts')
        .send({ title: 'TEST trip', body: 'Dubai!', status: 'Published' })
        .expect(201)
    ).body._id;
    const priv = (
      await u
        .post('/api/itineraries')
        .send({
          title: 'TEST private',
          countries: ['EG'],
          startDate: `${Y}-12-01`,
        })
        .expect(201)
    ).body._id;
    await u
      .patch(`/api/posts/${post}/itinerary`)
      .send({ itineraryId: priv })
      .expect(400);
    const vItn = (
      await v
        .post('/api/itineraries')
        .send({ title: 'TEST v', countries: ['EG'], startDate: `${Y}-12-01` })
        .expect(201)
    ).body._id;
    await v
      .patch(`/api/itineraries/${vItn}`)
      .send({ visibility: 'Public' })
      .expect(200);
    await u
      .patch(`/api/posts/${post}/itinerary`)
      .send({ itineraryId: vItn })
      .expect(400);
    await u.patch(`/api/posts/${post}/itinerary`).send({}).expect(400);
    await v
      .patch(`/api/posts/${post}/itinerary`)
      .send({ itineraryId: vItn })
      .expect(404);
    await u
      .patch(`/api/posts/${post}/itinerary`)
      .send({ itineraryId: itn })
      .expect(200);
    const page = (await request(server).get(`/api/posts/${post}`).expect(200))
      .body;
    expect(page.itinerary).toMatchObject({ title: 'TEST Dubai', dayCount: 1 });
    await u
      .patch(`/api/itineraries/${itn}`)
      .send({ visibility: 'Private' })
      .expect(200);
    expect(
      (await request(server).get(`/api/posts/${post}`).expect(200)).body
        .itinerary,
    ).toBeNull();
    await u
      .patch(`/api/posts/${post}/itinerary`)
      .send({ itineraryId: null })
      .expect(200);
    ok(
      "own public itinerary attached and shown on the post; private, someone else's or missing 400; other user's post 404; made private later -> not shown; null detaches",
    );
  });

  it('ITN-28: itinerary PDF', async () => {
    const pdf = await u
      .get(`/api/itineraries/${itn}/pdf`)
      .buffer(true)
      .parse((res: any, cb: any) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toContain(
      'itinerary-test-dubai.pdf',
    );
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    await v.get(`/api/itineraries/${itn}/pdf`).expect(404);
    await request(server).get(`/api/itineraries/${itn}/pdf`).expect(401);
    ok('owner gets a real PDF download; another user 404; no session 401');
  });

  it('ACC-07: password reset by email', async () => {
    const a = await request(server)
      .post('/api/auth/forgot-password')
      .send({ email: 'U@bonus.test' })
      .expect(200);
    const b = await request(server)
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody@bonus.test' })
      .expect(200);
    expect(a.body).toEqual(b.body);
    const first = tokenIn(
      (await waitMail('u@bonus.test', /Reset your/))[0].Text,
    );
    await request(server)
      .post('/api/auth/forgot-password')
      .send({ email: 'u@bonus.test' })
      .expect(200);
    const all = await waitMail('u@bonus.test', /Reset your/, 2);
    const second = all.map((m) => tokenIn(m.Text)).find((t) => t !== first)!;
    expect((await mails('nobody@bonus.test')).length).toBe(0);
    await request(server)
      .post('/api/auth/reset-password')
      .send({ token: first, newPassword: 'Fresh12345' })
      .expect(400);
    await request(server)
      .post('/api/auth/reset-password')
      .send({ token: second, newPassword: 'weak' })
      .expect(400);
    await request(server)
      .post('/api/auth/reset-password')
      .send({ token: second, newPassword: 'Fresh12345' })
      .expect(200);
    await request(server)
      .post('/api/auth/reset-password')
      .send({ token: second, newPassword: 'Fresh12345' })
      .expect(400);
    await u.get('/api/auth/me').expect(401);
    await request(server)
      .post('/api/auth/login')
      .send({ email: 'u@bonus.test', password: 'User12345' })
      .expect(401);
    await login('u@bonus.test', 'Fresh12345');
    await db.collection('users').updateOne(
      { email: 'u@bonus.test' },
      {
        $set: { passwordResetExpiresAt: new Date(Date.now() - 31 * 60_000) },
      },
    );
    ok(
      'same answer for unknown email (and no email sent); older link after a newer one 400; weak password 400; reset once; old sessions signed out; old password refused, new one works',
    );
  });
});
