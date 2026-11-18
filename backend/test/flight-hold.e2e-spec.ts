import { ConflictException } from '@nestjs/common';
import { Connection, createConnection, Model, Types } from 'mongoose';
import { Airline, AirlineSchema } from '../src/airlines/schemas/airline.schema';
import { BookingStatus } from '../src/common/enums/booking-status.enum';
import { FlightQuoteDto } from '../src/flight-bookings/dto/flight-quote.dto';
import { PassengerType } from '../src/flight-bookings/flight-booking.rules';
import { FlightBookingJobs } from '../src/flight-bookings/flight-booking.jobs';
import { FlightHoldService } from '../src/flight-bookings/flight-hold.service';
import { FlightQuoteService } from '../src/flight-bookings/flight-quote.service';
import {
  FlightBooking,
  FlightBookingSchema,
} from '../src/flight-bookings/schemas/flight-booking.schema';
import { FlightsService } from '../src/flights/flights.service';
import {
  CabinCategory,
  Flight,
  FlightSchema,
  FlightStatus,
} from '../src/flights/schemas/flight.schema';
import {
  Airport,
  AirportSchema,
} from '../src/reference/schemas/reference.schemas';

// FLT-22 against a real MongoDB: the atomic hold, the race for the last
// seat, the round-trip undo and expiry. Runs only with E2E_MONGODB_URI (a
// throwaway database; it is dropped at the end), like the auth flow test.
const withDatabase = process.env.E2E_MONGODB_URI ? describe : describe.skip;

withDatabase('flight seat hold (FLT-22, database: E2E_MONGODB_URI)', () => {
  let conn: Connection;
  let flights: Model<any>;
  let bookings: Model<any>;
  let hold: FlightHoldService;
  let airlineId: Types.ObjectId;
  const USER = String(new Types.ObjectId());

  beforeAll(async () => {
    conn = await createConnection(
      process.env.E2E_MONGODB_URI!.replace(
        /\/[^/?]*(\?|$)/,
        '/flight-hold-e2e$1',
      ),
    ).asPromise();
    flights = conn.model(Flight.name, FlightSchema);
    bookings = conn.model(FlightBooking.name, FlightBookingSchema);
    const airlines = conn.model(Airline.name, AirlineSchema);
    const airports = conn.model(Airport.name, AirportSchema);
    await Promise.all([flights.init(), bookings.init()]);

    await airports.create([
      {
        _id: 'CAI',
        name: 'Cairo',
        cityId: 'cairo',
        countryCode: 'EG',
        timeZone: 'Africa/Cairo',
      },
      {
        _id: 'DXB',
        name: 'Dubai',
        cityId: 'dubai',
        countryCode: 'AE',
        timeZone: 'Asia/Dubai',
      },
    ]);
    airlineId = (
      await airlines.create({
        name: 'TEST Nile Air',
        code: 'NP',
        extraBagPrice: 5000,
        maxExtraBags: 2,
      })
    )._id;

    const views = new FlightsService(
      flights as any,
      airports as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const quotes = new FlightQuoteService(
      flights as any,
      airlines as any,
      views,
    );
    // PaymentsService.releaseInventory() calls the flight handler's expire().
    const payments = {
      releaseInventory: (_type: string, id: string) => hold.expire(id),
    };
    hold = new FlightHoldService(
      bookings as any,
      flights as any,
      quotes,
      payments as any,
    );
  });

  afterAll(async () => {
    await conn?.dropDatabase();
    await conn?.close();
  });

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
    const realQuote = (hold as any).quotes.quote.bind((hold as any).quotes);
    jest
      .spyOn((hold as any).quotes, 'quote')
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
    const jobs = new FlightBookingJobs(bookings as any, hold);
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
});
