import { Types } from 'mongoose';
import { Airline } from '../../src/airlines/schemas/airline.schema';
import {
  CabinCategory,
  Flight,
  FlightStatus,
} from '../../src/flights/schemas/flight.schema';
import { ReferenceSeedService } from '../../src/reference/reference-seed.service';
import { Airport } from '../../src/reference/schemas/reference.schemas';
import { TestApp } from './app';

// Arranging data that the API under test does not create itself. Every
// name starts with "TEST " (CLAUDE.md). Hotels and rooms get their builders
// with the hotel suites.

// GEN-12: the 8 cities, their countries, attractions and airports, seeded by
// the app's own seeder (it does not run on start in tests).
export async function seedReference(t: TestApp): Promise<void> {
  await t.app.get(ReferenceSeedService).seed();
}

export async function createAirports(
  t: TestApp,
  airports: {
    code: string;
    cityId: string;
    countryCode: string;
    timeZone: string;
  }[],
): Promise<void> {
  await t.model(Airport.name).create(
    airports.map((a) => ({
      _id: a.code,
      name: `TEST ${a.code}`,
      cityId: a.cityId,
      countryCode: a.countryCode,
      timeZone: a.timeZone,
    })),
  );
}

export const CAIRO = {
  code: 'CAI',
  cityId: 'cairo',
  countryCode: 'EG',
  timeZone: 'Africa/Cairo',
};
export const DUBAI = {
  code: 'DXB',
  cityId: 'dubai',
  countryCode: 'AE',
  timeZone: 'Asia/Dubai',
};

let airlineN = 0;

export async function createAirline(
  t: TestApp,
  extra: Record<string, unknown> = {},
): Promise<Types.ObjectId> {
  airlineN += 1;
  const code =
    String.fromCharCode(65 + (airlineN % 26)) +
    String.fromCharCode(65 + ((airlineN * 7) % 26));
  const airline = await t.model(Airline.name).create({
    name: `TEST Airline ${airlineN}`,
    code,
    extraBagPrice: 5000,
    maxExtraBags: 2,
    ...extra,
  });
  return airline._id as Types.ObjectId;
}

let flightN = 0;

// A scheduled flight with one Economy cabin, far in the future.
export async function createFlight(
  t: TestApp,
  {
    airlineId,
    from = 'CAI',
    to = 'DXB',
    seats = 5,
    price = 20000,
    day = 2,
  }: {
    airlineId: Types.ObjectId;
    from?: string;
    to?: string;
    seats?: number;
    price?: number;
    day?: number;
  },
) {
  const departureAt = new Date(Date.UTC(2099, 11, day, 10, 0));
  return t.model(Flight.name).create({
    airlineId,
    flightNumber: `NP${100 + ++flightN}`,
    from,
    to,
    departureAt,
    arrivalAt: new Date(departureAt.getTime() + 4 * 3600_000),
    departureDate: `2099-12-${String(day).padStart(2, '0')}`,
    status: FlightStatus.SCHEDULED,
    cabins: [
      {
        category: CabinCategory.ECONOMY,
        totalSeats: seats,
        price,
        freeBags: 1,
        maxKgPerBag: 23,
      },
    ],
  });
}
