// TEMPORARY (test branch only): Hasan's and Rawda's open PRs together with
// the three bonus items (HTL-26, BON-01, FLT-27), over HTTP against a real
// MongoDB. Stripe has no key in CI, so a successful payment is simulated the
// way Stripe's webhook reports it: a Pending payment record, then
// PaymentsService.handleStripeEvent('payment_intent.succeeded').
import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { Model, Types } from 'mongoose';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { FlightChangeService } from '../src/flight-bookings/flight-change.service';
import { PaymentsService } from '../src/payments/payments.service';
import { User } from '../src/users/schemas/user.schema';

const withDatabase = process.env.E2E_MONGODB_URI ? describe : describe.skip;
const Y = new Date().getUTCFullYear() + 1;
const oid = (x: unknown) => new Types.ObjectId(String(x));

withDatabase('Hasan + Rawda + bonus live check', () => {
  let app: INestApplication;
  let server: any;
  let users: Model<any>;
  let db: any;
  let payments: PaymentsService;
  const log: string[] = [];
  const ok = (s: string) => log.push('ok  ' + s);
  const login = async (email: string, password: string) => {
    const a = request.agent(server);
    await a.post('/api/auth/login').send({ email, password }).expect(200);
    return a;
  };
  const userId = async (email: string) =>
    String((await users.findOne({ email }).lean<any>())._id);

  // Stripe's webhook saying the PaymentIntent succeeded.
  const pay = async (
    type: string,
    bookingId: string,
    uid: string,
    amount: number,
    parentBookingId: string | null = null,
  ) => {
    const pi = 'pi_test_' + new Types.ObjectId().toHexString();
    await db.collection('payments').insertOne({
      bookingType: type,
      bookingId: oid(bookingId),
      userId: oid(uid),
      parentBookingId: parentBookingId ? oid(parentBookingId) : null,
      stripePaymentIntentId: pi,
      amount,
      currency: 'USD',
      status: 'Pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await succeeded(pi, amount);
    return pi;
  };
  const succeeded = (pi: string, amount: number) =>
    payments.handleStripeEvent('payment_intent.succeeded', {
      id: pi,
      status: 'succeeded',
      amount,
      amountReceived: amount,
      currency: 'usd',
      clientSecret: null,
      metadata: {},
    });
  const cabinOf = async (flightId: string) =>
    (await db.collection('flights').findOne({ _id: oid(flightId) })).cabins[0];
  const bookingDoc = async (coll: string, id: string) =>
    db.collection(coll).findOne({ _id: oid(id) });
  // No Stripe key in CI, so refunds are recorded as Failed; mark them as
  // Stripe would have.
  const refundsDone = () =>
    db
      .collection('refunds')
      .updateMany({ status: 'Failed' }, { $set: { status: 'Refunded' } });

  let admin: any;
  let airMod: any;
  let hotelMod: any;
  let u: any;
  let v: any;
  let uid: string;
  const F: Record<string, string> = {};

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
    payments = app.get(PaymentsService);
    await users.create({
      name: 'TEST Admin',
      email: 'admin@bonus.test',
      passwordHash: await bcrypt.hash('Admin12345', 10),
      role: 'admin',
      acceptedTermsAt: new Date(),
    });
    admin = await login('admin@bonus.test', 'Admin12345');
    for (const e of ['u', 'v']) {
      await request(server)
        .post('/api/auth/register')
        .send({
          name: `TEST ${e}`,
          email: `${e}@bonus.test`,
          password: 'User12345',
          acceptTerms: true,
        })
        .expect(201);
    }
    await users.updateMany(
      { email: /@bonus\.test$/ },
      { $set: { emailVerified: true } },
    );
    u = await login('u@bonus.test', 'User12345');
    v = await login('v@bonus.test', 'User12345');
    uid = await userId('u@bonus.test');
  }, 60_000);

  afterAll(async () => {
    console.log(`\nBONUS LIVE CHECKS (${log.length}):\n` + log.join('\n'));
    await app?.close();
  });

  const moderator = async (email: string, role: string, providerId: string) => {
    await admin
      .post('/api/admin/moderators')
      .send({
        name: 'TEST Mod',
        email,
        role,
        providerId,
        temporaryPassword: 'Temp12345',
      })
      .expect(201);
    const m = await login(email, 'Temp12345');
    await m
      .patch('/api/auth/change-password')
      .send({ currentPassword: 'Temp12345', newPassword: 'NewPass123' })
      .expect(200);
    return m;
  };

  it('flights: FLT-28 seat, FLT-27 change (cheaper, full, dearer, expired), FLT-26 cancel with split refund', async () => {
    const airline = (
      await admin
        .post('/api/airlines')
        .send({ name: 'TEST Bonus Air', code: 'B9' })
        .expect(201)
    ).body._id;
    airMod = await moderator('air@bonus.test', 'airline_moderator', airline);
    await airMod
      .put(`/api/airlines/${airline}/cancellation-policy`)
      .send({ tiers: [{ daysBefore: 0, refundPercent: 100 }] })
      .expect(200);
    const flight = async (
      key: string,
      no: string,
      to: string,
      day: number,
      price: number,
      seats: number,
    ) => {
      F[key] = (
        await airMod
          .post('/api/flights')
          .send({
            flightNumber: no,
            from: 'CAI',
            to,
            departureLocal: `${Y}-12-0${day}T10:00`,
            arrivalLocal: `${Y}-12-0${day}T14:00`,
          })
          .expect(201)
      ).body._id;
      await airMod
        .post(`/api/flights/${F[key]}/cabins`)
        .send({
          category: 'Economy',
          totalSeats: seats,
          price,
          freeBags: 1,
          maxKgPerBag: 23,
        })
        .expect(201);
    };
    await flight('f1', 'B9101', 'DXB', 1, 50000, 5);
    await flight('f2', 'B9102', 'DXB', 2, 40000, 5);
    await flight('f3', 'B9103', 'DXB', 3, 65000, 5);
    await flight('full', 'B9104', 'DXB', 4, 30000, 1);
    await flight('lhr', 'B9105', 'LHR', 5, 30000, 5);

    const passengers = [
      {
        type: 'Adult',
        fullName: 'TEST User',
        dateOfBirth: '1990-01-01',
        passportNumber: 'A1234567',
      },
    ];
    const book = async (agent: any, flightId: string) =>
      (
        await agent
          .post('/api/flight-bookings/hold')
          .send({ outboundFlightId: flightId, cabin: 'Economy', passengers })
          .expect(201)
      ).body;

    const b1 = await book(u, F.f1);
    expect(b1.totalAmount).toBe(50000);
    await pay('flight', b1._id, uid, 50000);
    expect((await bookingDoc('flightbookings', b1._id)).status).toBe(
      'Confirmed',
    );
    await u
      .patch(`/api/flight-bookings/${b1._id}/seat`)
      .send({ segment: 0, passengerIndex: 0, seat: '1A' })
      .expect(200);
    expect(
      await db
        .collection('seatassignments')
        .countDocuments({ bookingId: oid(b1._id) }),
    ).toBe(1);
    ok(
      'hold -> Stripe success -> Confirmed (FLT-22/23), seat 1A chosen (FLT-28)',
    );

    const change = (id: string, flightId: string, agent = u) =>
      agent
        .patch(`/api/flight-bookings/${id}/change-flight`)
        .send({ outboundFlightId: flightId });
    await change(b1._id, F.lhr).expect(400);
    await change(b1._id, F.f1).expect(400);
    await change(b1._id, F.f2, v).expect(404);
    await request(server)
      .patch(`/api/flight-bookings/${b1._id}/change-flight`)
      .send({ outboundFlightId: F.f2 })
      .expect(401);
    await u
      .patch(`/api/flight-bookings/${b1._id}/change-flight`)
      .send({})
      .expect(400);
    ok(
      'FLT-27: another route 400, same flight 400, another user 404, no session 401, empty body 400',
    );

    // The last seat is held by someone else: 409, booking unchanged.
    await book(v, F.full);
    const full = await change(b1._id, F.full).expect(409);
    expect(full.body.message).toMatch(/seat/i);
    const still = await bookingDoc('flightbookings', b1._id);
    expect(String(still.segments[0].flightId)).toBe(F.f1);
    expect(still.totalAmount).toBe(50000);
    expect((await cabinOf(F.full)).heldSeats).toBe(1);
    ok('FLT-27: full flight -> 409, booking and seats unchanged');

    // Cheaper: applied at once, difference refunded, seats moved.
    const cheap = (await change(b1._id, F.f2).expect(200)).body;
    expect(cheap).toMatchObject({
      status: 'Confirmed',
      oldTotal: 50000,
      newTotal: 40000,
      difference: -10000,
    });
    expect(cheap.refund.amount).toBe(10000);
    let doc = await bookingDoc('flightbookings', b1._id);
    expect(String(doc.segments[0].flightId)).toBe(F.f2);
    expect(doc.totalAmount).toBe(40000);
    expect((await cabinOf(F.f1)).bookedSeats).toBe(0);
    expect(await cabinOf(F.f2)).toMatchObject({ bookedSeats: 1, heldSeats: 0 });
    expect(
      await db
        .collection('seatassignments')
        .countDocuments({ bookingId: oid(b1._id) }),
    ).toBe(0);
    const r1 = await db
      .collection('refunds')
      .find({ bookingId: oid(b1._id) })
      .toArray();
    expect(r1.map((r: any) => [r.bookingType, r.amount])).toEqual([
      ['flight', 10000],
    ]);
    expect(
      await db
        .collection('notifications')
        .countDocuments({ userId: oid(uid), type: 'BOOKING_CHANGED' }),
    ).toBe(1);
    ok(
      'FLT-27: cheaper flight applied now, 10000 refunded on the booking, seats moved (f1 0, f2 1), FLT-28 seat freed, BOOKING_CHANGED sent',
    );
    await refundsDone();

    // Dearer: waits for the difference, paid as "flight-change".
    const dear = (await change(b1._id, F.f3).expect(200)).body;
    expect(dear).toMatchObject({
      status: 'PendingPayment',
      amountDue: 25000,
      payWith: { body: { bookingType: 'flight-change' } },
    });
    expect((await cabinOf(F.f3)).heldSeats).toBe(1);
    await change(b1._id, F.f1).expect(409);
    const p = await u
      .post('/api/payments')
      .send({ bookingType: 'flight-change', bookingId: dear.changeId });
    expect([502, 503]).toContain(p.status); // validated, then no Stripe key in CI
    await v
      .post('/api/payments')
      .send({ bookingType: 'flight-change', bookingId: dear.changeId })
      .expect(404);
    doc = await bookingDoc('flightbookings', b1._id);
    expect(doc.totalAmount).toBe(40000);
    const pi = await pay('flight-change', dear.changeId, uid, 25000, b1._id);
    await succeeded(pi, 25000); // Stripe repeating the event
    doc = await bookingDoc('flightbookings', b1._id);
    expect(String(doc.segments[0].flightId)).toBe(F.f3);
    expect(doc.totalAmount).toBe(65000);
    expect(doc.status).toBe('Confirmed');
    expect(await cabinOf(F.f3)).toMatchObject({ bookedSeats: 1, heldSeats: 0 });
    expect((await cabinOf(F.f2)).bookedSeats).toBe(0);
    log.push(
      `info POST /payments for a change without Stripe key -> ${p.status}`,
    );
    ok(
      'FLT-27: dearer flight -> PendingPayment 25000, a second change 409, another user cannot pay it (404); Stripe success applies it (f3 booked, f2 freed), a repeated event changes nothing',
    );

    // FLT-26 after a change: the refund is split over both payments.
    const preview = (
      await u.get(`/api/flight-bookings/${b1._id}/cancellation`).expect(200)
    ).body;
    expect(preview).toMatchObject({ refundPercent: 100, refundAmount: 65000 });
    const cancelled = (
      await u
        .post(`/api/flight-bookings/${b1._id}/cancel`)
        .send({ refundAmount: 65000 })
        .expect(201)
    ).body;
    expect(cancelled.status).toBe('Cancelled');
    expect(cancelled.refund.amount).toBe(65000);
    const r2 = await db
      .collection('refunds')
      .find({ bookingId: oid(b1._id) })
      .sort({ _id: 1 })
      .toArray();
    expect(r2.map((r: any) => r.amount)).toEqual([10000, 25000, 40000]);
    expect(r2.every((r: any) => r.bookingType === 'flight')).toBe(true);
    expect((await cabinOf(F.f3)).bookedSeats).toBe(0);
    await change(b1._id, F.f2).expect(409);
    ok(
      'FLT-26: cancel after a paid change refunds 65000 = 25000 (change payment) + 40000 (rest of the original 50000 after the 10000 refund); seats freed; a cancelled booking cannot be changed (409)',
    );
    await refundsDone();

    // An unpaid change expires; a late payment is refunded, not applied.
    const b2 = await book(u, F.f2);
    await pay('flight', b2._id, uid, 40000);
    const late = (await change(b2._id, F.f3).expect(200)).body;
    await db
      .collection('flightchanges')
      .updateOne(
        { _id: oid(late.changeId) },
        { $set: { expiresAt: new Date(Date.now() - 1000) } },
      );
    expect(await app.get(FlightChangeService).expireUnpaid()).toBe(1);
    expect(
      (
        await db
          .collection('flightchanges')
          .findOne({ _id: oid(late.changeId) })
      ).status,
    ).toBe('Expired');
    expect((await cabinOf(F.f3)).heldSeats).toBe(0);
    await pay('flight-change', late.changeId, uid, 25000, b2._id);
    doc = await bookingDoc('flightbookings', b2._id);
    expect(String(doc.segments[0].flightId)).toBe(F.f2);
    expect(doc.totalAmount).toBe(40000);
    const r3 = await db
      .collection('refunds')
      .find({ bookingId: oid(b2._id) })
      .toArray();
    expect(r3.map((r: any) => r.amount)).toEqual([25000]);
    ok(
      'FLT-27: unpaid change expires after 10 min (seats released); a payment arriving later is refunded in full and the booking stays',
    );
    await refundsDone();
    F.b2 = b2._id;
  });

  it("Hasan's flight items: FLT-29 passengers, ACC-17 admin bookings, FLT-06 airline cancels", async () => {
    const list = (await airMod.get(`/api/flights/${F.f2}/bookings`).expect(200))
      .body;
    expect(JSON.stringify(list)).toContain('TEST User');
    const csv = await airMod
      .get(`/api/flights/${F.f2}/passengers/export`)
      .expect(200);
    expect(csv.text).toContain('TEST User');
    await u.get(`/api/flights/${F.f2}/bookings`).expect(403);
    ok(
      'FLT-29: the airline moderator lists and exports the passengers; a user 403',
    );

    const all = (await admin.get('/api/admin/bookings').expect(200)).body;
    expect(all.meta.total).toBeGreaterThanOrEqual(3);
    await u.get('/api/admin/bookings').expect(403);
    ok(`ACC-17: admin sees all bookings (${all.meta.total}); a user 403`);

    const res = (await airMod.post(`/api/flights/${F.f2}/cancel`).send({}))
      .body;
    expect(res.cancelledBookings).toBe(1);
    expect((await bookingDoc('flightbookings', F.b2)).status).toBe('Cancelled');
    const r = await db
      .collection('refunds')
      .find({ bookingId: oid(F.b2) })
      .sort({ _id: 1 })
      .toArray();
    expect(r.map((x: any) => x.amount)).toEqual([25000, 40000]);
    ok(
      'FLT-06: airline cancels the flight -> the Confirmed booking Cancelled with a full 40000 refund',
    );
    await refundsDone();
  });

  it("Rawda's rooms, Hasan's hotel items, HTL-26 replies, ACC-12", async () => {
    const hotel = (
      await admin
        .post('/api/hotels')
        .send({
          name: 'TEST Bonus Hotel',
          address: '1 Nile St',
          cityId: 'cairo',
          countryCode: 'EG',
          starClass: 4,
        })
        .expect(201)
    ).body._id;
    hotelMod = await moderator('hotel@bonus.test', 'hotel_moderator', hotel);
    await hotelMod
      .put(`/api/hotels/${hotel}/policies`)
      .send({
        checkInTime: '14:00',
        checkOutTime: '12:00',
        cancellationTiers: [{ daysBefore: 0, refundPercent: 100 }],
      })
      .expect(200);
    const room = (
      await hotelMod
        .post(`/api/hotels/${hotel}/rooms`)
        .send({
          name: '101',
          type: 'Double',
          beds: 2,
          maxOccupancy: 3,
          pricePerNight: 10000,
        })
        .expect(201)
    ).body;
    const roomId = room._id ?? room.id;
    const av = await hotelMod
      .post(`/api/hotels/${hotel}/rooms/${roomId}/availability`)
      .send({ from: `${Y}-12-01`, to: `${Y}-12-31` });
    expect([200, 201]).toContain(av.status);
    await hotelMod
      .get(`/api/hotels/${hotel}/availability?from=${Y}-12-01&to=${Y}-12-05`)
      .expect(200);
    const free = (
      await request(server)
        .get(
          `/api/hotels/${hotel}/rooms/available?checkIn=${Y}-12-10&checkOut=${Y}-12-12`,
        )
        .expect(200)
    ).body;
    expect(JSON.stringify(free)).toContain('101');
    ok(
      'Rawda: room added, availability range, calendar and available rooms (HTL-05/06/08/02)',
    );

    const stay = async (checkIn: string, checkOut: string) =>
      (
        await u
          .post('/api/hotel-bookings')
          .send({
            hotelId: hotel,
            checkIn,
            checkOut,
            rooms: [{ roomId, adults: 2, childAges: [] }],
          })
          .expect(201)
      ).body;
    const h1 = await stay(`${Y}-12-10`, `${Y}-12-12`);
    expect(h1.totalAmount).toBe(20000);
    await pay('hotel', h1._id, uid, 20000);
    expect((await bookingDoc('hotelbookings', h1._id)).status).toBe(
      'Confirmed',
    );
    const resv = (
      await hotelMod.get(`/api/hotels/${hotel}/reservations`).expect(200)
    ).body;
    expect(JSON.stringify(resv)).toContain(String(h1._id));
    await u.get(`/api/hotels/${hotel}/reservations`).expect(403);
    ok('HTL-22: the hotel moderator lists the reservations; a user 403');

    const deact = await u.delete('/api/users/me');
    expect(deact.status).toBe(409);
    ok('ACC-12: deactivation refused (409) while a Confirmed stay is ahead');

    const h2 = await stay(`${Y}-12-20`, `${Y}-12-21`);
    await pay('hotel', h2._id, uid, 10000);
    const q = (
      await u.get(`/api/hotel-bookings/${h2._id}/cancellation`).expect(200)
    ).body;
    expect(q.refundAmount).toBe(10000);
    await u
      .post(`/api/hotel-bookings/${h2._id}/cancel`)
      .send({ refundAmount: 9999 })
      .expect(409);
    const c = await u
      .post(`/api/hotel-bookings/${h2._id}/cancel`)
      .send({ refundAmount: 10000 });
    expect([200, 201]).toContain(c.status);
    expect((await bookingDoc('hotelbookings', h2._id)).status).toBe(
      'Cancelled',
    );
    ok('HTL-21: cancel with the confirmed refund amount (a stale amount 409)');
    await refundsDone();

    await u
      .post(`/api/hotel-bookings/${h1._id}/review`)
      .send({ rating: 5 })
      .expect(409);
    await db
      .collection('hotelbookings')
      .updateOne({ _id: oid(h1._id) }, { $set: { status: 'Completed' } });
    const review = (
      await u
        .post(`/api/hotel-bookings/${h1._id}/review`)
        .send({ rating: 5, text: 'TEST lovely stay' })
        .expect(201)
    ).body;
    await u
      .post(`/api/hotel-bookings/${h1._id}/review`)
      .send({ rating: 4 })
      .expect(409);
    ok('HTL-23/24: review only after the stay is Completed, only once');

    const reply = (path: string, agent: any, text = 'TEST thank you!') =>
      agent.post(path).send({ text });
    const rpath = `/api/reviews/${review._id}/reply`;
    await reply(rpath, u).expect(403);
    await reply(rpath, airMod).expect(403);
    await reply(rpath, hotelMod, '   ').expect(400);
    await reply(`/api/reviews/${new Types.ObjectId()}/reply`, hotelMod).expect(
      404,
    );
    const other = (
      await admin
        .post('/api/hotels')
        .send({
          name: 'TEST Other Hotel',
          address: '2 Nile St',
          cityId: 'cairo',
          countryCode: 'EG',
          starClass: 3,
        })
        .expect(201)
    ).body._id;
    const otherMod = await moderator(
      'other@bonus.test',
      'hotel_moderator',
      other,
    );
    await reply(rpath, otherMod).expect(403);
    const done = await reply(rpath, hotelMod);
    expect([200, 201]).toContain(done.status);
    await reply(rpath, hotelMod).expect(409);
    const page = (
      await request(server).get(`/api/hotels/${hotel}/reviews`).expect(200)
    ).body;
    expect(page.ratingAverage).toBe(5);
    expect(page.data[0].reply).toMatchObject({ text: 'TEST thank you!' });
    expect(
      await db
        .collection('notifications')
        .countDocuments({ userId: oid(uid), type: 'REVIEW_REPLIED' }),
    ).toBe(1);
    ok(
      "HTL-26: the hotel's moderator replies once (twice 409); a user, an airline moderator or another hotel's moderator 403; blank 400; unknown review 404; reply shown on the hotel's reviews; reviewer notified",
    );
  });

  it('BON-01: admin analytics match a hand calculation', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const a = (
      await admin
        .get(`/api/admin/analytics?from=${today}&to=${today}`)
        .expect(200)
    ).body;
    const air = a.airlines.find((x: any) => x.code === 'B9');
    // b1: paid 50000 + 25000 change, refunded 10000 + 65000 -> cancelled.
    // b2: paid 40000 + 25000 late change, refunded 25000 + 40000 -> cancelled.
    // v's hold on the full flight is PendingPayment: not counted.
    expect(air).toMatchObject({
      bookings: 0,
      cancelled: 2,
      grossRevenue: 140000,
      refunded: 140000,
      revenue: 0,
    });
    const hotel = a.hotels.find((x: any) => x.name === 'TEST Bonus Hotel');
    expect(hotel).toMatchObject({
      bookings: 1,
      cancelled: 1,
      grossRevenue: 30000,
      refunded: 10000,
      revenue: 20000,
    });
    expect(a.totals.revenue).toBeGreaterThanOrEqual(20000);
    expect(a.currency).toBe('USD');
    await admin
      .get(`/api/admin/analytics?from=${today}&to=2000-01-01`)
      .expect(400);
    await admin.get('/api/admin/analytics?from=31-12-2026').expect(400);
    await u.get('/api/admin/analytics').expect(403);
    await request(server).get('/api/admin/analytics').expect(401);
    const none = (
      await admin
        .get('/api/admin/analytics?from=2001-01-01&to=2001-01-31')
        .expect(200)
    ).body;
    expect(none.totals.bookings + none.totals.cancelled).toBe(0);
    ok(
      'BON-01: per airline 0 active / 2 cancelled, paid 140000 incl. change payments, refunded 140000; hotel 1 / 1, 30000 - 10000 = 20000; another period empty; bad dates 400; user 403; no session 401',
    );
  });
});
