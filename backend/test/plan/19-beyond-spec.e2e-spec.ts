// Milestone 1 test plan, Part 19: situations the requirements do not spell
// out but a real user or moderator can cause: actions in an unusual order,
// at the same moment, or with a half-finished session. Each test builds its
// own data, so the order does not matter (E2E_PLAN.md). Where the spec is
// silent, the test checks an invariant (no money kept for nothing, no data
// changed by a refused request) instead of a particular status code.
import { Types } from 'mongoose';
import * as request from 'supertest';
import { Flight } from '../../src/flights/schemas/flight.schema';
import { FlightBooking } from '../../src/flight-bookings/schemas/flight-booking.schema';
import { createTestApp, TestApp } from '../e2e/app';
import {
  Actor,
  airlineModerator,
  TEST_PASSWORD,
  testEmail,
  traveler,
} from '../e2e/actors';
import { createAirline, seedReference } from '../e2e/fixtures';
import { paymentIntentEvent, signedWebhook } from '../e2e/fakes';

const DAY = 86_400_000;
const adult = () => ({
  type: 'adult',
  fullName: 'TEST Passenger',
  dateOfBirth: '1990-01-01',
  passportNumber: 'A1234567',
});
const cookiesOf = (res: request.Response) =>
  ((res.headers['set-cookie'] as unknown as string[]) ?? []).map(
    (c) => c.split(';')[0],
  );

