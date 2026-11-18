import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AddCabinDto } from './dto/add-cabin.dto';
import { CreateFlightDto } from './dto/create-flight.dto';
import { FlightStatusJob } from './flight-status.job';
import {
  availableSeats,
  bookableFilter,
  effectiveStatus,
  isBookable,
} from './flight-rules';
import { CabinCategory, FlightStatus } from './schemas/flight.schema';

// FLT-30: status and bookability.
describe('flight rules (FLT-30)', () => {
  const now = new Date('2026-12-01T12:00:00Z');
  const future = new Date('2026-12-01T12:02:00Z');
  const past = new Date('2026-12-01T11:59:00Z');

  it('only a Scheduled flight that has not departed is bookable', () => {
    const s = FlightStatus.SCHEDULED;
    expect(isBookable({ status: s, departureAt: future }, now)).toBe(true);
    expect(isBookable({ status: s, departureAt: past }, now)).toBe(false);
    expect(isBookable({ status: s, departureAt: now }, now)).toBe(false);
    for (const status of [FlightStatus.CANCELLED, FlightStatus.DEPARTED]) {
      expect(isBookable({ status, departureAt: future }, now)).toBe(false);
    }
  });

  it('shows a past Scheduled flight as Departed before the job runs', () => {
    const s = FlightStatus.SCHEDULED;
    expect(effectiveStatus({ status: s, departureAt: past }, now)).toBe(
      FlightStatus.DEPARTED,
    );
    expect(effectiveStatus({ status: s, departureAt: future }, now)).toBe(s);
    expect(
      effectiveStatus({ status: FlightStatus.CANCELLED, departureAt: past }),
    ).toBe(FlightStatus.CANCELLED);
  });

  it('gives a query filter with the same rule', () => {
    expect(bookableFilter(now)).toEqual({
      status: FlightStatus.SCHEDULED,
      departureAt: { $gt: now },
    });
  });

  it('counts available seats as total - booked - held', () => {
    expect(
      availableSeats({ totalSeats: 10, bookedSeats: 3, heldSeats: 2 }),
    ).toBe(5);
    expect(
      availableSeats({ totalSeats: 1, bookedSeats: 1, heldSeats: 1 }),
    ).toBe(0);
  });

  it('the job sets past Scheduled flights to Departed', async () => {
    const model = { updateMany: jest.fn(async () => ({ modifiedCount: 2 })) };
    const job = new FlightStatusJob(model as any);
    await expect(job.markDeparted(now)).resolves.toBe(2);
    expect(model.updateMany).toHaveBeenCalledWith(
      { status: FlightStatus.SCHEDULED, departureAt: { $lte: now } },
      { $set: { status: FlightStatus.DEPARTED } },
    );
  });
});

describe('flight DTOs (FLT-03, FLT-04)', () => {
  const errorsOf = async (cls: any, body: object) =>
    (await validate(plainToInstance(cls, body))).map((e) => e.property);

  const flight = {
    flightNumber: ' np101 ',
    from: 'cai',
    to: 'dxb',
    departureLocal: '2026-12-01T14:30',
    arrivalLocal: '2026-12-01T18:45',
  };

  it('accepts a flight and uppercases codes', async () => {
    expect(await errorsOf(CreateFlightDto, flight)).toEqual([]);
    expect(plainToInstance(CreateFlightDto, flight)).toMatchObject({
      flightNumber: 'NP101',
      from: 'CAI',
      to: 'DXB',
    });
  });

  it.each([
    ['departureLocal', '2026-12-01T14:30+02:00'],
    ['departureLocal', '2026-12-01 14:30'],
    ['from', 'CAIRO'],
    ['flightNumber', 'NP-101'],
  ])('rejects %s = %p', async (field, value) => {
    expect(
      await errorsOf(CreateFlightDto, { ...flight, [field]: value }),
    ).toEqual([field]);
  });

  const cabin = {
    category: 'Economy',
    totalSeats: 150,
    price: 25000,
    freeBags: 1,
    maxKgPerBag: 23,
  };

  it('accepts every category of the fixed set', async () => {
    for (const category of Object.values(CabinCategory)) {
      expect(await errorsOf(AddCabinDto, { ...cabin, category })).toEqual([]);
    }
  });

  it.each([
    ['category', 'Luxury'],
    ['totalSeats', 0],
    ['totalSeats', 2.5],
    ['price', 0],
    ['freeBags', -1],
    ['maxKgPerBag', 0],
  ])('rejects %s = %p', async (field, value) => {
    expect(await errorsOf(AddCabinDto, { ...cabin, [field]: value })).toEqual(
      [field],
    );
  });
});
