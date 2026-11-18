// TEMPORARY (test branch only, never merged): PAY-01 over HTTP with a real
// MongoDB. No Stripe key is set; webhook events are signed locally with the
// test STRIPE_WEBHOOK_SECRET, exactly as Stripe would sign them.
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { Model, Types } from 'mongoose';
import * as StripeLib from 'stripe';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { Flight } from '../src/flights/schemas/flight.schema';
import { User } from '../src/users/schemas/user.schema';

const withDatabase = process.env.E2E_MONGODB_URI ? describe : describe.skip;
const SECRET = process.env.STRIPE_WEBHOOK_SECRET as string;
const Y = new Date().getUTCFullYear() + 1;

withDatabase('PAY-01 live check', () => {
  let app: INestApplication;
  let server: any;
  let users: Model<any>;
  let flights: Model<any>;
  let db: any;
  const log: string[] = [];
  const ok = (s: string) => log.push('ok  ' + s);
  let user: any;
  let userId: string;
  let flightId: string;

  const login = async (email: string, password: string) => {
    const a = request.agent(server);
    await a.post('/api/auth/login').send({ email, password }).expect(200);
    return a;
  };
  const signed = (type: string, intent: Record<string, unknown>) => {
    const payload = JSON.stringify({
      id: 'evt_' + Math.random().toString(36).slice(2),
      object: 'event',
      type,
      data: { object: { object: 'payment_intent', ...intent } },
    });
    const header = (StripeLib as any).webhooks.generateTestHeaderString({ payload, secret: SECRET });
    return request(server)
      .post('/api/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', header)
      .send(payload);
  };
  const hold = async () => {
    const res = await user.post('/api/flight-bookings/hold').send({
      outboundFlightId: flightId,
      cabin: 'Economy',
      passengers: [{ type: 'adult', fullName: 'TEST Passenger', dateOfBirth: '1995-04-17', passportNumber: 'A12345678' }],
    });
    if (res.status !== 201) throw new Error('hold ' + res.status + ' ' + JSON.stringify(res.body));
    return res.body;
  };
  const seats = async () => {
    const f = await flights.findById(flightId).lean<any>();
    return { booked: f.cabins[0].bookedSeats, held: f.cabins[0].heldSeats };
  };

  beforeAll(async () => {
    const ref = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = ref.createNestApplication({ logger: ['error'], rawBody: true });
    configureApp(app);
    await app.init();
    server = app.getHttpServer();
    users = app.get(getModelToken(User.name));
    flights = app.get(getModelToken(Flight.name));
    db = users.db;
    await users.create({ name: 'TEST Admin', email: 'admin@pay.test', passwordHash: await bcrypt.hash('Admin12345', 10), role: 'admin', acceptedTermsAt: new Date() });
    const admin = await login('admin@pay.test', 'Admin12345');
    const airline = (await admin.post('/api/airlines').send({ name: 'TEST Pay Air', code: 'PY' }).expect(201)).body._id;
    await admin.post('/api/admin/moderators').send({ name: 'TEST Mod', email: 'mod@pay.test', role: 'airline_moderator', providerId: airline, temporaryPassword: 'Temp12345' }).expect(201);
    const mod = await login('mod@pay.test', 'Temp12345');
    await mod.patch('/api/auth/change-password').send({ currentPassword: 'Temp12345', newPassword: 'NewPass123' }).expect(200);
    await mod.put(`/api/airlines/${airline}/cancellation-policy`).send({ tiers: [{ daysBefore: 7, refundPercent: 50 }] }).expect(200);
    await mod.put(`/api/airlines/${airline}/baggage-policy`).send({ extraBagPrice: 3000, maxExtraBags: 2 }).expect(200);
    flightId = (await mod.post('/api/flights').send({ flightNumber: 'PY101', from: 'CAI', to: 'DXB', departureLocal: `${Y}-12-01T14:30`, arrivalLocal: `${Y}-12-01T18:45` }).expect(201)).body._id;
    await mod.post(`/api/flights/${flightId}/cabins`).send({ category: 'Economy', totalSeats: 10, price: 25000, freeBags: 1, maxKgPerBag: 23 }).expect(201);
    await request(server).post('/api/auth/register').send({ name: 'TEST User', email: 'user@pay.test', password: 'User12345', acceptTerms: true }).expect(201);
    user = await login('user@pay.test', 'User12345');
    userId = String((await users.findOne({ email: 'user@pay.test' }).lean<any>())._id);
  }, 90_000);

  afterAll(async () => {
    console.log(`\nPAY-01 LIVE CHECKS (${log.length}):\n` + log.join('\n'));
    await app?.close();
  });

  it('pay route: checks run before Stripe', async () => {
    const b = await hold();
    const id = b._id ?? b.bookingId;
    const res = await user.post(`/api/bookings/flight/${id}/pay`).send({});
    log.push(`info pay flight booking without accepted policies -> ${res.status} ${res.body.message}`);
    expect([400, 501, 503]).toContain(res.status);
    await request(server).post(`/api/bookings/flight/${id}/pay`).send({}).expect(401);
    const other = await (async () => {
      await request(server).post('/api/auth/register').send({ name: 'TEST Other', email: 'other@pay.test', password: 'User12345', acceptTerms: true }).expect(201);
      return login('other@pay.test', 'User12345');
    })();
    const r404 = await other.post(`/api/bookings/flight/${id}/pay`).send({});
    log.push(`info pay someone else's booking -> ${r404.status}`);
    expect(r404.status).toBe(404);
    ok('pay route: no session 401, someone else 404, own booking gets a clear 4xx/5xx before Stripe');
  });

  it('webhook rejects missing and forged signatures', async () => {
    await request(server).post('/api/payments/webhook').set('Content-Type', 'application/json').send('{"type":"payment_intent.succeeded"}').expect(400);
    await request(server).post('/api/payments/webhook').set('Content-Type', 'application/json').set('stripe-signature', 't=1,v1=deadbeef').send('{"type":"payment_intent.succeeded"}').expect(400);
    ok('webhook without or with a forged signature: 400');
  });

  it('a signed payment_intent.succeeded confirms the flight booking once', async () => {
    const b = await hold();
    const id = String(b._id ?? b.bookingId);
    const total = b.totalAmount;
    expect(await seats()).toMatchObject({ held: 2 });
    await db.collection('payments').insertOne({ bookingType: 'flight', bookingId: new Types.ObjectId(id), userId: new Types.ObjectId(userId), stripePaymentIntentId: 'pi_test_ok', amount: total, currency: 'USD', status: 'Pending', createdAt: new Date(), updatedAt: new Date() });
    await signed('payment_intent.succeeded', { id: 'pi_test_ok', amount: total, amount_received: total, currency: 'usd', status: 'succeeded', metadata: { bookingType: 'flight', bookingId: id } }).expect(200);
    const booking = await db.collection('flightbookings').findOne({ _id: new Types.ObjectId(id) });
    expect(booking.status).toBe('Confirmed');
    expect(booking.reference).toMatch(/^FL-[A-Z0-9]{8}$/);
    expect((await db.collection('payments').findOne({ stripePaymentIntentId: 'pi_test_ok' })).status).toBe('Succeeded');
    const after = await seats();
    expect(after.booked).toBe(1);
    await signed('payment_intent.succeeded', { id: 'pi_test_ok', amount: total, amount_received: total, currency: 'usd', status: 'succeeded' }).expect(200);
    expect(await seats()).toEqual(after);
    const notes = await db.collection('notifications').countDocuments({ userId: new Types.ObjectId(userId), type: 'BOOKING_CONFIRMED' });
    log.push(`info confirmation notifications: ${notes}`);
    const ticket = await user.get(`/api/flight-bookings/${id}/e-ticket`);
    log.push(`info e-ticket after payment -> ${ticket.status} ${ticket.headers['content-type']}`);
    ok(`succeeded event: booking Confirmed (${booking.reference}), payment Succeeded, held seat became booked; repeated event changes nothing`);
  });

  it('a wrong amount does not confirm; failed and canceled update the payment only', async () => {
    const b = await hold();
    const id = String(b._id ?? b.bookingId);
    const total = b.totalAmount;
    await db.collection('payments').insertOne({ bookingType: 'flight', bookingId: new Types.ObjectId(id), userId: new Types.ObjectId(userId), stripePaymentIntentId: 'pi_test_bad', amount: total, currency: 'USD', status: 'Pending', createdAt: new Date(), updatedAt: new Date() });
    await signed('payment_intent.succeeded', { id: 'pi_test_bad', amount: total, amount_received: total - 100, currency: 'usd', status: 'succeeded' }).expect(200);
    expect((await db.collection('flightbookings').findOne({ _id: new Types.ObjectId(id) })).status).toBe('PendingPayment');
    expect((await db.collection('payments').findOne({ stripePaymentIntentId: 'pi_test_bad' })).status).toBe('Pending');
    await signed('payment_intent.payment_failed', { id: 'pi_test_bad', amount: total, amount_received: 0, currency: 'usd', status: 'requires_payment_method' }).expect(200);
    expect((await db.collection('payments').findOne({ stripePaymentIntentId: 'pi_test_bad' })).status).toBe('Failed');
    expect((await db.collection('flightbookings').findOne({ _id: new Types.ObjectId(id) })).status).toBe('PendingPayment');
    await signed('payment_intent.canceled', { id: 'pi_test_bad', amount: total, amount_received: 0, currency: 'usd', status: 'canceled' }).expect(200);
    log.push(`info canceled event -> payment ${(await db.collection('payments').findOne({ stripePaymentIntentId: 'pi_test_bad' })).status}`);
    await signed('payment_intent.succeeded', { id: 'pi_unknown', amount: 1, amount_received: 1, currency: 'usd', status: 'succeeded' }).expect(200);
    ok('wrong amount: not confirmed; failed: payment Failed, booking still PendingPayment; unknown PaymentIntent ignored');
  });
});
