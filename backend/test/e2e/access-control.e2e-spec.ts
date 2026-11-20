import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import * as bcrypt from 'bcrypt';
import { getMetadataStorage } from 'class-validator';
import { readdirSync } from 'fs';
import { Types } from 'mongoose';
import { BookingStatus } from '../../src/common/enums/booking-status.enum';
import { FlightBooking } from '../../src/flight-bookings/schemas/flight-booking.schema';
import { SeatAssignment } from '../../src/flight-bookings/schemas/seat-assignment.schema';
import { HotelBooking } from '../../src/hotel-bookings/schemas/hotel-booking.schema';
import { Review } from '../../src/hotel-bookings/schemas/review.schema';
import { Post } from '../../src/blog/schemas/post.schema';
import { Comment } from '../../src/comments/schemas/comment.schema';
import { Favourite } from '../../src/favourites/schemas/favourite.schema';
import { Itinerary } from '../../src/itineraries/schemas/itinerary.schema';
import { Notification } from '../../src/notifications/schemas/notification.schema';
import { Payment } from '../../src/payments/schemas/payment.schema';
import { Refund } from '../../src/payments/schemas/refund.schema';
import { UploadsService } from '../../src/uploads/uploads.service';
import { User } from '../../src/users/schemas/user.schema';
import {
  Actor,
  admin,
  airlineModerator,
  hotelModerator,
  TEST_PASSWORD,
  testEmail,
  traveler,
} from './actors';
import { Access, ACCESS } from './access-table';
import {
  collectRoutes,
  createTestApp,
  RouteInfo,
  routeHandlers,
  TestApp,
} from './app';
import {
  createAirline,
  createFlight,
  createHotel,
  createRoom,
  seedReference,
  setup,
  TINY_PNG,
} from './fixtures';

// E2E_PLAN.md section 3, suite 1: access control, over real HTTP.
//   - guard sweep: every route's access matches the reviewed table
//     (access-table.ts); 401 without a session, 403 for another role;
//   - owner-only routes: another user gets 404, the same as for a record that
//     does not exist, and nothing changes;
//   - public routes show nothing private, draft or hidden;
//   - request bodies cannot set fields their DTO does not declare, and
//     query or body values cannot be MongoDB operators.

const oid = () => String(new Types.ObjectId());
// Drops what changes on every request, so two error bodies can be compared.
const errorOf = (body: any) => ({
  statusCode: body?.statusCode,
  error: body?.error,
  message: body?.message,
  details: body?.details,
});

// Every "id" or "_id" anywhere in a response, so a test can say exactly
// which records a public route shows, whatever the response's shape.
function idsIn(body: unknown): Set<string> {
  const ids = new Set<string>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) {
      if (
        (k === 'id' || k === '_id') &&
        (typeof x === 'string' || x instanceof Object)
      ) {
        ids.add(String(x));
      }
      walk(x);
    }
  };
  walk(body);
  return ids;
}

// A request on a route template with every :param filled in.
function fill(path: string, values: Record<string, string>): string {
  return path.replace(/:(\w+)/g, (_, name) => {
    if (!(name in values)) throw new Error(`no value for :${name} in ${path}`);
    return values[name];
  });
}

// The id of a created record: the API answers with "_id".
function idOf(body: any): string {
  const id = body?._id ?? body?.id;
  if (!id) throw new Error(`no id in ${JSON.stringify(body).slice(0, 200)}`);
  return String(id);
}

const call = (agent: any, method: string, url: string) =>
  agent[method.toLowerCase()](url);

