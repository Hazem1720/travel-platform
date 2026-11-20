import * as nock from 'nock';
import { Types } from 'mongoose';
import { BookingStatus } from '../../src/common/enums/booking-status.enum';
import { ExchangeRatesService } from '../../src/exchange-rates/exchange-rates.service';
import { FlightBookingJobs } from '../../src/flight-bookings/flight-booking.jobs';
import { FlightBooking } from '../../src/flight-bookings/schemas/flight-booking.schema';
import { Flight } from '../../src/flights/schemas/flight.schema';
import { HotelBookingJobs } from '../../src/hotel-bookings/hotel-booking.jobs';
import { HotelBooking } from '../../src/hotel-bookings/schemas/hotel-booking.schema';
import { Refund } from '../../src/payments/schemas/refund.schema';
import {
  Actor,
  admin,
  airlineModerator,
  hotelModerator,
  testEmail,
  traveler,
} from './actors';
import { createTestApp, TestApp } from './app';
import { paymentIntentEvent, signedWebhook } from './fakes';
import { createAirline, createFlight, seedReference, setup } from './fixtures';

// The gaps found by comparing backend/test/E2E_PLAN.md section 3 with the
// suites in backend/test/plan/: what happens when a payment and a hold
// expiry meet, when Stripe reports a different amount, how a refund
// percentage becomes cents, local dates west of UTC, the FX key, and the
// audit log of every admin action. One rule per test; table-driven tests
// report every mismatch at once.

const FX_KEY = process.env.FXRATES_API_KEY!; // set in setup-e2e-env.ts
const ADULT = {
  type: 'adult',
  fullName: 'TEST Sara Ali',
  dateOfBirth: '1990-01-01',
  passportNumber: 'A1234567',
};
const pad = (n: number) => String(n).padStart(2, '0');

function idOf(body: any): string {
  const id = body?._id ?? body?.id;
  if (!id) throw new Error(`no id in ${JSON.stringify(body).slice(0, 200)}`);
  return String(id);
}

