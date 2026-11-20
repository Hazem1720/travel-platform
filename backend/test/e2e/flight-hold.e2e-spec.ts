import { ConflictException } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { Airline } from '../../src/airlines/schemas/airline.schema';
import { BookingStatus } from '../../src/common/enums/booking-status.enum';
import { FlightQuoteDto } from '../../src/flight-bookings/dto/flight-quote.dto';
import { PassengerType } from '../../src/flight-bookings/flight-booking.rules';
import { renderETicket } from '../../src/flight-bookings/e-ticket.pdf';
import { FlightBookingJobs } from '../../src/flight-bookings/flight-booking.jobs';
import { FlightConfirmationService } from '../../src/flight-bookings/flight-confirmation.service';
import { Notification } from '../../src/notifications/schemas/notification.schema';
import { PaymentBookingType } from '../../src/payments/payment-handler';
import { PaymentsService } from '../../src/payments/payments.service';
import { FlightBookingsReaderService } from '../../src/flight-bookings/flight-bookings.reader.service';
import { FlightHoldService } from '../../src/flight-bookings/flight-hold.service';
import { FlightBooking } from '../../src/flight-bookings/schemas/flight-booking.schema';
import {
  CabinCategory,
  Flight,
  FlightStatus,
} from '../../src/flights/schemas/flight.schema';
import { createTestApp, TestApp } from './app';
import { CAIRO, createAirports, DUBAI } from './fixtures';