describe('access control', () => {
  let t: TestApp;
  let routes: RouteInfo[];

  beforeAll(async () => {
    t = await createTestApp('access-control');
    routes = collectRoutes(t.app);
    await seedReference(t);
  });
  afterAll(async () => t?.close());

  // ---------------------------------------------------------------------
  describe('guard sweep', () => {
    // Guards run before pipes and handlers, so any well-formed value works.
    const DUMMY: Record<string, string> = {
      id: oid(),
      dayId: oid(),
      roomId: oid(),
      cabinId: oid(),
      linkId: oid(),
      imageId: 'image.png',
      file: '00000000-0000-0000-0000-000000000000.png',
      tag: 'travel',
      type: 'flight',
    };

    // The app's own decorators, in the table's terms.
    const accessInCode = (r: RouteInfo): string =>
      r.isPublic ? 'public' : r.roles.length ? r.roles.join('+') : 'any';

    it('every route the app serves has the access rule of the reviewed table [partial: GEN-13]', () => {
      const served = routes.map((r) => `${r.key}: ${accessInCode(r)}`);
      const reviewed = Object.entries(ACCESS).map(([k, v]) => `${k}: ${v}`);
      expect(served.sort()).toEqual(reviewed.sort());
    });

    // The sweeps use the table, not the decorators: a route that loses its
    // @Roles() is still expected to answer 403.
    const byAccess = (keep: (a: Access) => boolean) =>
      Object.entries(ACCESS)
        .filter(([, a]) => keep(a))
        .map(([key, access]) => {
          const [method, path] = key.split(' ');
          return { key, method, path, access };
        });

    it('every route that is not public answers 401 without a session, in the shared error format [partial: GEN-13]', async () => {
      const wrong: string[] = [];
      for (const r of byAccess((a) => a !== 'public')) {
        const res = await call(t.http(), r.method, fill(r.path, DUMMY));
        const ok =
          res.status === 401 &&
          res.body.statusCode === 401 &&
          res.body.error === 'Unauthorized' &&
          typeof res.body.message === 'string';
        if (!ok) wrong.push(`${r.key} -> ${res.status}`);
      }
      expect(wrong).toEqual([]);
    });

    it('every role-restricted route answers 403 to another role [partial: GEN-13]', async () => {
      // A traveler for admin and moderator routes; an admin for routes that
      // only registered users may call.
      const user = await traveler(t);
      const adminActor = await admin(t);
      const wrong: string[] = [];
      for (const r of byAccess((a) => a !== 'public' && a !== 'any')) {
        const actor = r.access === 'user' ? adminActor : user;
        const res = await call(actor.agent, r.method, fill(r.path, DUMMY));
        const ok =
          res.status === 403 &&
          res.body.message === 'You do not have permission for this action';
        if (!ok) wrong.push(`${r.key} -> ${res.status} ${res.body.message}`);
      }
      expect(wrong).toEqual([]);
    });

    it('stores passwords only as salted bcrypt hashes [partial: GEN-13]', async () => {
      const a = await traveler(t);
      const b = await traveler(t);
      const [ha, hb] = await Promise.all(
        [a, b].map(
          async (x) =>
            (
              await t
                .model(User.name)
                .findOne({ email: x.email })
                .select('+passwordHash')
                .lean<any>()
            ).passwordHash,
        ),
      );
      // Same password, different salts: different hashes, both valid.
      expect(ha).toMatch(/^\$2[aby]\$\d{2}\$.{53}$/);
      expect(hb).toMatch(/^\$2[aby]\$\d{2}\$.{53}$/);
      expect(ha).not.toBe(hb);
      expect(await bcrypt.compare(TEST_PASSWORD, ha)).toBe(true);
      expect(ha).not.toContain(TEST_PASSWORD);
    });
  });

  // ---------------------------------------------------------------------
  describe("another user's records", () => {
    // User A owns one of everything; user B tries every owner-only route on
    // it. ACC-11 and conventions.md (P-10): another user's booking or private
    // resource answers 404, exactly as for an id that does not exist, so B
    // learns nothing. For another user's public content (a published post, a
    // comment, a review) the spec says only that the owner may change it
    // (BLG-04, BLG-07, HTL-24), so 403 and 404 both pass. Either way nothing
    // may change.
    let a: Actor;
    let b: Actor;
    // A's records by name; bItinerary, bDay and bPost are B's own records.
    const ids: Record<string, string> = {};

    // 'like missing': any 4xx, but exactly the answer for an id that does
    // not exist (the status itself is an open spec question).
    type Expected = '404' | '403 or 404' | 'like missing';
    interface OwnedRoute {
      route: string; // "METHOD /api/path/:param", optionally "?query"
      params?: Record<string, string>; // :param -> a name in `ids`
      body?: (x: Record<string, string>) => object;
      upload?: boolean; // multipart with one PNG
      expected?: Expected; // default '404'
    }

    // Every owner-only route, for A's records. The test below fails if the
    // app serves a user route with an :id that is neither here nor in
    // NOT_OWNER_ONLY.
    const OWNED: OwnedRoute[] = [
      // Flight bookings (ACC-11)
      { route: 'GET /api/flight-bookings/:id' },
      { route: 'GET /api/flight-bookings/:id/cancellation' },
      {
        route: 'POST /api/flight-bookings/:id/cancel',
        body: () => ({ refundAmount: 0 }),
      },
      { route: 'GET /api/flight-bookings/:id/e-ticket' },
      { route: 'GET /api/flight-bookings/:id/seats' },
      {
        route: 'PATCH /api/flight-bookings/:id/seat',
        body: () => ({ segment: 0, passengerIndex: 0, seat: '1A' }),
      },
      {
        route: 'PATCH /api/flight-bookings/:id/change-flight',
        body: (x) => ({ outboundFlightId: x.otherFlight }),
      },
      // Hotel bookings (ACC-11)
      { route: 'GET /api/hotel-bookings/:id' },
      { route: 'GET /api/hotel-bookings/:id/cancellation' },
      {
        route: 'POST /api/hotel-bookings/:id/cancel',
        body: () => ({ refundAmount: 0 }),
      },
      {
        route: 'POST /api/hotel-bookings/:id/review',
        body: () => ({ rating: 5 }),
      },
      // Policies and payment, for both booking types (ACC-11, PAY-01)
      ...(['flight', 'hotel'] as const).flatMap((type) => [
        { route: 'GET /api/bookings/:type/:id/policies', params: { type } },
        {
          route: 'POST /api/bookings/:type/:id/accept-policies',
          params: { type },
          body: () => ({ accepted: true }),
        },
        { route: 'POST /api/bookings/:type/:id/pay', params: { type } },
        // B tries to pay A's booking by naming it in the body.
        {
          route: 'POST /api/payments',
          body: (x: Record<string, string>) => ({
            bookingType: type,
            bookingId: type === 'flight' ? x.flightBooking : x.hotelBooking,
          }),
        },
      ]),
      { route: 'GET /api/payments/:id', params: { id: 'payment' } },
      { route: 'POST /api/payments/:id/retry', params: { id: 'payment' } },
      { route: 'GET /api/refunds/:id', params: { id: 'refund' } },
      // Itineraries (ACC-11)
      { route: 'GET /api/itineraries/:id', params: { id: 'itinerary' } },
      {
        route: 'PATCH /api/itineraries/:id',
        params: { id: 'itinerary' },
        body: () => ({ title: 'TEST Taken over' }),
      },
      { route: 'DELETE /api/itineraries/:id', params: { id: 'itinerary' } },
      { route: 'POST /api/itineraries/:id/clone', params: { id: 'itinerary' } },
      {
        route: 'GET /api/itineraries/:id/bookings',
        params: { id: 'itinerary' },
      },
      {
        route: 'GET /api/itineraries/:id/budget-summary',
        params: { id: 'itinerary' },
      },
      { route: 'GET /api/itineraries/:id/pdf', params: { id: 'itinerary' } },
      {
        route: 'GET /api/itineraries/:id/hotels?groupIndex=0&guests=1',
        params: { id: 'itinerary' },
      },
      {
        route: 'GET /api/itineraries/:id/flights?origin=DXB',
        params: { id: 'itinerary' },
      },
      {
        route: 'POST /api/itineraries/:id/bookings',
        params: { id: 'itinerary' },
        body: (x) => ({
          type: 'flight',
          bookingId: x.confirmedFlightBooking,
          dayId: x.day,
        }),
      },
      // B links A's booking into B's own itinerary.
      {
        route: 'POST /api/itineraries/:id/bookings',
        params: { id: 'bItinerary' },
        body: (x) => ({
          type: 'flight',
          bookingId: x.confirmedFlightBooking,
          dayId: x.bDay,
        }),
      },
      {
        route: 'DELETE /api/itineraries/:id/bookings/:linkId',
        params: { id: 'itinerary', linkId: 'link' },
      },
      {
        route: 'POST /api/itineraries/:id/days',
        params: { id: 'itinerary' },
        body: () => ({ cityId: 'cairo' }),
      },
      {
        route: 'PATCH /api/itineraries/:id/days/reorder',
        params: { id: 'itinerary' },
        body: (x) => ({ dayId: x.day, newPosition: 1 }),
      },
      {
        route: 'PATCH /api/itineraries/:id/days/:dayId',
        params: { id: 'itinerary', dayId: 'day' },
        body: () => ({ notes: 'TEST taken over' }),
      },
      {
        route: 'DELETE /api/itineraries/:id/days/:dayId',
        params: { id: 'itinerary', dayId: 'day' },
      },
      {
        route: 'POST /api/itineraries/:id/days/:dayId/activities',
        params: { id: 'itinerary', dayId: 'day' },
        body: () => ({ name: 'TEST Intruder activity' }),
      },
      {
        route: 'POST /api/itineraries/:id/days/:dayId/budgets',
        params: { id: 'itinerary', dayId: 'day' },
        body: () => ({ category: 'food', amount: 10, currency: 'USD' }),
      },
      {
        route: 'POST /api/itineraries/:id/transport-costs',
        params: { id: 'itinerary' },
        body: (x) => ({
          mode: 'train',
          fromCityId: 'cairo',
          toCityId: 'cairo',
          amount: 10,
          currency: 'USD',
          dayId: x.day,
        }),
      },
      {
        route: 'PATCH /api/activities/:id',
        params: { id: 'activity' },
        body: () => ({ name: 'TEST Taken over' }),
      },
      { route: 'DELETE /api/activities/:id', params: { id: 'activity' } },
      {
        route: 'POST /api/activities/:id/images',
        params: { id: 'activity' },
        upload: true,
      },
      {
        route: 'DELETE /api/activities/:id/images/:imageId',
        params: { id: 'activity', imageId: 'activityImage' },
      },
      {
        route: 'PATCH /api/budgets/:id',
        params: { id: 'budget' },
        body: () => ({ amount: 99 }),
      },
      { route: 'DELETE /api/budgets/:id', params: { id: 'budget' } },
      {
        route: 'PATCH /api/transport-costs/:id',
        params: { id: 'transportCost' },
        body: () => ({ amount: 99 }),
      },
      {
        route: 'DELETE /api/transport-costs/:id',
        params: { id: 'transportCost' },
      },
      // Posts (BLG-04): A's draft is private (404); a published post is
      // public, so 403 or 404.
      {
        route: 'PATCH /api/posts/:id',
        params: { id: 'draftPost' },
        body: () => ({ title: 'TEST Taken over' }),
      },
      { route: 'DELETE /api/posts/:id', params: { id: 'draftPost' } },
      {
        route: 'PATCH /api/posts/:id',
        params: { id: 'post' },
        body: () => ({ title: 'TEST Taken over' }),
        expected: '403 or 404',
      },
      {
        route: 'DELETE /api/posts/:id',
        params: { id: 'post' },
        expected: '403 or 404',
      },
      {
        route: 'POST /api/posts/:id/images',
        params: { id: 'post' },
        upload: true,
        expected: '403 or 404',
      },
      {
        route: 'DELETE /api/posts/:id/images/:imageId',
        params: { id: 'post', imageId: 'postImage' },
        expected: '403 or 404',
      },
      {
        route: 'PATCH /api/posts/:id/itinerary',
        params: { id: 'post' },
        body: () => ({ itineraryId: null }),
        expected: '403 or 404',
      },
      // B attaches A's private itinerary to B's own post. BLG-13 does not
      // say which status refuses it (spec question #236); it must at least
      // answer exactly as for an itinerary that does not exist.
      {
        route: 'PATCH /api/posts/:id/itinerary',
        params: { id: 'bPost' },
        body: (x) => ({ itineraryId: x.itinerary }),
        expected: 'like missing',
      },
      // Comments (BLG-07) and reviews: public content, so 403 or 404.
      {
        route: 'PATCH /api/comments/:id',
        params: { id: 'comment' },
        body: () => ({ body: 'TEST taken over' }),
        expected: '403 or 404',
      },
      {
        route: 'DELETE /api/comments/:id',
        params: { id: 'comment' },
        expected: '403 or 404',
      },
      {
        route: 'PATCH /api/reviews/:id',
        params: { id: 'review' },
        body: () => ({ rating: 1 }),
        expected: '403 or 404',
      },
      {
        route: 'DELETE /api/reviews/:id',
        params: { id: 'review' },
        expected: '403 or 404',
      },
      // Favourites (BON-02) and notifications (GEN-01) are private to A.
      { route: 'DELETE /api/favourites/:id', params: { id: 'favourite' } },
      // B saves A's private itinerary as a favourite by naming it.
      {
        route: 'POST /api/favourites',
        body: (x) => ({ type: 'itinerary', id: x.itinerary }),
      },
      {
        route: 'PATCH /api/notifications/:id/read',
        params: { id: 'notification' },
      },
    ];

    // Reviewed: user routes with an :id that act on someone else's public
    // post by design, so they are not owner-only.
    const NOT_OWNER_ONLY: Record<string, string> = {
      'POST /api/posts/:id/comments':
        'BLG-05: anyone may comment on a published post',
      'POST /api/posts/:id/like': 'BLG-06: anyone may like a published post',
      'DELETE /api/posts/:id/like': "BLG-06: removes the caller's own like",
    };

    const keyOf = (r: OwnedRoute) => r.route.split('?')[0];
    const nameOf = (r: OwnedRoute) =>
      r.params ? `${r.route} (${Object.values(r.params).join(', ')})` : r.route;

    // The URL for a row, with :params taken from `source` (A's real ids, or
    // fresh ones that exist nowhere). :type is the booking type itself; :id
    // defaults to the row's booking.
    function urlFor(r: OwnedRoute, source: Record<string, string>): string {
      const template = r.route.split(' ')[1];
      const hotel =
        r.params?.type === 'hotel' || r.route.includes('/hotel-bookings/');
      const names = {
        id: hotel ? 'hotelBooking' : 'flightBooking',
        ...r.params,
      };
      const values: Record<string, string> = {};
      for (const [param, name] of Object.entries(names)) {
        values[param] = param === 'type' ? name : source[name];
      }
      return fill(template, values);
    }

    function send(actor: Actor, r: OwnedRoute, source: Record<string, string>) {
      const method = r.route.split(' ')[0];
      const req = call(actor.agent, method, urlFor(r, source));
      if (r.upload) return req.attach('images', TINY_PNG, 'TEST.png');
      return r.body ? req.send(r.body(source)) : req;
    }

    // Everything B could change, as JSON, plus the uploaded files.
    async function snapshot(): Promise<string> {
      const models = [
        FlightBooking,
        HotelBooking,
        Itinerary,
        Payment,
        Refund,
        SeatAssignment,
        Review,
        Post,
        Comment,
        Favourite,
        Notification,
      ];
      const docs = await Promise.all(
        models.map((m) => t.model(m.name).find().sort({ _id: 1 }).lean()),
      );
      let files: string[] = [];
      try {
        files = readdirSync(t.app.get(UploadsService).dir).sort();
      } catch {
        files = []; // no upload yet
      }
      return JSON.stringify({ docs, files });
    }

    beforeAll(async () => {
      a = await traveler(t, 'TEST Owner A');
      b = await traveler(t, 'TEST Other B');

      // Flights: A holds a seat over HTTP (PendingPayment) and has a second,
      // Confirmed booking to link to the itinerary.
      const airlineId = await createAirline(t);
      const flight = await createFlight(t, { airlineId, seats: 9 });
      const other = await createFlight(t, { airlineId, seats: 9, day: 3 });
      ids.otherFlight = String(other._id);
      const passenger = {
        type: 'adult',
        fullName: 'TEST Sara Ali',
        dateOfBirth: '1990-01-01',
        passportNumber: 'A1234567',
      };
      const hold = () =>
        setup(a.agent.post('/api/flight-bookings/hold'))
          .send({
            outboundFlightId: String(flight._id),
            cabin: 'Economy',
            passengers: [passenger],
          })
          .expect(201);
      ids.flightBooking = idOf((await hold()).body);
      ids.confirmedFlightBooking = idOf((await hold()).body);
      await t.model(FlightBooking.name).updateOne(
        { _id: ids.confirmedFlightBooking },
        {
          $set: {
            status: BookingStatus.CONFIRMED,
            reference: 'FL-TESTLINK',
            expiresAt: null,
          },
        },
      );

      // A payment for A's flight booking, over HTTP, and a refund record.
      await setup(
        a.agent.post(
          `/api/bookings/flight/${ids.flightBooking}/accept-policies`,
        ),
      )
        .send({ accepted: true })
        .expect(200);
      const payment = await setup(a.agent.post('/api/payments'))
        .send({ bookingType: 'flight', bookingId: ids.flightBooking })
        .expect(201);
      ids.payment = String(payment.body.paymentId);
      const refund = await t.model(Refund.name).create({
        bookingType: 'flight',
        bookingId: ids.flightBooking,
        userId: a.id,
        paymentId: ids.payment,
        amount: 100,
        currency: 'USD',
      });
      ids.refund = String(refund._id);

      // Hotels: A's PendingPayment reservation and a review of a Completed
      // stay (arranged; the hotel suites book and review over HTTP).
      const hotelId = await createHotel(t);
      const room = await createRoom(t, hotelId);
      const reservation = (status: BookingStatus) =>
        t.model(HotelBooking.name).create({
          userId: a.id,
          hotelId,
          hotelName: 'TEST Hotel',
          status,
          checkIn: '2099-12-01',
          checkOut: '2099-12-03',
          nights: 2,
          rooms: [
            {
              roomId: room._id,
              name: room.name,
              type: room.type,
              adults: 1,
              pricePerNight: 10000,
              subtotal: 20000,
            },
          ],
          totalAmount: 20000,
          expiresAt:
            status === BookingStatus.PENDING_PAYMENT
              ? new Date(Date.now() + 10 * 60_000)
              : null,
        });
      ids.hotelBooking = String(
        (await reservation(BookingStatus.PENDING_PAYMENT))._id,
      );
      const stay = await reservation(BookingStatus.COMPLETED);
      const review = await t.model(Review.name).create({
        hotelId,
        bookingId: stay._id,
        userId: a.id,
        rating: 4,
        text: 'TEST review',
      });
      ids.review = String(review._id);

      // A private itinerary with one of everything, built over HTTP.
      const itinerary = await setup(a.agent.post('/api/itineraries'))
        .send({
          title: 'TEST Private trip',
          countries: ['EG'],
          startDate: '2099-12-01',
        })
        .expect(201);
      ids.itinerary = idOf(itinerary.body);
      const base = `/api/itineraries/${ids.itinerary}`;
      await setup(a.agent.post(`${base}/days`))
        .send({ cityId: 'cairo' })
        .expect(201);
      const dayOf = async (id: string) =>
        String(
          (await t.model(Itinerary.name).findById(id).lean<any>()).days[0]._id,
        );
      ids.day = await dayOf(ids.itinerary);
      await setup(a.agent.post(`${base}/days/${ids.day}/activities`))
        .send({ name: 'TEST Pyramids' })
        .expect(201);
      await setup(a.agent.post(`${base}/days/${ids.day}/budgets`))
        .send({ category: 'food', amount: 20, currency: 'USD' })
        .expect(201);
      await setup(a.agent.post(`${base}/transport-costs`))
        .send({
          mode: 'train',
          fromCityId: 'cairo',
          toCityId: 'cairo',
          amount: 5,
          currency: 'USD',
          dayId: ids.day,
        })
        .expect(201);
      await setup(a.agent.post(`${base}/bookings`))
        .send({
          type: 'flight',
          bookingId: ids.confirmedFlightBooking,
          dayId: ids.day,
        })
        .expect(201);
      const saved = await t
        .model(Itinerary.name)
        .findById(ids.itinerary)
        .lean<any>();
      ids.activity = String(saved.days[0].activities[0]._id);
      ids.budget = String(saved.days[0].budgets[0]._id);
      ids.transportCost = String(saved.transportCosts[0]._id);
      ids.link = String(saved.linkedBookings[0]._id);
      await setup(a.agent.post(`/api/activities/${ids.activity}/images`))
        .attach('images', TINY_PNG, 'TEST.png')
        .expect(201);
      const withImage = await t
        .model(Itinerary.name)
        .findById(ids.itinerary)
        .lean<any>();
      ids.activityImage = withImage.days[0].activities[0].images[0]
        .split('/')
        .pop();

      // Posts: a draft, and a published post with an image and a comment.
      const post = (title: string, status: string) =>
        setup(a.agent.post('/api/posts'))
          .send({ title, body: 'TEST body', status })
          .expect(201)
          .then((res: any) => idOf(res.body));
      ids.draftPost = await post('TEST A draft', 'Draft');
      ids.post = await post('TEST A post', 'Published');
      await setup(a.agent.post(`/api/posts/${ids.post}/images`))
        .attach('images', TINY_PNG, 'TEST.png')
        .expect(201);
      const savedPost = await t.model(Post.name).findById(ids.post).lean<any>();
      ids.postImage = savedPost.images[0].split('/').pop();
      const comment = await setup(
        a.agent.post(`/api/posts/${ids.post}/comments`),
      )
        .send({ body: 'TEST comment' })
        .expect(201);
      ids.comment = idOf(comment.body);

      // A favourite and a notification.
      const favourite = await setup(a.agent.post('/api/favourites'))
        .send({ type: 'hotel', id: String(hotelId) })
        .expect(201);
      ids.favourite = idOf(favourite.body);
      const note = await t.model(Notification.name).create({
        userId: a.id,
        type: 'BOOKING_CONFIRMED',
        message: 'TEST notification',
      });
      ids.notification = String(note._id);

      // B's own itinerary (with a day) and post, for the rows where B names
      // A's records in a body.
      const bItinerary = await setup(b.agent.post('/api/itineraries'))
        .send({
          title: 'TEST B trip',
          countries: ['EG'],
          startDate: '2099-12-01',
        })
        .expect(201);
      ids.bItinerary = idOf(bItinerary.body);
      await setup(b.agent.post(`/api/itineraries/${ids.bItinerary}/days`))
        .send({ cityId: 'cairo' })
        .expect(201);
      ids.bDay = await dayOf(ids.bItinerary);
      const bPost = await setup(b.agent.post('/api/posts'))
        .send({ title: 'TEST B post', body: 'TEST body', status: 'Published' })
        .expect(201);
      ids.bPost = idOf(bPost.body);
    });

    it('the table lists every owner-only user route the app serves (ACC-11)', () => {
      // Every user route with an :id is owner-only unless reviewed otherwise.
      const userRoutesWithId = Object.entries(ACCESS)
        .filter(
          ([key, access]) =>
            (access === 'user' || access === 'any') && key.includes('/:'),
        )
        .map(([key]) => key);
      const listed = new Set(OWNED.map(keyOf));
      expect(
        userRoutesWithId.filter(
          (k) => !listed.has(k) && !(k in NOT_OWNER_ONLY),
        ),
      ).toEqual([]);
      const served = new Set(routes.map((r) => r.key));
      expect([...listed].filter((k) => !served.has(k))).toEqual([]);
      expect(Object.keys(NOT_OWNER_ONLY).filter((k) => listed.has(k))).toEqual(
        [],
      );
    });

    it("the owner reaches every read route of the table, so B's 404 is about ownership (ACC-11)", async () => {
      const wrong: string[] = [];
      for (const r of OWNED.filter((x) => x.route.startsWith('GET '))) {
        const res = await send(a, r, ids);
        if ([401, 403, 404].includes(res.status)) {
          wrong.push(
            `${nameOf(r)} -> ${res.status} ${res.body?.message ?? ''}`,
          );
        }
      }
      expect(wrong).toEqual([]);
    });

    it('another user is refused on every owner-only route (404 for private records, exactly as for an id that does not exist) and changes nothing (ACC-11) [partial: BLG-04, BLG-07, BON-02]', async () => {
      // A's ids replaced by fresh ones that exist nowhere; B's own stay.
      const missing = Object.fromEntries(
        Object.entries(ids).map(([k, v]) => [
          k,
          /^b[A-Z]/.test(k) ? v : k.endsWith('Image') ? 'missing.png' : oid(),
        ]),
      );
      // Every row is checked; all mismatches are reported together, each
      // with its route.
      const wrong: string[] = [];
      for (const r of OWNED) {
        const before = await snapshot();
        const real = await send(b, r, ids);
        const none = await send(b, r, missing);
        const expected = r.expected ?? '404';
        const allowed =
          expected === '404'
            ? [404]
            : expected === '403 or 404'
              ? [403, 404]
              : [400, 403, 404, 409, 422];
        const compareWithMissing =
          real.status === 404 || expected === 'like missing';
        if (!allowed.includes(real.status)) {
          wrong.push(
            `${nameOf(r)}: expected ${expected}, got ${real.status} ${JSON.stringify(real.body?.message)}`,
          );
        } else if (
          compareWithMissing &&
          (real.status !== none.status ||
            JSON.stringify(errorOf(real.body)) !==
              JSON.stringify(errorOf(none.body)))
        ) {
          wrong.push(
            `${nameOf(r)}: differs from a missing id: ${real.status} ${JSON.stringify(real.body.message)} vs ${none.status} ${JSON.stringify(none.body.message)}`,
          );
        }
        if ((await snapshot()) !== before)
          wrong.push(`${nameOf(r)}: changed data`);
      }
      expect(wrong).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------
  describe('public routes show nothing private, draft or hidden', () => {
    // One author with one of each kind of content. GEN-10: hidden content is
    // visible only to its author and admins. BLG-01, BLG-02: only published
    // posts are public. ITN-01, ITN-20: itineraries are private by default
    // and only public ones are shared.
    const word = `zq${Date.now().toString(36)}`; // matches only this suite's content
    const tag = `e2e-${word}`;
    const c: Record<string, string> = {};
    let author: Actor;
    let other: Actor;
    let adminActor: Actor;

    const hide = (type: string, id: string) =>
      setup(adminActor.agent.patch(`/api/admin/content/${type}/${id}/hide`))
        .send({ hidden: true })
        .expect(200);

    async function newPost(title: string, status: 'Published' | 'Draft') {
      const res = await setup(author.agent.post('/api/posts'))
        .send({
          title: `TEST ${word} ${title}`,
          body: 'TEST body',
          tags: [tag],
          status,
        })
        .expect(201);
      return idOf(res.body);
    }

    async function newItinerary(title: string, visibility: 'Public' | null) {
      const res = await setup(author.agent.post('/api/itineraries'))
        .send({
          title: `TEST ${word} ${title}`,
          countries: ['EG'],
          startDate: '2099-12-01',
        })
        .expect(201);
      const id = idOf(res.body);
      if (visibility) {
        await setup(author.agent.patch(`/api/itineraries/${id}`))
          .send({ visibility })
          .expect(200);
      }
      return id;
    }

    beforeAll(async () => {
      author = await traveler(t, 'TEST Author');
      other = await traveler(t, 'TEST Reader');
      adminActor = await admin(t);

      c.publishedPost = await newPost('published', 'Published');
      c.draftPost = await newPost('draft', 'Draft');
      c.hiddenPost = await newPost('hidden', 'Published');
      await hide('post', c.hiddenPost);

      const comment = async (body: string) =>
        idOf(
          (
            await setup(
              author.agent.post(`/api/posts/${c.publishedPost}/comments`),
            )
              .send({ body })
              .expect(201)
          ).body,
        );
      c.comment = await comment('TEST visible comment');
      c.hiddenComment = await comment('TEST hidden comment');
      await hide('comment', c.hiddenComment);

      c.privateItinerary = await newItinerary('private', null);
      c.publicItinerary = await newItinerary('public', 'Public');
      c.hiddenItinerary = await newItinerary('hidden', 'Public');
      await hide('itinerary', c.hiddenItinerary);

      // Two reviews of a hotel, from two Completed stays (arranged: the
      // hotel suites cover how a review is written); one is hidden. The
      // author writes the comments and reviews too, so "other user" is not
      // their author (GEN-10: an author still sees their own hidden content).
      const hotelId = await createHotel(t);
      c.hotel = String(hotelId);
      const room = await createRoom(t, hotelId);
      const stay = () =>
        t.model(HotelBooking.name).create({
          userId: author.id,
          hotelId,
          hotelName: 'TEST Hotel',
          status: BookingStatus.COMPLETED,
          checkIn: '2026-01-01',
          checkOut: '2026-01-02',
          nights: 1,
          rooms: [
            {
              roomId: room._id,
              name: room.name,
              type: room.type,
              adults: 1,
              pricePerNight: 10000,
              subtotal: 10000,
            },
          ],
          totalAmount: 10000,
        });
      const review = async (text: string) => {
        const booking = await stay();
        const saved = await t.model(Review.name).create({
          hotelId,
          bookingId: booking._id,
          userId: author.id,
          rating: 4,
          text,
        });
        return String(saved._id);
      };
      c.review = await review('TEST visible review');
      c.hiddenReview = await review('TEST hidden review');
      await hide('review', c.hiddenReview);
    });

    // Each public route, with the content it must show and must not show.
    const PUBLIC_VIEWS: {
      url: () => string;
      shows: string[];
      never: string[];
    }[] = [
      {
        url: () => `/api/posts?tag=${tag}`,
        shows: ['publishedPost'],
        never: ['draftPost', 'hiddenPost'],
      },
      {
        url: () => `/api/posts?search=${word}`,
        shows: ['publishedPost'],
        never: ['draftPost', 'hiddenPost'],
      },
      {
        url: () => `/api/tags/${tag}/posts`,
        shows: ['publishedPost'],
        never: ['draftPost', 'hiddenPost'],
      },
      {
        url: () => `/api/authors/${author.id}`,
        shows: ['publishedPost', 'publicItinerary'],
        never: [
          'draftPost',
          'hiddenPost',
          'privateItinerary',
          'hiddenItinerary',
        ],
      },
      {
        url: () => `/api/posts/${c.publishedPost}/comments`,
        shows: ['comment'],
        never: ['hiddenComment'],
      },
      {
        url: () => `/api/itineraries/public/search?keyword=${word}`,
        shows: ['publicItinerary'],
        never: ['privateItinerary', 'hiddenItinerary'],
      },
      {
        url: () => `/api/hotels/${c.hotel}/reviews`,
        shows: ['review'],
        never: ['hiddenReview'],
      },
    ];

    it('lists and pages show only published, public and not hidden content, to guests and other users [partial: GEN-10, BLG-02, BLG-09, BLG-12, ITN-21, HTL-24, BLG-05]', async () => {
      const wrong: string[] = [];
      const viewers = [
        ['guest', () => t.http()],
        ['other user', () => other.agent],
      ] as const;
      for (const [who, agent] of viewers) {
        for (const view of PUBLIC_VIEWS) {
          const res = await agent().get(view.url());
          const seen = idsIn(res.body);
          if (res.status !== 200)
            wrong.push(`${who} ${view.url()}: ${res.status}`);
          for (const name of view.shows) {
            if (!seen.has(c[name]))
              wrong.push(`${who} ${view.url()}: missing ${name}`);
          }
          for (const name of view.never) {
            if (seen.has(c[name]))
              wrong.push(`${who} ${view.url()}: shows ${name}`);
          }
        }
      }
      expect(wrong).toEqual([]);
    });

    it('a draft, hidden or private item answers 404 on its own page, to guests and other users (ITN-20) [partial: GEN-10, BLG-01, ITN-01]', async () => {
      const pages: [string, string][] = [
        ['draftPost', '/api/posts/'],
        ['hiddenPost', '/api/posts/'],
        ['privateItinerary', '/api/itineraries/public/'],
        ['hiddenItinerary', '/api/itineraries/public/'],
        ['publishedPost', '/api/posts/'],
        ['publicItinerary', '/api/itineraries/public/'],
      ];
      const statuses: string[] = [];
      for (const agent of [() => t.http(), () => other.agent]) {
        for (const [name, prefix] of pages) {
          const res = await agent().get(prefix + c[name]);
          statuses.push(`${name} ${res.status}`);
        }
      }
      const expected = [
        'draftPost 404',
        'hiddenPost 404',
        'privateItinerary 404',
        'hiddenItinerary 404',
        'publishedPost 200',
        'publicItinerary 200',
      ];
      expect(statuses).toEqual([...expected, ...expected]);
    });

    it('the author still sees their draft and hidden content, and an admin sees hidden content [partial: GEN-10, BLG-03]', async () => {
      const mine = idsIn(
        (await author.agent.get('/api/posts/mine').expect(200)).body,
      );
      expect(
        ['publishedPost', 'draftPost', 'hiddenPost'].filter(
          (n) => !mine.has(c[n]),
        ),
      ).toEqual([]);
      await author.agent
        .get(`/api/itineraries/${c.hiddenItinerary}`)
        .expect(200);
      await author.agent
        .get(`/api/itineraries/${c.privateItinerary}`)
        .expect(200);
      const ownComments = idsIn(
        (
          await author.agent
            .get(`/api/posts/${c.publishedPost}/comments`)
            .expect(200)
        ).body,
      );
      const ownReviews = idsIn(
        (await author.agent.get(`/api/hotels/${c.hotel}/reviews`).expect(200))
          .body,
      );
      expect([
        ownComments.has(c.hiddenComment),
        ownReviews.has(c.hiddenReview),
      ]).toEqual([true, true]);

      const adminSees: string[] = [];
      for (const [type, name] of [
        ['post', 'hiddenPost'],
        ['comment', 'hiddenComment'],
        ['itinerary', 'hiddenItinerary'],
        ['review', 'hiddenReview'],
      ]) {
        const res = await adminActor.agent.get(
          `/api/admin/content/${type}/${c[name]}`,
        );
        adminSees.push(`${name} ${res.status}`);
      }
      expect(adminSees).toEqual([
        'hiddenPost 200',
        'hiddenComment 200',
        'hiddenItinerary 200',
        'hiddenReview 200',
      ]);
    });

    it('a public itinerary is read-only to other users (ITN-20)', async () => {
      const before = await t
        .model(Itinerary.name)
        .findById(c.publicItinerary)
        .lean();
      await other.agent
        .patch(`/api/itineraries/${c.publicItinerary}`)
        .send({ title: 'TEST Taken over' })
        .expect(404);
      await other.agent
        .delete(`/api/itineraries/${c.publicItinerary}`)
        .expect(404);
      expect(
        await t.model(Itinerary.name).findById(c.publicItinerary).lean(),
      ).toEqual(before);
    });

    it('setting an itinerary back to Private removes it from public view at once (ITN-20)', async () => {
      // Its own itinerary, so the other tests (in random order) keep theirs.
      const id = await newItinerary('made private', 'Public');
      const shown = async (url: string) =>
        idsIn((await t.http().get(url).expect(200)).body).has(id);
      const search = `/api/itineraries/public/search?keyword=${word}`;
      const authorPage = `/api/authors/${author.id}`;
      expect(await shown(search)).toBe(true);
      expect(await shown(authorPage)).toBe(true);
      await t.http().get(`/api/itineraries/public/${id}`).expect(200);

      await author.agent
        .patch(`/api/itineraries/${id}`)
        .send({ visibility: 'Private' })
        .expect(200);

      expect(await shown(search)).toBe(false);
      expect(await shown(authorPage)).toBe(false);
      await t.http().get(`/api/itineraries/public/${id}`).expect(404);
    });
  });

  // ---------------------------------------------------------------------
  describe('request bodies and queries', () => {
    // GEN-13: the backend enforces the rules whatever the client sends. A
    // caller must not be able to give itself a role, a provider, a status or
    // another owner by adding a field to a request body.
    const SENSITIVE_FIELDS: Record<string, unknown> = {
      role: 'admin',
      assignedProviderId: oid(),
      status: 'active',
      userId: oid(),
      ownerId: oid(),
      authorId: oid(),
    };

    // Reviewed: the DTOs that declare one of those fields on purpose. The
    // test below fails if one is added or removed, so the change is reviewed.
    const DECLARED_ON_PURPOSE = [
      'POST /api/admin/moderators: role', // ACC-13: the admin picks the moderator type
      'POST /api/posts: status', // BLG-01: save as Draft or Publish
      'PATCH /api/posts/:id: status', // BLG-01, BLG-04
    ];

    // Reviewed: the only routes that read the raw request instead of a DTO.
    const RAW_REQUEST_READERS = [
      'POST /api/auth/logout', // ACC-06: reads the cookies only
      'POST /api/auth/refresh', // ACC-06: reads the cookies only
      'POST /api/payments/webhook', // PAY-01: the raw body, for the Stripe signature
    ];

    const WRITE = /^(POST|PATCH|PUT) /;
    // RouteParamtypes: REQUEST = 0, BODY = 3 (@nestjs/common).
    const REQUEST = 0;
    const BODY = 3;

    // A route's whole-body DTO, if it has one, and whether it reads the raw
    // request object.
    function bodyOf(key: string) {
      const { controller, method } = routeHandlers(t.app).get(key)!;
      const args: Record<string, { index: number; data?: unknown }> =
        Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, method) ?? {};
      const types: any[] =
        Reflect.getMetadata(
          'design:paramtypes',
          controller.prototype,
          method,
        ) ?? [];
      const ofType = (type: number) =>
        Object.entries(args)
          .filter(([k]) => Number(k.split(':')[0]) === type)
          .map(([, v]) => v);
      const body = ofType(BODY);
      const dto =
        body.length === 1 && body[0].data === undefined
          ? types[body[0].index]
          : null;
      const declared = dto
        ? [
            ...new Set(
              getMetadataStorage()
                .getTargetValidationMetadatas(dto, '', true, false)
                .map((m) => m.propertyName),
            ),
          ]
        : [];
      return { body, dto, declared, readsRequest: ofType(REQUEST).length > 0 };
    }

    // Valid enough for every :param, so only the body decides the answer.
    function paramsFor(path: string): Record<string, string> {
      const type = path.startsWith('/api/admin/content/')
        ? 'post'
        : path.startsWith('/api/admin/providers/')
          ? 'airline'
          : 'flight';
      return { id: oid(), dayId: oid(), roomId: oid(), cabinId: oid(), type };
    }

    let actors: Record<string, Actor>;
    beforeAll(async () => {
      actors = {
        user: await traveler(t),
        admin: await admin(t),
        airline_moderator: await airlineModerator(t, oid()),
        hotel_moderator: await hotelModerator(t, oid()),
      };
    });
    const agentFor = (r: RouteInfo) =>
      r.isPublic ? t.http() : actors[r.roles[0] ?? 'user'].agent;

    it('every write route reads its body only through one validated DTO [partial: GEN-13]', () => {
      const wrong: string[] = [];
      const rawReaders: string[] = [];
      for (const r of routes.filter((x) => WRITE.test(x.key))) {
        const { body, dto, declared, readsRequest } = bodyOf(r.key);
        if (readsRequest) rawReaders.push(r.key);
        if (body.length && (!dto || dto === Object || declared.length === 0)) {
          wrong.push(`${r.key}: @Body without a validated DTO class`);
        }
      }
      expect(wrong).toEqual([]);
      expect(rawReaders.sort()).toEqual([...RAW_REQUEST_READERS].sort());
    });

    it('refuses a body field the DTO does not declare, so no caller can set a role, provider, status or owner [partial: GEN-13, ACC-01]', async () => {
      const wrong: string[] = [];
      const declaredOnPurpose: string[] = [];
      for (const r of routes.filter((x) => WRITE.test(x.key))) {
        const { dto, declared } = bodyOf(r.key);
        if (!dto) continue; // reads no body (checked above)
        const extra = Object.fromEntries(
          Object.entries(SENSITIVE_FIELDS).filter(
            ([f]) => !declared.includes(f),
          ),
        );
        for (const f of Object.keys(SENSITIVE_FIELDS)) {
          if (declared.includes(f)) declaredOnPurpose.push(`${r.key}: ${f}`);
        }
        const res = await call(
          agentFor(r),
          r.method,
          fill(r.path, paramsFor(r.path)),
        ).send(extra);
        for (const f of Object.keys(extra)) {
          const messages: string[] = res.body?.details?.[f] ?? [];
          if (
            res.status !== 400 ||
            !messages.some((m) => m.includes('should not exist'))
          ) {
            wrong.push(
              `${r.key}: ${f} -> ${res.status} ${JSON.stringify(messages)}`,
            );
          }
        }
      }
      expect(wrong).toEqual([]);
      expect(declaredOnPurpose.sort()).toEqual([...DECLARED_ON_PURPOSE].sort());
    });

    // "400 <field>" when the answer is a validation error on that field.
    const refusal = (res: any, field: string) =>
      `${res.status} ${res.body?.details?.[field] ? field : '(not refused)'}`;

    it('where a DTO declares such a field, only its allowed values pass [partial: ACC-13, BLG-01]', async () => {
      // ACC-13: a moderator is a hotel or airline moderator, never an admin.
      const moderator = await actors.admin.agent
        .post('/api/admin/moderators')
        .send({ role: 'admin' });
      // BLG-01: a post is a Draft or Published; hiding is the admin's (GEN-10).
      const newPost = await actors.user.agent
        .post('/api/posts')
        .send({ status: 'Hidden' });
      const editedPost = await actors.user.agent
        .patch(`/api/posts/${oid()}`)
        .send({ status: 'Hidden' });

      expect([
        refusal(moderator, 'role'),
        refusal(newPost, 'status'),
        refusal(editedPost, 'status'),
      ]).toEqual(['400 role', '400 status', '400 status']);
    });

    it('refuses MongoDB operators in a login body or a search query [partial: GEN-13]', async () => {
      const admins = actors.admin.agent;
      const cases: [string, string, () => any][] = [
        [
          'login',
          'email',
          () =>
            t
              .http()
              .post('/api/auth/login')
              .send({ email: { $gt: '' }, password: 'x' }),
        ],
        [
          'login',
          'password',
          () =>
            t
              .http()
              .post('/api/auth/login')
              .send({ email: testEmail(), password: { $ne: '' } }),
        ],
        [
          'forgot password',
          'email',
          () =>
            t
              .http()
              .post('/api/auth/forgot-password')
              .send({ email: { $gt: '' } }),
        ],
        ['posts', 'search', () => t.http().get('/api/posts?search[$ne]=x')],
        ['posts', 'tag', () => t.http().get('/api/posts?tag[$ne]=x')],
        [
          'public itineraries',
          'keyword',
          () =>
            t.http().get('/api/itineraries/public/search?keyword[$regex]=.*'),
        ],
        [
          'hotels',
          'city',
          () =>
            t
              .http()
              .get(
                '/api/hotels/search?city[$ne]=x&checkIn=2099-12-01&checkOut=2099-12-02&guests=1',
              ),
        ],
        [
          'flights',
          'from',
          () =>
            t
              .http()
              .get('/api/flights/search?from[$ne]=CAI&to=DXB&date=2099-12-02'),
        ],
        [
          'admin accounts',
          'search',
          () => admins.get('/api/admin/accounts?search[$regex]=.*'),
        ],
      ];
      const answers: string[] = [];
      for (const [name, field, send] of cases) {
        const res = await send();
        // An operator must never log anyone in.
        const session = /access_token=[^;]/.test(
          String(res.headers['set-cookie'] ?? ''),
        );
        answers.push(
          `${name}: ${refusal(res, field)}${session ? ' + SESSION' : ''}`,
        );
      }
      expect(answers).toEqual(
        cases.map(([name, field]) => `${name}: 400 ${field}`),
      );
    });
  });
});
