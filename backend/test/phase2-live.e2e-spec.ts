// TEMPORARY (integration test branch only, never merged): Hazem's phase 2
// routes over HTTP against a real MongoDB with the official reference data.
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { Model, Types } from 'mongoose';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { FlightStatusJob } from '../src/flights/flight-status.job';
import { Flight } from '../src/flights/schemas/flight.schema';
import { User } from '../src/users/schemas/user.schema';

const withDatabase = process.env.E2E_MONGODB_URI ? describe : describe.skip;
const Y = new Date().getUTCFullYear() + 1;
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64),
]);

withDatabase('phase 2 live (Hazem)', () => {
  let app: INestApplication;
  let server: any;
  let users: Model<any>;
  let flights: Model<any>;
  const log: string[] = [];
  const check = (name: string) => log.push(`ok  ${name}`);

  const agent = () => request.agent(server);
  async function login(email: string, password: string) {
    const a = agent();
    await a.post('/api/auth/login').send({ email, password }).expect(200);
    return a;
  }

  let admin: any;
  let airlineA: string;
  let airlineB: string;
  let hotelId: string;
  let modA: any;
  let modB: any;
  let modBId: string;
  let flightId: string;
  let cabinId: string;

  beforeAll(async () => {
    const ref = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = ref.createNestApplication({ logger: ['error'] });
    configureApp(app);
    await app.init();
    server = app.getHttpServer();
    users = app.get(getModelToken(User.name));
    flights = app.get(getModelToken(Flight.name));
    await users.create({
      name: 'TEST Admin',
      email: 'admin@test.local',
      passwordHash: await bcrypt.hash('Admin12345', 10),
      role: 'admin',
      acceptedTermsAt: new Date(),
    });
    admin = await login('admin@test.local', 'Admin12345');
  }, 60_000);

  afterAll(async () => {
    console.log(`\nPHASE 2 LIVE CHECKS (${log.length}):\n` + log.join('\n'));
    await app?.close();
  });

  it('FLT-01: admin creates airlines; a normal user cannot', async () => {
    const a = await admin.post('/api/airlines').send({ name: 'TEST Air A', code: 'ta' }).expect(201);
    expect(a.body.code).toBe('TA');
    airlineA = a.body._id;
    airlineB = (await admin.post('/api/airlines').send({ name: 'TEST Air B', code: 'TB' }).expect(201)).body._id;
    await admin.post('/api/airlines').send({ name: 'X', code: 'TA' }).expect(409);
    await agent().post('/api/auth/register').send({ name: 'TEST User', email: 'user@test.local', password: 'User12345', acceptTerms: true }).expect(201);
    const user = await login('user@test.local', 'User12345');
    await user.post('/api/airlines').send({ name: 'X', code: 'XX' }).expect(403);
    await agent().get(`/api/airlines/${airlineA}`).expect(200);
    check('FLT-01 create 201, duplicate 409, user 403, public GET 200');
  });

  it('ACC-13: moderator accounts', async () => {
    const res = await admin.post('/api/admin/moderators').send({
      name: 'TEST Mod A', email: 'moda@test.local', role: 'airline_moderator', providerId: airlineA, temporaryPassword: 'Temp12345',
    }).expect(201);
    expect(res.body).not.toHaveProperty('passwordHash');
    expect(res.body).toMatchObject({ mustChangePassword: true, assignedProviderId: airlineA });
    await admin.post('/api/admin/moderators').send({
      name: 'Dup', email: 'moda@test.local', role: 'airline_moderator', providerId: airlineA, temporaryPassword: 'Temp12345',
    }).expect(409);
    await admin.post('/api/admin/moderators').send({
      name: 'X', email: 'x@test.local', role: 'airline_moderator', providerId: new Types.ObjectId().toHexString(), temporaryPassword: 'Temp12345',
    }).expect(404);
    await admin.post('/api/admin/moderators').send({
      name: 'X', email: 'x2@test.local', role: 'admin', providerId: airlineA, temporaryPassword: 'Temp12345',
    }).expect(400);
    const user = await login('user@test.local', 'User12345');
    await user.post('/api/admin/moderators').send({}).expect(403);

    modA = await login('moda@test.local', 'Temp12345');
    await modA.patch(`/api/airlines/${airlineA}`).send({ name: 'TEST Air A2' }).expect(403);
    await modA.patch('/api/auth/change-password').send({ currentPassword: 'Temp12345', newPassword: 'NewPass123' }).expect(200);
    await modA.patch(`/api/airlines/${airlineA}`).send({ name: 'TEST Air A2' }).expect(200);
    await modA.patch(`/api/airlines/${airlineB}`).send({ name: 'nope' }).expect(403);

    modBId = (await admin.post('/api/admin/moderators').send({
      name: 'TEST Mod B', email: 'modb@test.local', role: 'airline_moderator', providerId: airlineB, temporaryPassword: 'Temp12345',
    }).expect(201)).body._id;
    modB = await login('modb@test.local', 'Temp12345');
    await modB.patch('/api/auth/change-password').send({ currentPassword: 'Temp12345', newPassword: 'NewPass123' }).expect(200);
    check('ACC-13 201 without password fields, 409, 404, 400, user 403, must-change 403 then 200, other airline 403');
  });

  it('FLT-03 + GEN-06: create flights', async () => {
    const body = { flightNumber: 'TA101', from: 'CAI', to: 'DXB', departureLocal: `${Y}-12-01T14:30`, arrivalLocal: `${Y}-12-01T18:45` };
    const res = await modA.post('/api/flights').send(body).expect(201);
    expect(res.body.departure).toMatchObject({ utc: `${Y}-12-01T12:30:00.000Z`, local: `${Y}-12-01T14:30`, timeZone: 'Africa/Cairo' });
    expect(res.body.arrival).toMatchObject({ utc: `${Y}-12-01T14:45:00.000Z`, local: `${Y}-12-01T18:45`, timeZone: 'Asia/Dubai' });
    expect(res.body.status).toBe('Scheduled');
    flightId = res.body._id;
    const stored = await flights.findById(flightId).lean<any>();
    expect(stored.departureAt.toISOString()).toBe(`${Y}-12-01T12:30:00.000Z`);
    expect(String(stored.airlineId)).toBe(airlineA);

    await modA.post('/api/flights').send(body).expect(409);
    await modA.post('/api/flights').send({ ...body, departureLocal: `${Y}-12-02T14:30`, arrivalLocal: `${Y}-12-02T18:45` }).expect(201);
    await modA.post('/api/flights').send({ ...body, to: 'CAI' }).expect(400);
    await modA.post('/api/flights').send({ ...body, flightNumber: 'TA102', departureLocal: `${Y}-12-01T15:00`, arrivalLocal: `${Y}-12-01T16:30` }).expect(400);
    await modA.post('/api/flights').send({ ...body, flightNumber: 'TA103', departureLocal: '2020-01-01T10:00', arrivalLocal: '2020-01-01T14:00' }).expect(400);
    await modA.post('/api/flights').send({ ...body, flightNumber: 'TA104', to: 'XXX' }).expect(400);
    await modA.post('/api/flights').send({ ...body, airlineId: airlineB }).expect(400);

    const fra = await modA.post('/api/flights').send({ flightNumber: 'TA200', from: 'CAI', to: 'FRA', departureLocal: `${Y}-07-01T08:00`, arrivalLocal: `${Y}-07-01T11:30` }).expect(201);
    expect(fra.body.departure.timeZone).toBe('Africa/Cairo');
    expect(fra.body.arrival).toMatchObject({ timeZone: 'Europe/Berlin', local: `${Y}-07-01T11:30`, utcOffset: '+02:00' });

    // A hotel moderator cannot create flights.
    hotelId = (await admin.post('/api/hotels').send({ name: 'TEST Hotel', address: '1 Test St', cityId: 'cairo', countryCode: 'EG', starClass: 4 }).expect(201)).body._id;
    await admin.post('/api/admin/moderators').send({ name: 'TEST Hotel Mod', email: 'hmod@test.local', role: 'hotel_moderator', providerId: hotelId, temporaryPassword: 'Temp12345' }).expect(201);
    const hmod = await login('hmod@test.local', 'Temp12345');
    await hmod.patch('/api/auth/change-password').send({ currentPassword: 'Temp12345', newPassword: 'NewPass123' }).expect(200);
    await hmod.post('/api/flights').send(body).expect(403);
    await admin.post('/api/admin/moderators').send({ name: 'X', email: 'x3@test.local', role: 'airline_moderator', providerId: hotelId, temporaryPassword: 'Temp12345' }).expect(404);
    check('FLT-03 201 with UTC stored, 409 same day, 201 next day, 400 x5 (same airport, UTC order, past, XXX, airlineId in body), hotel mod 403; GEN-06 CAI/DXB/FRA zones');
  });

  it('FLT-04: cabins', async () => {
    const eco = { category: 'Economy', totalSeats: 20, price: 25000, freeBags: 1, maxKgPerBag: 23 };
    const res = await modA.post(`/api/flights/${flightId}/cabins`).send(eco).expect(201);
    expect(res.body.cabins[0]).toMatchObject({ category: 'Economy', bookedSeats: 0, heldSeats: 0, availableSeats: 20 });
    cabinId = res.body.cabins[0]._id;
    await modA.post(`/api/flights/${flightId}/cabins`).send(eco).expect(409);
    await modA.post(`/api/flights/${flightId}/cabins`).send({ ...eco, category: 'Luxury' }).expect(400);
    await modA.post(`/api/flights/${flightId}/cabins`).send({ ...eco, category: 'Business', totalSeats: 0 }).expect(400);
    await modA.post(`/api/flights/${flightId}/cabins`).send({ ...eco, category: 'Business', totalSeats: 2.5 }).expect(400);
    await modA.post(`/api/flights/${flightId}/cabins`).send({ ...eco, category: 'Business', price: 0 }).expect(400);
    await modA.post(`/api/flights/${flightId}/cabins`).send({ ...eco, category: 'Business', bookedSeats: 5 }).expect(400);
    await modB.post(`/api/flights/${flightId}/cabins`).send({ ...eco, category: 'First' }).expect(403);
    await modA.post(`/api/flights/${new Types.ObjectId()}/cabins`).send(eco).expect(404);
    await modA.post(`/api/flights/${flightId}/cabins`).send({ ...eco, category: 'Premium Economy' }).expect(201);
    const list = await modA.get(`/api/airlines/${airlineA}/flights`).expect(200);
    expect(list.body.meta.total).toBe(3);
    await modB.get(`/api/airlines/${airlineA}/flights`).expect(403);
    check('FLT-04 201, dup 409, Luxury/0/2.5/price0/bookedSeats 400, other airline 403, unknown 404; airline flight list 200/403');
  });

  it('FLT-05: edits', async () => {
    await modA.patch(`/api/flights/${flightId}/cabins/${cabinId}`).send({ price: 27000 }).expect(200);
    await flights.updateOne({ _id: flightId, 'cabins._id': cabinId }, { $set: { 'cabins.$.bookedSeats': 5, 'cabins.$.heldSeats': 3 } });
    await modA.patch(`/api/flights/${flightId}/cabins/${cabinId}`).send({ totalSeats: 7 }).expect(409);
    const ok = await modA.patch(`/api/flights/${flightId}/cabins/${cabinId}`).send({ totalSeats: 8 }).expect(200);
    expect(ok.body.cabins.find((c: any) => c._id === cabinId)).toMatchObject({ totalSeats: 8, availableSeats: 0, price: 27000 });
    await modA.patch(`/api/flights/${flightId}`).send({ to: 'FRA' }).expect(400);
    const moved = await modA.patch(`/api/flights/${flightId}`).send({ departureLocal: `${Y}-12-01T16:00`, arrivalLocal: `${Y}-12-01T20:15` }).expect(200);
    expect(moved.body.departure.utc).toBe(`${Y}-12-01T14:00:00.000Z`);
    await modA.patch(`/api/flights/${flightId}`).send({}).expect(400);
    await modB.patch(`/api/flights/${flightId}`).send({ departureLocal: `${Y}-12-01T17:00` }).expect(403);
    await modA.patch(`/api/flights/${flightId}/cabins/${new Types.ObjectId()}`).send({ price: 1 }).expect(404);
    await flights.updateOne({ _id: flightId }, { $set: { status: 'Cancelled' } });
    await modA.patch(`/api/flights/${flightId}`).send({ departureLocal: `${Y}-12-01T17:00` }).expect(400);
    await modA.patch(`/api/flights/${flightId}/cabins/${cabinId}`).send({ price: 1 }).expect(400);
    await modA.post(`/api/flights/${flightId}/cabins`).send({ category: 'First', totalSeats: 2, price: 1, freeBags: 0, maxKgPerBag: 20 }).expect(400);
    await flights.updateOne({ _id: flightId }, { $set: { status: 'Scheduled' } });
    check('FLT-05 price 200, seats below booked+held 409, =8 200, airports locked 400, times 200, empty 400, other 403, unknown cabin 404, Cancelled 400 x3');
  });

  it('FLT-30: Departed job and status', async () => {
    const past = await flights.create({
      airlineId: new Types.ObjectId(airlineA), flightNumber: 'TA900', from: 'CAI', to: 'DXB',
      departureAt: new Date(Date.now() - 60_000), arrivalAt: new Date(Date.now() + 3_600_000), departureDate: '2000-01-01',
    });
    const before = await modA.get(`/api/airlines/${airlineA}/flights?status=Scheduled`).expect(200);
    const shown = before.body.data.find((f: any) => f._id === String(past._id));
    expect(shown).toMatchObject({ status: 'Departed', bookable: false });
    await modA.patch(`/api/flights/${past._id}`).send({ departureLocal: `${Y}-01-01T10:00` }).expect(400);
    const n = await app.get(FlightStatusJob).markDeparted();
    expect(n).toBeGreaterThanOrEqual(1);
    expect((await flights.findById(past._id).lean<any>()).status).toBe('Departed');
    check('FLT-30 past flight shown Departed before the job, edit 400, job sets Departed');
  });

  it('FLT-08, FLT-09: policies', async () => {
    await modA.put(`/api/airlines/${airlineA}/baggage-policy`).send({ extraBagPrice: 3000, maxExtraBags: 2 }).expect(200);
    await modA.put(`/api/airlines/${airlineA}/baggage-policy`).send({ extraBagPrice: 0, maxExtraBags: 2 }).expect(400);
    await modA.put(`/api/airlines/${airlineA}/baggage-policy`).send({ extraBagPrice: 3000, maxExtraBags: -1 }).expect(400);
    await modA.put(`/api/airlines/${airlineA}/baggage-policy`).send({ extraBagPrice: 3000, maxExtraBags: 1.5 }).expect(400);
    await modB.put(`/api/airlines/${airlineA}/baggage-policy`).send({ extraBagPrice: 3000, maxExtraBags: 2 }).expect(403);
    const tiers = [{ daysBefore: 30, refundPercent: 100 }, { daysBefore: 7, refundPercent: 50 }, { daysBefore: 0, refundPercent: 0 }];
    await modA.put(`/api/airlines/${airlineA}/cancellation-policy`).send({ tiers }).expect(200);
    const pub = await agent().get(`/api/airlines/${airlineA}`).expect(200);
    expect(pub.body).toMatchObject({ extraBagPrice: 3000, maxExtraBags: 2, cancellationTiers: tiers });
    await modA.put(`/api/airlines/${airlineA}/cancellation-policy`).send({ tiers: [{ daysBefore: 7, refundPercent: 50 }, { daysBefore: 7, refundPercent: 20 }] }).expect(400);
    await modA.put(`/api/airlines/${airlineA}/cancellation-policy`).send({ tiers: [{ daysBefore: 7, refundPercent: 101 }] }).expect(400);
    await modA.put(`/api/airlines/${airlineA}/cancellation-policy`).send({ tiers: [{ daysBefore: 1.5, refundPercent: 10 }] }).expect(400);
    await modB.put(`/api/airlines/${airlineA}/cancellation-policy`).send({ tiers }).expect(403);
    check('FLT-08 200, 0/-1/1.5 400, other 403; FLT-09 200 shown in GET, dup/101/1.5 400, other 403');
  });

  it('FLT-01: logo', async () => {
    const first = await modA.post(`/api/airlines/${airlineA}/logo`).attach('logo', PNG, 'a.png').expect(201);
    const oldUrl = first.body.logo;
    await agent().get(oldUrl).expect(200);
    const second = await modA.post(`/api/airlines/${airlineA}/logo`).attach('logo', PNG, 'b.png').expect(201);
    expect(second.body.logo).not.toBe(oldUrl);
    await agent().get(oldUrl).expect(404);
    await agent().get(second.body.logo).expect(200);
    await modA.post(`/api/airlines/${airlineA}/logo`).attach('logo', PNG, 'a.png').attach('logo', PNG, 'b.png').expect(400);
    await modA.post(`/api/airlines/${airlineA}/logo`).attach('logo', Buffer.from('GIF89a....'), 'a.gif').expect(400);
    await modB.post(`/api/airlines/${airlineA}/logo`).attach('logo', PNG, 'a.png').expect(403);
    check('FLT-01 logo 201, replaced (old URL 404, new 200), two files 400, GIF 400, other 403');
  });

  it('ACC-15, ACC-16: suspensions and provider deactivation', async () => {
    await admin.patch(`/api/admin/accounts/${modBId}/suspend`).send({ reason: 'TEST' }).expect(200);
    await modB.get('/api/auth/me').expect(401);
    const login403 = await agent().post('/api/auth/login').send({ email: 'modb@test.local', password: 'NewPass123' }).expect(403);
    expect(login403.body.message).toBe('Account is suspended');
    await admin.patch(`/api/admin/accounts/${modBId}/suspend`).send({}).expect(409);
    await admin.patch(`/api/admin/accounts/${modBId}/reactivate`).send({}).expect(200);
    await login('modb@test.local', 'NewPass123');

    const adminId = String((await users.findOne({ email: 'admin@test.local' }).lean<any>())._id);
    await admin.patch(`/api/admin/accounts/${adminId}/suspend`).send({}).expect(403);
    await admin.patch(`/api/admin/accounts/${new Types.ObjectId()}/suspend`).send({}).expect(404);

    const user = await login('user@test.local', 'User12345');
    const userId = String((await users.findOne({ email: 'user@test.local' }).lean<any>())._id);
    await user.patch(`/api/admin/accounts/${userId}/suspend`).send({}).expect(403);
    await admin.patch(`/api/admin/accounts/${userId}/suspend`).send({}).expect(200);
    await user.get('/api/auth/me').expect(401);
    await agent().post('/api/auth/login').send({ email: 'user@test.local', password: 'User12345' }).expect(403);
    await admin.patch(`/api/admin/accounts/${userId}/reactivate`).send({}).expect(200);
    await login('user@test.local', 'User12345');

    const off = await admin.patch(`/api/admin/airlines/${airlineA}/deactivate`).send({ reason: 'TEST' }).expect(200);
    expect(off.body).toMatchObject({ isActive: false, notified: 1 });
    expect((await agent().get(`/api/airlines/${airlineA}`).expect(200)).body.isActive).toBe(false);
    await admin.patch(`/api/admin/airlines/${airlineA}/deactivate`).send({}).expect(409);
    const notes = await modA.get('/api/notifications').expect(200);
    expect(notes.body.data.map((n: any) => n.type)).toContain('PROVIDER_SUSPENDED');
    await admin.patch(`/api/admin/airlines/${airlineA}/reactivate`).send({}).expect(200);
    await admin.patch(`/api/admin/hotels/${hotelId}/deactivate`).send({}).expect(200);
    await agent().get(`/api/hotels/${hotelId}`).expect(404);
    await admin.patch(`/api/admin/hotels/${hotelId}/reactivate`).send({}).expect(200);
    await agent().get(`/api/hotels/${hotelId}`).expect(200);

    const audit = await admin.get('/api/admin/audit-logs?limit=10').expect(200);
    const actions = audit.body.data.map((r: any) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['PROVIDER_DEACTIVATED', 'PROVIDER_REACTIVATED', 'ACCOUNT_SUSPENDED', 'ACCOUNT_REACTIVATED']));
    const suspendedNote = await users.db.collection('notifications').findOne({ userId: new Types.ObjectId(modBId), type: 'ACCOUNT_SUSPENDED' });
    expect(suspendedNote).toBeTruthy();
    check('ACC-15 suspend 200, session 401, login 403 "Account is suspended", again 409, reactivate 200; admin 403, unknown 404; ACC-16 user same; non-admin 403; airline/hotel deactivate+reactivate, moderators notified, audit rows');
  });

  it("ACC-14 (Memo's account list) works next to these routes", async () => {
    const res = await admin.get('/api/admin/accounts?role=airline_moderator').expect(200);
    expect(res.body.meta.total).toBe(2);
    const user = await login('user@test.local', 'User12345');
    await user.get('/api/admin/accounts').expect(403);
    check('ACC-14 list 200 (2 airline moderators), user 403');
  });
});