// FLT-22 against a real MongoDB: the atomic hold, the race for the last
// seat, the round-trip undo and expiry. Moved from test/flight-hold.e2e-spec.ts
// onto the harness: the services now come from the real app (app.get)
// instead of being built by hand, so the real wiring is tested too.
// This file stays a service-level test (plan 1, "HTTP rule"); the
// flight-booking suite repeats the key cases over HTTP.
describe('flight seat hold (FLT-22)', () => {
  let t: TestApp;
  let flights: Model<any>;
  let bookings: Model<any>;
  let hold: FlightHoldService;
  let airlineId: Types.ObjectId;
  const USER = String(new Types.ObjectId());

  beforeAll(async () => {
    t = await createTestApp('flight-hold');
    flights = t.model(Flight.name);
    bookings = t.model(FlightBooking.name);
    await createAirports(t, [CAIRO, DUBAI]);
    airlineId = (
      await t.model(Airline.name).create({
        name: 'TEST Nile Air',
        code: 'NP',
        extraBagPrice: 5000,
        maxExtraBags: 2,
      })
    )._id;
    hold = t.app.get(FlightHoldService);
  });

  afterAll(async () => t?.close());

  let n = 0;
  async function newFlight(
    seats: number,
    route: 'CAI-DXB' | 'DXB-CAI' = 'CAI-DXB',
    day = 2,
  ) {
    const [from, to] = route.split('-');
    const dep = new Date(Date.UTC(2099, 11, day, 10, 0));
    return flights.create({
      airlineId,
      flightNumber: `NP${100 + ++n}`,
      from,
      to,
      departureAt: dep,
      arrivalAt: new Date(dep.getTime() + 4 * 3600_000),
      departureDate: `2099-12-0${day}`,
      status: FlightStatus.SCHEDULED,
      cabins: [
        {
          category: CabinCategory.ECONOMY,
          totalSeats: seats,
          price: 20000,
          freeBags: 1,
          maxKgPerBag: 23,
        },
      ],
    });
  }

  const adult = {
    type: PassengerType.ADULT,
    fullName: 'TEST Sara Ali',
    dateOfBirth: '1990-01-01',
    passportNumber: 'A1234567',
  };
  const body = (
    flightId: Types.ObjectId,
    extra: Partial<FlightQuoteDto> = {},
  ): FlightQuoteDto => ({
    outboundFlightId: String(flightId),
    cabin: CabinCategory.ECONOMY,
    passengers: [adult],
    ...extra,
  });
  const cabinOf = async (id: Types.ObjectId) =>
    (await flights.findById(id).lean<any>()).cabins[0];

  it('creates a PendingPayment booking for 10 minutes with the price snapshot', async () => {
    const f = await newFlight(5);
    const before = Date.now();
    const b = await hold.hold(
      USER,
      body(f._id, { passengers: [adult, adult] }),
    );
    expect(b).toMatchObject({
      status: BookingStatus.PENDING_PAYMENT,
      totalAmount: 40000,
      reference: null,
    });
    expect(b.segments[0]).toMatchObject({
      seats: 2,
      cabinFare: 20000,
      fares: 40000,
    });
    const minutes = (new Date(b.expiresAt!).getTime() - before) / 60_000;
    expect(minutes).toBeGreaterThan(9.9);
    expect(minutes).toBeLessThan(10.1);
    expect(await cabinOf(f._id)).toMatchObject({
      heldSeats: 2,
      bookedSeats: 0,
    });
  });

  it('1 seat, two holds at the same moment: one wins, one 409, heldSeats = 1', async () => {
    const f = await newFlight(1);
    const results = await Promise.allSettled([
      hold.hold(USER, body(f._id)),
      hold.hold(USER, body(f._id)),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find(
      (r) => r.status === 'rejected',
    ) as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(ConflictException);
    expect((await cabinOf(f._id)).heldSeats).toBe(1);
    expect(await bookings.countDocuments({ 'segments.flightId': f._id })).toBe(
      1,
    );
  });

  it('10 seats, 40 holds at once: exactly 10 succeed', async () => {
    const f = await newFlight(10);
    const results = await Promise.allSettled(
      Array.from({ length: 40 }, () =>
        hold.reserve(String(f._id), String((f as any).cabins[0]._id), 1),
      ),
    );
    const won = results.filter(
      (r) => r.status === 'fulfilled' && r.value === true,
    );
    expect(won).toHaveLength(10);
    expect((await cabinOf(f._id)).heldSeats).toBe(10);
  });

  it('round trip whose return is full: 409 and the outbound seats are released', async () => {
    const out = await newFlight(5);
    const back = await newFlight(1, 'DXB-CAI', 9);
    await flights.updateOne(
      { _id: back._id },
      { $set: { 'cabins.0.bookedSeats': 1 } },
    );
    // The quote already sees 0 seats; make it pass so the atomic step decides.
    const quotes = (hold as any).quotes;
    const realQuote = quotes.quote.bind(quotes);
    jest
      .spyOn(quotes, 'quote')
      .mockImplementationOnce(async (dto: FlightQuoteDto) => {
        await flights.updateOne(
          { _id: back._id },
          { $set: { 'cabins.0.bookedSeats': 0 } },
        );
        const q = await realQuote(dto);
        await flights.updateOne(
          { _id: back._id },
          { $set: { 'cabins.0.bookedSeats': 1 } },
        );
        return q;
      });
    await expect(
      hold.hold(USER, body(out._id, { returnFlightId: String(back._id) })),
    ).rejects.toBeInstanceOf(ConflictException);
    expect((await cabinOf(out._id)).heldSeats).toBe(0);
    expect(
      await bookings.countDocuments({ 'segments.flightId': out._id }),
    ).toBe(0);
  });

  it('expiresAt in the past: Expired and heldSeats back to 0, once', async () => {
    const f = await newFlight(3);
    const b = await hold.hold(
      USER,
      body(f._id, { passengers: [adult, adult] }),
    );
    await bookings.updateOne(
      { _id: b._id },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );

    await hold.releaseExpiredHolds();
    await hold.expire(String(b._id)); // a second call changes nothing

    expect(await bookings.findById(b._id).lean()).toMatchObject({
      status: BookingStatus.EXPIRED,
    });
    expect((await cabinOf(f._id)).heldSeats).toBe(0);
  });

  it('a dead hold never blocks the last seat for the next user', async () => {
    const f = await newFlight(1);
    const first = await hold.hold(USER, body(f._id));
    await bookings.updateOne(
      { _id: first._id },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );

    const second = await hold.hold(USER, body(f._id));
    expect(second.status).toBe(BookingStatus.PENDING_PAYMENT);
    expect(await bookings.findById(first._id).lean()).toMatchObject({
      status: BookingStatus.EXPIRED,
    });
    expect((await cabinOf(f._id)).heldSeats).toBe(1);
  });

  it('never holds seats on a Cancelled flight', async () => {
    const f = await newFlight(5);
    await flights.updateOne(
      { _id: f._id },
      { $set: { status: FlightStatus.CANCELLED } },
    );
    expect(
      await hold.reserve(String(f._id), String((f as any).cabins[0]._id), 1),
    ).toBe(false);
  });

  it('Completed job: only bookings whose last segment has landed (GEN-11)', async () => {
    const jobs = t.app.get(FlightBookingJobs);
    const seg = (arrivalAt: Date) => ({
      flightId: new Types.ObjectId(),
      airlineId,
      flightNumber: 'NP999',
      from: 'CAI',
      to: 'DXB',
      departureAt: new Date(arrivalAt.getTime() - 4 * 3600_000),
      arrivalAt,
      cabinId: new Types.ObjectId(),
      cabin: CabinCategory.ECONOMY,
      seats: 1,
      cabinFare: 20000,
      fares: 20000,
      baggageFees: 0,
      subtotal: 20000,
    });
    const past = new Date(Date.now() - 3600_000);
    const future = new Date(Date.now() + 3600_000);
    const base = {
      userId: new Types.ObjectId(),
      passengers: [adult],
      totalAmount: 20000,
    };
    const [landed, roundTripHalfway, pending] = await bookings.create([
      { ...base, status: BookingStatus.CONFIRMED, segments: [seg(past)] },
      {
        ...base,
        status: BookingStatus.CONFIRMED,
        segments: [seg(past), seg(future)],
      },
      { ...base, status: BookingStatus.PENDING_PAYMENT, segments: [seg(past)] },
    ]);

    await jobs.completeLanded();

    const status = async (b: any) =>
      (await bookings.findById(b._id).lean<any>()).status;
    expect(await status(landed)).toBe(BookingStatus.COMPLETED);
    expect(await status(roundTripHalfway)).toBe(BookingStatus.CONFIRMED);
    expect(await status(pending)).toBe(BookingStatus.PENDING_PAYMENT);
  });

  it("reader: answers Hazem's and Hasan's questions (FLT-05, ACC-12)", async () => {
    const reader = t.app.get(FlightBookingsReaderService);
    const f = await newFlight(5);
    const other = await newFlight(5);
    const alice = String(new Types.ObjectId());
    const bob = String(new Types.ObjectId());

    expect(await reader.hasBookings(f._id)).toBe(false);
    const a = await hold.hold(alice, body(f._id));
    expect(await reader.hasBookings(f._id)).toBe(true);
    expect(await reader.hasBookings(other._id)).toBe(false);

    // Only Confirmed bookings count for notifications and account deletion.
    expect(await reader.confirmedUserIds(f._id)).toEqual([]);
    expect(await reader.hasUpcomingConfirmed(alice)).toBe(false);
    await bookings.updateOne(
      { _id: a._id },
      { $set: { status: BookingStatus.CONFIRMED } },
    );
    const b = await hold.hold(bob, body(f._id));
    await bookings.updateOne(
      { _id: b._id },
      { $set: { status: BookingStatus.CONFIRMED } },
    );
    await hold.hold(alice, body(f._id)); // a second booking: alice listed once

    expect((await reader.confirmedUserIds(f._id)).map(String).sort()).toEqual(
      [alice, bob].sort(),
    );
    expect(await reader.hasUpcomingConfirmed(alice)).toBe(true);
    // After the flight has left, nothing is upcoming.
    expect(
      await reader.hasUpcomingConfirmed(alice, new Date('2100-01-01')),
    ).toBe(false);
  });

  describe('after payment (FLT-23)', () => {
    let payments: PaymentsService;
    let confirmations: FlightConfirmationService;
    let notifications: Model<any>;

    beforeAll(() => {
      notifications = t.model(Notification.name);
      confirmations = t.app.get(FlightConfirmationService);
      // The app's real PaymentsService, with the flight handler that
      // FlightBookingsModule registered, as the Stripe webhook uses them.
      payments = t.app.get(PaymentsService);
    });

    it('Confirmed, FL- reference, held -> booked, notification, e-ticket', async () => {
      const f = await newFlight(5);
      const user = String(new Types.ObjectId());
      const b = await hold.hold(
        user,
        body(f._id, { passengers: [adult, adult] }),
      );
      await bookings.updateOne(
        { _id: b._id },
        { $set: { policiesAcceptedAt: new Date() } },
      );

      // PAY-01: the user may pay it, for exactly the held total.
      const payable = await payments.getPayableFor(
        PaymentBookingType.FLIGHT,
        String(b._id),
        user,
      );
      expect(payable.amount).toBe(40000);

      // The Stripe webhook, twice (Stripe may repeat an event).
      await payments.confirmBooking(PaymentBookingType.FLIGHT, String(b._id));
      await payments.confirmBooking(PaymentBookingType.FLIGHT, String(b._id));

      const saved = await bookings.findById(b._id).lean<any>();
      expect(saved.status).toBe(BookingStatus.CONFIRMED);
      expect(saved.reference).toMatch(/^FL-[A-Z0-9]{8}$/);
      expect(saved.expiresAt).toBeNull();
      expect(await cabinOf(f._id)).toMatchObject({
        heldSeats: 0,
        bookedSeats: 2,
      });

      const notes = await notifications
        .find({ userId: new Types.ObjectId(user) })
        .lean<any[]>();
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatchObject({
        type: 'BOOKING_CONFIRMED',
        readAt: null,
      });
      expect(notes[0].message).toContain(saved.reference);

      const view = await confirmations.getTicketData(user, String(b._id));
      expect(view.segments[0].departure.local).toBe('2099-12-02T12:00');
      const pdf = await renderETicket(view);
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    });

    it('an Expired booking cannot be confirmed (409) and its seats stay free', async () => {
      const f = await newFlight(1);
      const b = await hold.hold(USER, body(f._id));
      await bookings.updateOne(
        { _id: b._id },
        { $set: { expiresAt: new Date(Date.now() - 1000) } },
      );
      await hold.releaseExpiredHolds();

      await expect(
        payments.confirmBooking(PaymentBookingType.FLIGHT, String(b._id)),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(await cabinOf(f._id)).toMatchObject({
        heldSeats: 0,
        bookedSeats: 0,
      });
    });

    it('confirm and expire at the same moment: exactly one wins', async () => {
      const f = await newFlight(1);
      const b = await hold.hold(USER, body(f._id));
      const [c, e] = await Promise.allSettled([
        payments.confirmBooking(PaymentBookingType.FLIGHT, String(b._id)),
        payments.releaseInventory(PaymentBookingType.FLIGHT, String(b._id)),
      ]);
      const saved = await bookings.findById(b._id).lean<any>();
      const cabin = await cabinOf(f._id);
      // Exactly one of the two outcomes, checked as one expression so the
      // test never depends on which one won.
      const outcome = {
        status: saved.status,
        confirm: c.status,
        expire: e.status,
        heldSeats: cabin.heldSeats,
        bookedSeats: cabin.bookedSeats,
      };
      expect([
        {
          status: BookingStatus.CONFIRMED,
          confirm: 'fulfilled',
          expire: 'fulfilled',
          heldSeats: 0,
          bookedSeats: 1,
        },
        {
          status: BookingStatus.EXPIRED,
          confirm: c.status,
          expire: 'fulfilled',
          heldSeats: 0,
          bookedSeats: 0,
        },
      ]).toContainEqual(outcome);
    });

    it('e-ticket of a PendingPayment booking: 400; another user: 404', async () => {
      const f = await newFlight(2);
      const b = await hold.hold(USER, body(f._id));
      await expect(
        confirmations.getTicketData(USER, String(b._id)),
      ).rejects.toThrow('Confirmed');
      await expect(
        confirmations.getForOwner(String(new Types.ObjectId()), String(b._id)),
      ).rejects.toThrow('Booking not found');
    });
  });
});