describe('Test plan Part 19: beyond the written requirements', () => {
  let t: TestApp;
  let airline: Types.ObjectId;
  let n = 0;

  beforeAll(async () => {
    t = await createTestApp('plan-19-beyond-spec');
    await seedReference(t);
    airline = await createAirline(t, {
      cancellationTiers: [{ daysBefore: 0, refundPercent: 100 }],
    });
  }, 60_000);

  afterAll(async () => {
    await t?.close();
  });

  async function flight(o: { dep?: Date; price: number; seats?: number }) {
    const dep = o.dep ?? new Date(Date.now() + 30 * DAY);
    const f = await t.model(Flight.name).create({
      airlineId: airline,
      flightNumber: `QB${700 + ++n}`,
      from: 'CAI',
      to: 'DXB',
      departureAt: dep,
      arrivalAt: new Date(dep.getTime() + 4 * 3600_000),
      departureDate: new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Cairo',
      }).format(dep),
      status: 'Scheduled',
      cabins: [
        {
          category: 'Economy',
          totalSeats: o.seats ?? 5,
          price: o.price,
          freeBags: 1,
          maxKgPerBag: 23,
        },
      ],
    });
    return String(f._id);
  }
  async function webhookSuccess() {
    const intent = t.stripe.lastIntent()!;
    const { payload, signature } = signedWebhook(
      paymentIntentEvent(
        'payment_intent.succeeded',
        t.stripe.succeed(intent.id),
      ),
    );
    return t
      .http()
      .post('/api/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(payload);
  }
  async function paid(who: Actor, out: string) {
    const h = await who.agent
      .post('/api/flight-bookings/hold')
      .send({ outboundFlightId: out, cabin: 'Economy', passengers: [adult()] })
      .expect(201);
    await who.agent
      .post(`/api/bookings/flight/${h.body._id}/accept-policies`)
      .send({ accepted: true })
      .expect(200);
    await who.agent.post(`/api/bookings/flight/${h.body._id}/pay`).expect(201);
    expect((await webhookSuccess()).status).toBe(200);
    return String(h.body._id);
  }
  const booking = (id: string) =>
    t.model(FlightBooking.name).findById(id).lean<any>();
  const seatsTaken = async (id: string) => {
    const c = (await t.model(Flight.name).findById(id).lean<any>()).cabins[0];
    return (c.bookedSeats ?? 0) + (c.heldSeats ?? 0);
  };

  // ---- Flight changes (FLT-27) -----------------------------------------

  it('a change paid after the booking was cancelled keeps no money and no seat [partial: FLT-27, PAY-03]', async () => {
    const U = await traveler(t, 'TEST Change Then Cancel');
    const F1 = await flight({ price: 10000 });
    const F2 = await flight({ price: 25000 });
    const id = await paid(U, F1);
    const ch = await U.agent
      .patch(`/api/flight-bookings/${id}/change-flight`)
      .send({ outboundFlightId: F2 });
    expect(ch.status).toBe(200);
    expect(ch.body.status).toBe('PendingPayment');

    const q = await U.agent.get(`/api/flight-bookings/${id}/cancellation`);
    const cancel = await U.agent
      .post(`/api/flight-bookings/${id}/cancel`)
      .send({ refundAmount: q.body.refundAmount });
    expect(cancel.status).toBe(200);

    // Whatever the API answers to paying the difference now, the user must
    // not end up charged for a change that can no longer happen.
    const pay = await U.agent
      .post('/api/payments')
      .send({ bookingType: 'flight-change', bookingId: ch.body.changeId });
    expect(pay.status === 201 || pay.status === 409).toBe(true);
    if (pay.status === 201) expect((await webhookSuccess()).status).toBe(200);

    const b = await booking(id);
    expect(b.status).toBe('Cancelled');
    expect(String(b.segments[0].flightId)).toBe(F1);
    const changePays = await t
      .model('Payment')
      .find({ bookingId: new Types.ObjectId(ch.body.changeId) })
      .lean<any[]>();
    const charged = changePays
      .filter((p) => p.status === 'Succeeded')
      .reduce((s, p) => s + p.amount, 0);
    const refunded = (
      await t
        .model('Refund')
        .find({
          paymentId: { $in: changePays.map((p) => p._id) },
          status: { $ne: 'Failed' },
        })
        .lean<any[]>()
    ).reduce((s, r) => s + r.amount, 0);
    expect(charged - refunded).toBe(0);
    expect(await seatsTaken(F2)).toBe(0);
  });

  it('a departed booking cannot be changed (409) and stays as it was [partial: FLT-27]', async () => {
    const U = await traveler(t, 'TEST Departed Change');
    const F1 = await flight({ price: 10000 });
    const F2 = await flight({ price: 10000 });
    const id = await paid(U, F1);
    await t
      .model(FlightBooking.name)
      .updateOne(
        { _id: id },
        { $set: { 'segments.0.departureAt': new Date(Date.now() - 3600_000) } },
      );
    const r = await U.agent
      .patch(`/api/flight-bookings/${id}/change-flight`)
      .send({ outboundFlightId: F2 });
    expect(r.status).toBe(409);
    expect(String((await booking(id)).segments[0].flightId)).toBe(F1);
    expect(await seatsTaken(F2)).toBe(0);
  });

  it('a one-way booking refuses a returnFlightId (400) [partial: FLT-27, GEN-13]', async () => {
    const U = await traveler(t, 'TEST One Way Change');
    const F1 = await flight({ price: 10000 });
    const F2 = await flight({ price: 10000 });
    const F3 = await flight({ price: 10000 });
    const id = await paid(U, F1);
    const r = await U.agent
      .patch(`/api/flight-bookings/${id}/change-flight`)
      .send({ outboundFlightId: F2, returnFlightId: F3 });
    expect(r.status).toBe(400);
    expect(r.body.details).toHaveProperty('returnFlightId');
  });

  it('a change to a flight with the same fare is applied at once and says so [partial: FLT-27, GEN-01]', async () => {
    const U = await traveler(t, 'TEST Same Fare');
    const F1 = await flight({ price: 12000 });
    const F2 = await flight({
      price: 12000,
      dep: new Date(Date.now() + 31 * DAY),
    });
    const id = await paid(U, F1);
    const before = t.stripe.intents.size;
    const r = await U.agent
      .patch(`/api/flight-bookings/${id}/change-flight`)
      .send({ outboundFlightId: F2 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'Confirmed', difference: 0 });
    expect(t.stripe.intents.size).toBe(before);
    const b = await booking(id);
    expect(String(b.segments[0].flightId)).toBe(F2);
    expect(b.totalAmount).toBe(12000);
    expect(await seatsTaken(F1)).toBe(0);
    expect(await seatsTaken(F2)).toBe(1);
    const notes = (await U.agent.get('/api/notifications')).body.data;
    expect(JSON.stringify(notes)).toContain('fare is the same');
  });

  // ---- Flight edits by the moderator (FLT-05) -------------------------

  it('refuses every kind of invalid flight edit and leaves the flight unchanged [partial: FLT-05, GEN-13]', async () => {
    const mod = await airlineModerator(t, airline);
    const F = await flight({ price: 10000 });
    const before = await t.model(Flight.name).findById(F).lean<any>();
    const cases: [string, object][] = [
      ['nothing to change', {}],
      ['same airports', { to: 'CAI' }],
      [
        'arrival before departure',
        {
          arrivalLocal: '2099-01-01T08:00',
          departureLocal: '2099-01-01T10:00',
        },
      ],
      [
        'departure in the past',
        {
          departureLocal: '2020-01-01T10:00',
          arrivalLocal: '2020-01-01T14:00',
        },
      ],
      ['unknown airport', { to: 'ZZZ' }],
    ];
    const wrong: string[] = [];
    for (const [label, body] of cases) {
      const r = await mod.agent.patch(`/api/flights/${F}`).send(body);
      if (r.status !== 400 && r.status !== 404) {
        wrong.push(`${label} -> ${r.status}`);
      }
    }
    expect(wrong).toEqual([]);
    const after = await t.model(Flight.name).findById(F).lean<any>();
    expect([after.from, after.to, after.departureAt.getTime()]).toEqual([
      before.from,
      before.to,
      before.departureAt.getTime(),
    ]);
  });

  it('a booked flight cannot change airports, but its times can [partial: FLT-05]', async () => {
    const mod = await airlineModerator(t, airline);
    const U = await traveler(t, 'TEST Booked Flight');
    const F = await flight({ price: 10000 });
    await paid(U, F);
    const route = await mod.agent
      .patch(`/api/flights/${F}`)
      .send({ to: 'LHR' });
    expect(route.status).toBe(400);
    const time = await mod.agent
      .patch(`/api/flights/${F}`)
      .send({
        departureLocal: '2099-06-01T09:00',
        arrivalLocal: '2099-06-01T15:00',
      });
    expect(time.status).toBe(200);
    const notes = (await U.agent.get('/api/notifications')).body.data;
    expect(notes.map((x: any) => x.type)).toContain('FLIGHT_SCHEDULE_CHANGED');
  });

  it('a schedule change tells Confirmed passengers once each, not people who only hold seats [partial: FLT-05, GEN-01]', async () => {
    const mod = await airlineModerator(t, airline);
    const P = await traveler(t, 'TEST Paid Twice');
    const H = await traveler(t, 'TEST Only Holding');
    const F = await flight({ price: 10000 });
    await paid(P, F);
    await paid(P, F);
    await H.agent
      .post('/api/flight-bookings/hold')
      .send({ outboundFlightId: F, cabin: 'Economy', passengers: [adult()] })
      .expect(201);
    await mod.agent
      .patch(`/api/flights/${F}`)
      .send({
        departureLocal: '2099-07-01T09:00',
        arrivalLocal: '2099-07-01T15:00',
      })
      .expect(200);
    const count = async (who: Actor) =>
      (await who.agent.get('/api/notifications')).body.data.filter(
        (x: any) => x.type === 'FLIGHT_SCHEDULE_CHANGED',
      ).length;
    expect([await count(P), await count(H)]).toEqual([1, 0]);
  });

  // ---- Accounts and sessions (ACC-01, ACC-06, ACC-08) -------------------

  it('two sign-ups with the same email at the same moment: exactly one account [partial: ACC-01]', async () => {
    const email = testEmail('race');
    const body = {
      name: 'TEST Race',
      email,
      password: TEST_PASSWORD,
      acceptTerms: true,
    };
    const res = await Promise.all([
      t.http().post('/api/auth/register').send(body),
      t.http().post('/api/auth/register').send(body),
      t
        .http()
        .post('/api/auth/register')
        .send({ ...body, email: email.toUpperCase() }),
    ]);
    expect(res.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect(
      await t.model('User').countDocuments({ email: email.toLowerCase() }),
    ).toBe(1);
  });

  it('logging out with only the access cookie still ends the session [partial: ACC-06]', async () => {
    const U = await traveler(t, 'TEST Half Logout');
    const login = await t
      .http()
      .post('/api/auth/login')
      .send({ email: U.email, password: TEST_PASSWORD })
      .expect(200);
    const [access, refresh] = ['access_token', 'refresh_token'].map(
      (n) => cookiesOf(login).find((c) => c.startsWith(n + '='))!,
    );
    await t.http().post('/api/auth/logout').set('Cookie', access).expect(200);
    const me = await t.http().get('/api/auth/me').set('Cookie', access);
    expect(me.status).toBe(401);
    const again = await t
      .http()
      .post('/api/auth/refresh')
      .set('Cookie', refresh);
    expect(again.status).toBe(401);
  });

  it('logging out with no cookies at all is harmless [partial: ACC-06]', async () => {
    const r = await t.http().post('/api/auth/logout');
    expect(r.status).toBe(200);
  });

  it('a wrong current password or an unchanged one is refused and nothing changes [partial: ACC-08]', async () => {
    const U = await traveler(t, 'TEST Pw Mistakes');
    const wrong = await U.agent
      .patch('/api/auth/change-password')
      .send({ currentPassword: 'Wrong1234', newPassword: 'Another123' });
    const same = await U.agent
      .patch('/api/auth/change-password')
      .send({ currentPassword: TEST_PASSWORD, newPassword: TEST_PASSWORD });
    expect([wrong.status, same.status]).toEqual([400, 400]);
    expect((await U.agent.get('/api/auth/me')).status).toBe(200);
    await t
      .http()
      .post('/api/auth/login')
      .send({ email: U.email, password: TEST_PASSWORD })
      .expect(200);
  });

  it('a verified user asking for another verification email gets 400 and no email [partial: ACC-02]', async () => {
    const U = await traveler(t, 'TEST Already Verified');
    const before = t.outbox.to(U.email).length;
    const r = await U.agent.post('/api/auth/resend-verification');
    expect(r.status).toBe(400);
    expect(t.outbox.to(U.email).length).toBe(before);
  });

  it('a suspended user cannot refresh the session either [partial: ACC-16]', async () => {
    const U = await traveler(t, 'TEST Suspended Refresh');
    const login = await t
      .http()
      .post('/api/auth/login')
      .send({ email: U.email, password: TEST_PASSWORD })
      .expect(200);
    await t
      .model('User')
      .updateOne({ _id: U.id }, { $set: { status: 'suspended' } });
    const r = await t
      .http()
      .post('/api/auth/refresh')
      .set('Cookie', cookiesOf(login).join('; '));
    expect([401, 403]).toContain(r.status);
    const cleared = (
      (r.headers['set-cookie'] as unknown as string[]) ?? []
    ).some((c) =>
      /^access_token=;|Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c),
    );
    expect(cleared).toBe(true);
  });
});
