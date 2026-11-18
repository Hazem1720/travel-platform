import { ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { CabinCategory, FlightStatus } from '../flights/schemas/flight.schema';
import { PaymentBookingType } from '../payments/payment-handler';
import { PassengerType } from './flight-booking.rules';
import { FlightHoldService, NOT_ENOUGH_SEATS } from './flight-hold.service';

// FLT-22 with mocked models, for CI. The real atomic behaviour (two holds
// for one seat, 40 holds for 10 seats) runs against MongoDB in
// test/flight-hold.e2e-spec.ts.
describe('FlightHoldService (FLT-22)', () => {
  const USER = String(new Types.ObjectId());
  const OUT = String(new Types.ObjectId());
  const BACK = String(new Types.ObjectId());
  const CABIN = String(new Types.ObjectId());

  const segment = (flightId: string, n: string) => ({
    flightId,
    flightNumber: n,
    airline: {
      _id: String(new Types.ObjectId()),
      name: 'Nile Air',
      code: 'NP',
      logo: null,
    },
    from: { code: 'CAI' },
    to: { code: 'DXB' },
    departure: { utc: '2099-12-01T22:30:00.000Z' },
    arrival: { utc: '2099-12-02T02:30:00.000Z' },
    durationMinutes: 240,
    cabinId: CABIN,
    cabin: CabinCategory.ECONOMY,
    cabinFare: 20000,
    freeBags: 1,
    maxKgPerBag: 23,
    extraBagPrice: 5000,
  });
  const quoteFor = (segments: object[]) => ({
    segments,
    passengers: [
      {
        type: PassengerType.ADULT,
        fullName: 'Sara Ali',
        dateOfBirth: '1990-01-01',
        passportNumber: 'A1234567',
      },
    ],
    counts: { adults: 1, children: 0, infants: 0 },
    seats: 1,
    price: {
      currency: 'USD',
      segments: segments.map(() => ({
        passengers: [],
        fares: 20000,
        baggageFees: 0,
        subtotal: 20000,
      })),
      fares: 20000 * segments.length,
      baggageFees: 0,
      total: 20000 * segments.length,
    },
  });

  function setup(
    opts: {
      reserveResults?: number[];
      createFails?: boolean;
      pending?: object | null;
    } = {},
  ) {
    const results = [...(opts.reserveResults ?? [1, 1])];
    const flights = {
      updateOne: jest.fn(async (filter: any) => ({
        modifiedCount: filter.$expr ? (results.shift() ?? 1) : 1,
      })),
    };
    const bookings = {
      create: jest.fn(async (doc: object) => {
        if (opts.createFails) throw new Error('insert failed');
        return { toObject: () => ({ _id: new Types.ObjectId(), ...doc }) };
      }),
      find: jest.fn(() => ({
        lean: async () => [{ _id: new Types.ObjectId() }],
      })),
      findOneAndUpdate: jest.fn(() => ({
        lean: async () => ('pending' in opts ? opts.pending : null),
      })),
    };
    const quotes = {
      quote: jest.fn(async (dto: any) =>
        quoteFor(
          dto.returnFlightId
            ? [segment(OUT, 'NP101'), segment(BACK, 'NP102')]
            : [segment(OUT, 'NP101')],
        ),
      ),
    };
    const payments = { releaseInventory: jest.fn(async () => undefined) };
    const service = new FlightHoldService(
      bookings as any,
      flights as any,
      quotes as any,
      payments as any,
    );
    return { service, flights, bookings, quotes, payments };
  }
  const body = (extra: object = {}) =>
    ({
      outboundFlightId: OUT,
      cabin: CabinCategory.ECONOMY,
      passengers: [],
      ...extra,
    }) as any;

  it('reserves with one conditional update: seats free, flight bookable', async () => {
    const { service, flights } = setup();
    await service.hold(USER, body());
    const [filter, update, options] = (
      flights.updateOne.mock.calls as any[]
    )[0];
    expect(filter).toMatchObject({
      _id: new Types.ObjectId(OUT),
      status: FlightStatus.SCHEDULED,
    });
    expect(filter.departureAt.$gt).toBeInstanceOf(Date);
    expect(filter.$expr.$gte[1]).toBe(1);
    expect(update).toEqual({ $inc: { 'cabins.$[c].heldSeats': 1 } });
    expect(options).toEqual({
      arrayFilters: [{ 'c._id': new Types.ObjectId(CABIN) }],
    });
  });

  it('creates a PendingPayment booking with expiresAt in 10 minutes and the snapshot', async () => {
    const { service, bookings } = setup();
    const before = Date.now();
    await service.hold(USER, body());
    const doc = (bookings.create.mock.calls as any[])[0][0];
    expect(doc).toMatchObject({
      userId: new Types.ObjectId(USER),
      status: BookingStatus.PENDING_PAYMENT,
      totalAmount: 20000,
      currency: 'USD',
    });
    expect(doc.segments[0]).toMatchObject({
      flightNumber: 'NP101',
      seats: 1,
      cabinFare: 20000,
      subtotal: 20000,
    });
    expect(doc.expiresAt.getTime() - before).toBeGreaterThanOrEqual(
      10 * 60_000 - 50,
    );
    expect(doc.expiresAt.getTime() - before).toBeLessThanOrEqual(
      10 * 60_000 + 1000,
    );
  });

  it('answers 409 when the atomic update matches nothing', async () => {
    const { service, bookings } = setup({ reserveResults: [0] });
    await expect(service.hold(USER, body())).rejects.toThrow(NOT_ENOUGH_SEATS);
    expect(bookings.create).not.toHaveBeenCalled();
  });

  it('round trip with a full return: 409 and the outbound seats given back', async () => {
    const { service, flights } = setup({ reserveResults: [1, 0] });
    await expect(
      service.hold(USER, body({ returnFlightId: BACK })),
    ).rejects.toBeInstanceOf(ConflictException);
    const undo = (flights.updateOne.mock.calls as any[])[2];
    expect(undo[0]).toEqual({ _id: new Types.ObjectId(OUT) });
    expect(undo[1]).toEqual({ $inc: { 'cabins.$[c].heldSeats': -1 } });
    expect(flights.updateOne).toHaveBeenCalledTimes(3);
  });

  it('gives the seats back when saving the booking fails', async () => {
    const { service, flights } = setup({ createFails: true });
    await expect(service.hold(USER, body())).rejects.toThrow('insert failed');
    expect((flights.updateOne.mock.calls as any[])[1][1]).toEqual({
      $inc: { 'cabins.$[c].heldSeats': -1 },
    });
  });

  it('releases expired holds on these flights first, through payments', async () => {
    const { service, bookings, payments } = setup();
    await service.hold(USER, body());
    expect((bookings.find.mock.calls as any[])[0][0]).toMatchObject({
      status: BookingStatus.PENDING_PAYMENT,
      'segments.flightId': { $in: [new Types.ObjectId(OUT)] },
    });
    expect(payments.releaseInventory).toHaveBeenCalledWith(
      PaymentBookingType.FLIGHT,
      expect.any(String),
    );
  });

  it('expire(): only a PendingPayment booking changes, and its seats are released', async () => {
    const pending = {
      _id: new Types.ObjectId(),
      segments: [
        {
          flightId: new Types.ObjectId(OUT),
          cabinId: new Types.ObjectId(CABIN),
          seats: 2,
        },
      ],
    };
    const { service, bookings, flights } = setup({ pending });
    await service.expire(String(pending._id));
    expect((bookings.findOneAndUpdate.mock.calls as any[])[0][0]).toEqual({
      _id: String(pending._id),
      status: BookingStatus.PENDING_PAYMENT,
    });
    expect((flights.updateOne.mock.calls as any[])[0][1]).toEqual({
      $inc: { 'cabins.$[c].heldSeats': -2 },
    });
  });

  it('expire() twice: the second call changes nothing', async () => {
    const { service, flights } = setup({ pending: null });
    await service.expire(String(new Types.ObjectId()));
    expect(flights.updateOne).not.toHaveBeenCalled();
  });
});