describe('money and time', () => {
  let t: TestApp;
  let adminActor: Actor;
  let payer: Actor;

  beforeAll(async () => {
    t = await createTestApp('money-and-time');
    await seedReference(t);
    adminActor = await admin(t);
    payer = await traveler(t, 'TEST Payer');
  });
  afterAll(async () => t?.close());

  // ---- helpers ----------------------------------------------------------
  type BookingType = 'flight' | 'hotel';
  const bookingModel = (type: BookingType) =>
    t.model(type === 'flight' ? FlightBooking.name : HotelBooking.name);

  // Accept the policies and pay (arrange); returns the PaymentIntent id.
  async function pay(who: Actor, type: BookingType, id: string) {
    await setup(who.agent.post(`/api/bookings/${type}/${id}/accept-policies`))
      .send({ accepted: true })
      .expect(200);
    const res = await setup(
      who.agent.post(`/api/bookings/${type}/${id}/pay`),
    ).expect(201);
    return {
      intentId: String(res.body.clientSecret).split('_secret_')[0],
      amount: res.body.amount,
    };
  }

  // Stripe tells us the PaymentIntent succeeded, for `amount` cents.
  function webhookSucceeded(intentId: string, amount?: number) {
    const { payload, signature } = signedWebhook(
      paymentIntentEvent(
        'payment_intent.succeeded',
        t.stripe.succeed(intentId, amount),
      ),
    );
    return t
      .http()
      .post('/api/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(payload);
  }

  // The same event, but Stripe's own record of the PaymentIntent is left as
  // it was: the money is still on its way when our expiry job asks Stripe to
  // cancel it. This is the race inside our backend, between the webhook
  // handler and the expiry job; neither side can see the other's outcome.
  function webhookSucceededInFlight(intentId: string) {
    const intent = t.stripe.intents.get(intentId)!;
    const { payload, signature } = signedWebhook(
      paymentIntentEvent('payment_intent.succeeded', {
        ...intent,
        status: 'succeeded',
        amountReceived: intent.amount,
      }),
    );
    return t
      .http()
      .post('/api/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(payload);
  }

  const refunded = async (bookingId: string) =>
    (
      await t
        .model(Refund.name)
        .find({ bookingId: new Types.ObjectId(bookingId) })
        .lean<any[]>()
    ).reduce((sum, r) => sum + r.amount, 0);

  async function holdFlight(who: Actor, flightId: string) {
    const res = await setup(who.agent.post('/api/flight-bookings/hold'))
      .send({
        outboundFlightId: flightId,
        cabin: 'Economy',
        passengers: [ADULT],
      })
      .expect(201);
    return idOf(res.body);
  }

  // A hotel set up over HTTP, as in production: created by the admin, with
  // policies, one room and a bookable range set by its moderator.
  async function newHotel(pricePerNight: number, refundPercent: number) {
    const hotelId = idOf(
      (
        await setup(adminActor.agent.post('/api/hotels'))
          .send({
            name: `TEST Hotel ${new Types.ObjectId()}`,
            address: '1 Nile St',
            cityId: 'cairo',
            countryCode: 'EG',
            starClass: 4,
          })
          .expect(201)
      ).body,
    );
    const mod = await hotelModerator(t, hotelId);
    await setup(mod.agent.put(`/api/hotels/${hotelId}/policies`))
      .send({
        checkInTime: '14:00',
        checkOutTime: '12:00',
        cancellationTiers: [{ daysBefore: 0, refundPercent }],
      })
      .expect(200);
    const roomId = idOf(
      (
        await setup(mod.agent.post(`/api/hotels/${hotelId}/rooms`))
          .send({
            name: 'R1',
            type: 'Room',
            beds: 2,
            maxOccupancy: 2,
            pricePerNight,
          })
          .expect(201)
      ).body,
    );
    await setup(
      mod.agent.post(`/api/hotels/${hotelId}/rooms/${roomId}/availability`),
    )
      .send({ from: '2099-01-01', to: '2099-12-31' })
      .expect(201);
    return { hotelId, roomId };
  }

  const bookRoom = (
    who: Actor,
    h: { hotelId: string; roomId: string },
    night: string,
    next: string,
  ) =>
    who.agent.post('/api/hotel-bookings').send({
      hotelId: h.hotelId,
      checkIn: night,
      checkOut: next,
      rooms: [{ roomId: h.roomId, adults: 1, childAges: [] }],
    });

  // ---------------------------------------------------------------------
  describe('a payment and a hold expiry at the same moment', () => {
    // FLT-22, HTL-18: a hold that is not paid in time becomes Expired and its
    // inventory is released. PAY-01: a booking is Confirmed only when its
    // payment succeeded. So when both happen at once, exactly one of two
    // outcomes is allowed: Confirmed with the inventory booked and the money
    // kept, or Expired with the inventory free and the money given back.
    // Never both, never neither. Each race runs 20 times.
    const RUNS = 20;
    // The expiry job starts 0 to 9 ms after the webhook (each offset twice),
    // so the two meet at a different point of each other's work. Measured
    // locally: up to about 4 ms the expiry wins (Expired), after that the
    // webhook does (Confirmed); both writes overlap around the crossover.
    // Both outcomes are allowed, so the test does not depend on where the
    // crossover falls on a faster or slower machine.
    const later = (ms: number, fn: () => Promise<unknown>) =>
      new Promise((resolve, reject) =>
        setTimeout(() => fn().then(resolve, reject), ms),
      );

    it('flights: Confirmed with the seat booked, or Expired with the seat free and a full refund [partial: FLT-22, PAY-01]', async () => {
      const airlineId = await createAirline(t);
      const wrong: string[] = [];
      for (let i = 0; i < RUNS; i++) {
        const flight = await createFlight(t, { airlineId, seats: 1 });
        const id = await holdFlight(payer, String(flight._id));
        const { intentId, amount } = await pay(payer, 'flight', id);
        await bookingModel('flight').updateOne(
          { _id: id },
          { $set: { expiresAt: new Date(Date.now() - 1000) } },
        );

        const [webhook] = await Promise.all([
          webhookSucceededInFlight(intentId),
          later(i % 10, () => t.app.get(FlightBookingJobs).expireHolds()),
        ]);

        const status = (await bookingModel('flight').findById(id).lean<any>())
          .status;
        const cabin = (
          await t.model(Flight.name).findById(flight._id).lean<any>()
        ).cabins[0];
        const back = await refunded(id);
        const confirmed =
          status === BookingStatus.CONFIRMED &&
          cabin.bookedSeats === 1 &&
          cabin.heldSeats === 0 &&
          back === 0;
        const expired =
          status === BookingStatus.EXPIRED &&
          cabin.bookedSeats === 0 &&
          cabin.heldSeats === 0 &&
          back === amount;
        if (webhook.status >= 300 || !(confirmed || expired)) {
          wrong.push(
            `run ${i}: webhook ${webhook.status}, ${status}, booked ${cabin.bookedSeats}, held ${cabin.heldSeats}, refunded ${back} of ${amount}`,
          );
        }
      }
      expect(wrong).toEqual([]);
    });

    it('hotels: Confirmed with the night taken, or Expired with the night free and a full refund [partial: HTL-18, PAY-01]', async () => {
      const hotel = await newHotel(10000, 100);
      const probe = await traveler(t, 'TEST Probe');
      const wrong: string[] = [];
      for (let i = 0; i < RUNS; i++) {
        const night = `2099-03-${pad(i + 1)}`;
        const next = `2099-03-${pad(i + 2)}`;
        const id = idOf(
          (await setup(bookRoom(payer, hotel, night, next)).expect(201)).body,
        );
        const { intentId, amount } = await pay(payer, 'hotel', id);
        await bookingModel('hotel').updateOne(
          { _id: id },
          { $set: { expiresAt: new Date(Date.now() - 1000) } },
        );

        const [webhook] = await Promise.all([
          webhookSucceededInFlight(intentId),
          later(i % 10, () => t.app.get(HotelBookingJobs).expireHolds()),
        ]);

        const status = (await bookingModel('hotel').findById(id).lean<any>())
          .status;
        const back = await refunded(id);
        // The night is free exactly when another guest can now hold it.
        const another = await bookRoom(probe, hotel, night, next);
        const confirmed =
          status === BookingStatus.CONFIRMED &&
          another.status === 409 &&
          back === 0;
        const expired =
          status === BookingStatus.EXPIRED &&
          another.status === 201 &&
          back === amount;
        if (webhook.status >= 300 || !(confirmed || expired)) {
          wrong.push(
            `run ${i}: webhook ${webhook.status}, ${status}, another guest ${another.status}, refunded ${back} of ${amount}`,
          );
        }
      }
      expect(wrong).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------
  it('a "succeeded" webhook for less than the booking total confirms nothing [partial: PAY-01]', async () => {
    // PAY-01: the booking is confirmed only when its payment succeeded; a
    // PaymentIntent that received less than the total did not pay it.
    const airlineId = await createAirline(t);
    const flight = await createFlight(t, { airlineId, seats: 2 });
    const hotel = await newHotel(10000, 100);
    const rows: [BookingType, () => Promise<string>][] = [
      ['flight', () => holdFlight(payer, String(flight._id))],
      [
        'hotel',
        async () =>
          idOf(
            (
              await setup(
                bookRoom(payer, hotel, '2099-04-01', '2099-04-02'),
              ).expect(201)
            ).body,
          ),
      ],
    ];
    const answers: string[] = [];
    for (const [type, hold] of rows) {
      const id = await hold();
      const { intentId, amount } = await pay(payer, type, id);
      const webhook = await webhookSucceeded(intentId, amount - 1);
      const status = (await bookingModel(type).findById(id).lean<any>()).status;
      answers.push(
        `${type}: webhook ${webhook.status < 300 ? '2xx' : webhook.status}, ${status}`,
      );
    }
    expect(answers).toEqual([
      `flight: webhook 2xx, ${BookingStatus.PENDING_PAYMENT}`,
      `hotel: webhook 2xx, ${BookingStatus.PENDING_PAYMENT}`,
    ]);
    // The seat is still only held, never booked.
    const cabin = (await t.model(Flight.name).findById(flight._id).lean<any>())
      .cabins[0];
    expect([cabin.bookedSeats, cabin.heldSeats]).toEqual([0, 1]);
  });

  // ---------------------------------------------------------------------
  it('a refund percentage that is not a whole cent is still a whole number of cents, within one cent, and recorded as shown [partial: PAY-04, PAY-03, FLT-09, HTL-10]', async () => {
    // 50% of 333.33 USD is 166.665 USD. PAY-04 and conventions.md keep money
    // in integer cents; which way to round is spec question #287, so only
    // "whole cents, within one cent of the exact amount" is asserted.
    const total = 33333;
    const exact = total / 2;

    const airlineId = await createAirline(t);
    const flightMod = await airlineModerator(t, airlineId);
    await setup(
      flightMod.agent.put(`/api/airlines/${airlineId}/cancellation-policy`),
    )
      .send({ tiers: [{ daysBefore: 0, refundPercent: 50 }] })
      .expect(200);
    const flight = await createFlight(t, { airlineId, seats: 2, price: total });
    const hotel = await newHotel(total, 50);

    const rows: [BookingType, () => Promise<string>][] = [
      ['flight', () => holdFlight(payer, String(flight._id))],
      [
        'hotel',
        async () =>
          idOf(
            (
              await setup(
                bookRoom(payer, hotel, '2099-05-01', '2099-05-02'),
              ).expect(201)
            ).body,
          ),
      ],
    ];
    const answers: string[] = [];
    for (const [type, hold] of rows) {
      const id = await hold();
      const { intentId } = await pay(payer, type, id);
      await webhookSucceeded(intentId).expect(200);
      const base = `/api/${type}-bookings/${id}`;
      const shown = (await payer.agent.get(`${base}/cancellation`).expect(200))
        .body.refundAmount;
      await payer.agent
        .post(`${base}/cancel`)
        .send({ refundAmount: shown })
        .expect(200);
      const recorded = await refunded(id);
      answers.push(
        `${type}: whole cents ${Number.isInteger(shown)}, within one cent ${Math.abs(shown - exact) < 1}, recorded as shown ${recorded === shown}`,
      );
    }
    expect(answers).toEqual([
      'flight: whole cents true, within one cent true, recorded as shown true',
      'hotel: whole cents true, within one cent true, recorded as shown true',
    ]);
  });

  // ---------------------------------------------------------------------
  it("a flight leaving New York at 22:00 is found on its New York date, not its UTC date, and shown in each airport's time [partial: FLT-11, GEN-06]", async () => {
    // FLT-11: search by the local date at the departure airport. GEN-06 and
    // conventions.md: times are entered and shown in each airport's local
    // time and stored in UTC. New York is behind UTC, so 22:00 on 5 Dec is
    // already 6 Dec in UTC (CLAUDE.md: never assume UTC+).
    const airlineId = idOf(
      (
        await setup(adminActor.agent.post('/api/airlines'))
          .send({ name: 'TEST Atlantic', code: 'Z9Q' })
          .expect(201)
      ).body,
    );
    const mod = await airlineModerator(t, airlineId);
    const flightId = idOf(
      (
        await setup(mod.agent.post('/api/flights'))
          .send({
            flightNumber: 'Z9Q101',
            from: 'JFK',
            to: 'LHR',
            departureLocal: '2099-12-05T22:00',
            arrivalLocal: '2099-12-06T10:00',
          })
          .expect(201)
      ).body,
    );
    await setup(mod.agent.post(`/api/flights/${flightId}/cabins`))
      .send({
        category: 'Economy',
        totalSeats: 5,
        price: 50000,
        freeBags: 1,
        maxKgPerBag: 23,
      })
      .expect(201);

    const stored = await t.model(Flight.name).findById(flightId).lean<any>();
    const found = async (date: string) =>
      JSON.stringify(
        (
          await t
            .http()
            .get('/api/flights/search')
            .query({ from: 'JFK', to: 'LHR', date, passengers: 1 })
            .expect(200)
        ).body,
      ).includes(flightId);
    const details = JSON.stringify(
      (await t.http().get(`/api/flights/${flightId}`).expect(200)).body,
    );

    expect({
      storedUtc: stored.departureAt.toISOString(),
      onNewYorkDate: await found('2099-12-05'),
      onUtcDate: await found('2099-12-06'),
      departureShown:
        details.includes('2099-12-05T22:00') &&
        details.includes('America/New_York'),
      arrivalShown:
        details.includes('2099-12-06T10:00') &&
        details.includes('Europe/London'),
    }).toEqual({
      storedUtc: '2099-12-06T03:00:00.000Z',
      onNewYorkDate: true,
      onUtcDate: false,
      departureShown: true,
      arrivalShown: true,
    });
  });

  // ---------------------------------------------------------------------
  it('the FX API key never reaches a response, whether FXRatesAPI answers, fails or cannot be reached [partial: ITN-18]', async () => {
    // CLAUDE.md (non-negotiable): the FXRatesAPI key stays in the backend.
    const user = await traveler(t, 'TEST Budget');
    const itinerary = idOf(
      (
        await setup(user.agent.post('/api/itineraries'))
          .send({
            title: 'TEST FX trip',
            countries: ['EG'],
            startDate: '2099-12-01',
          })
          .expect(201)
      ).body,
    );
    await setup(user.agent.post(`/api/itineraries/${itinerary}/days`))
      .send({ cityId: 'cairo' })
      .expect(201);
    const it0 = await t.model('Itinerary').findById(itinerary).lean<any>();
    await setup(
      user.agent.post(
        `/api/itineraries/${itinerary}/days/${it0.days[0]._id}/budgets`,
      ),
    )
      .send({ category: 'food', amount: 10, currency: 'EUR' })
      .expect(201);

    const fx = t.app.get(ExchangeRatesService) as any;
    const keysSent: string[] = [];
    const api = () =>
      nock('https://api.fxratesapi.com')
        .get('/latest')
        .query((q) => {
          keysSent.push(String(q.api_key ?? ''));
          return true;
        });
    const cases: [string, () => void][] = [
      [
        'answers',
        () =>
          api().reply(200, {
            success: true,
            date: '2099-01-01',
            rates: {
              USD: 1,
              EUR: 0.5,
              EGP: 50,
              GBP: 0.8,
              AED: 3.67,
              JPY: 150,
              SAR: 3.75,
            },
          }),
      ],
      [
        'fails, echoing the key',
        () =>
          api().reply(500, { success: false, error: `invalid key ${FX_KEY}` }),
      ],
      [
        'cannot be reached',
        () =>
          api().replyWithError(
            `connect ECONNREFUSED https://api.fxratesapi.com/latest?api_key=${FX_KEY}`,
          ),
      ],
    ];
    const leaks: string[] = [];
    for (const [name, arrange] of cases) {
      await t.model('ExchangeRate').deleteMany({});
      fx.lastFailureAt = 0; // a fresh fetch for each case
      arrange();
      const res = await user.agent.get(
        `/api/itineraries/${itinerary}/budget-summary`,
      );
      if (JSON.stringify(res.body).includes(FX_KEY))
        leaks.push(`${name}: ${res.status} contains the key`);
      nock.cleanAll();
    }
    // The key really was in play: every case called the API with it.
    expect(keysSent).toEqual([FX_KEY, FX_KEY, FX_KEY]);
    expect(leaks).toEqual([]);
  });

  // ---------------------------------------------------------------------
  it('every admin action writes an audit log entry naming the admin and what was acted on (GEN-07)', async () => {
    // GEN-07: an audit log of admin actions (suspensions, deletions). GEN-10,
    // ACC-07a, ACC-13 and ACC-15 define the other admin actions.
    const user = await traveler(t, 'TEST Audited User');
    const author = await traveler(t, 'TEST Audited Author');
    const reporter = await traveler(t, 'TEST Reporter');
    const airlineId = String(await createAirline(t));
    const moderator = await airlineModerator(t, airlineId);
    const hotelId = (await newHotel(10000, 100)).hotelId;

    const post = async (title: string) =>
      idOf(
        (
          await setup(author.agent.post('/api/posts'))
            .send({
              title: `TEST ${title}`,
              body: 'TEST body',
              status: 'Published',
            })
            .expect(201)
        ).body,
      );
    const report = async (postId: string) =>
      idOf(
        (
          await setup(reporter.agent.post('/api/reports'))
            .send({ targetType: 'post', targetId: postId, reason: 'TEST spam' })
            .expect(201)
        ).body,
      );
    const p = {
      hidden: await post('hidden directly'),
      deleted: await post('deleted directly'),
      dismissed: await post('report dismissed'),
      reportHidden: await post('hidden from a report'),
      reportDeleted: await post('deleted from a report'),
    };
    const r = {
      dismissed: await report(p.dismissed),
      hidden: await report(p.reportHidden),
      deleted: await report(p.reportDeleted),
    };
    const newModeratorEmail = testEmail('new-mod');
    const a = adminActor.agent;

    // [what, audit action, the request, ids the entry may name as its target]
    const rows: [string, string, () => any, () => Promise<string[]>][] = [
      [
        'suspend a user',
        'ACCOUNT_SUSPENDED',
        () =>
          a
            .patch(`/api/admin/accounts/${user.id}/suspend`)
            .send({ reason: 'TEST' }),
        async () => [user.id],
      ],
      [
        'reactivate a user',
        'ACCOUNT_REACTIVATED',
        () => a.patch(`/api/admin/accounts/${user.id}/reactivate`).send({}),
        async () => [user.id],
      ],
      [
        'suspend a moderator',
        'ACCOUNT_SUSPENDED',
        () =>
          a
            .patch(`/api/admin/accounts/${moderator.id}/suspend`)
            .send({ reason: 'TEST' }),
        async () => [moderator.id],
      ],
      [
        'reset a password',
        'PASSWORD_RESET',
        () =>
          a
            .post(`/api/admin/users/${user.id}/reset-password`)
            .send({ temporaryPassword: 'TempPass123' }),
        async () => [user.id],
      ],
      [
        'create a moderator',
        'MODERATOR_CREATED',
        () =>
          a.post('/api/admin/moderators').send({
            name: 'TEST New Mod',
            email: newModeratorEmail,
            role: 'hotel_moderator',
            providerId: hotelId,
            temporaryPassword: 'TempPass123',
          }),
        async () => {
          const created = await t
            .model('User')
            .findOne({ email: newModeratorEmail })
            .lean<any>();
          return created ? [String(created._id)] : [];
        },
      ],
      [
        'deactivate an airline',
        'PROVIDER_DEACTIVATED',
        () =>
          a
            .patch(`/api/admin/providers/airline/${airlineId}/deactivate`)
            .send({ reason: 'TEST' }),
        async () => [airlineId],
      ],
      [
        'reactivate an airline',
        'PROVIDER_REACTIVATED',
        () =>
          a
            .patch(`/api/admin/providers/airline/${airlineId}/reactivate`)
            .send({}),
        async () => [airlineId],
      ],
      [
        'hide a post',
        'CONTENT_HIDDEN',
        () =>
          a
            .patch(`/api/admin/content/post/${p.hidden}/hide`)
            .send({ hidden: true }),
        async () => [p.hidden],
      ],
      [
        'delete a post',
        'CONTENT_DELETED',
        () => a.delete(`/api/admin/content/post/${p.deleted}`),
        async () => [p.deleted],
      ],
      [
        'dismiss a report',
        'REPORT_DISMISSED',
        () =>
          a
            .patch(`/api/admin/reports/${r.dismissed}`)
            .send({ action: 'dismiss' }),
        async () => [r.dismissed, p.dismissed],
      ],
      [
        'hide reported content',
        'CONTENT_HIDDEN',
        () =>
          a.patch(`/api/admin/reports/${r.hidden}`).send({ action: 'hide' }),
        async () => [r.hidden, p.reportHidden],
      ],
      [
        'delete reported content',
        'CONTENT_DELETED',
        () =>
          a.patch(`/api/admin/reports/${r.deleted}`).send({ action: 'delete' }),
        async () => [r.deleted, p.reportDeleted],
      ],
    ];

    const wrong: string[] = [];
    for (const [what, action, send, targets] of rows) {
      const res = await send();
      if (res.status >= 300) {
        wrong.push(
          `${what}: ${res.status} ${JSON.stringify(res.body?.message)}`,
        );
        continue;
      }
      const ids = await targets();
      const log = await a
        .get('/api/admin/audit-logs')
        .query({ action, adminId: adminActor.id })
        .expect(200);
      const entries: any[] = log.body.data ?? [];
      const found = entries.some(
        (e) =>
          ids.includes(String(e.targetId)) &&
          String(e.adminId) === adminActor.id,
      );
      if (!found)
        wrong.push(
          `${what}: no ${action} entry naming ${ids.join(' or ')} and the admin`,
        );
    }
    expect(wrong).toEqual([]);
  });
});
