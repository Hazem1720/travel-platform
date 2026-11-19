import { Types } from 'mongoose';
import { Airline } from '../../src/airlines/schemas/airline.schema';
import {
  CabinCategory,
  Flight,
  FlightStatus,
} from '../../src/flights/schemas/flight.schema';
import { Hotel } from '../../src/hotels/schemas/hotel.schema';
import { Room } from '../../src/hotels/schemas/room.schema';
import { ReferenceSeedService } from '../../src/reference/reference-seed.service';
import { Airport } from '../../src/reference/schemas/reference.schemas';
import { TestApp } from './app';

// Arranging data that the API under test does not create itself. Every
// name starts with "TEST " (CLAUDE.md).

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

let hotelN = 0;

// An active hotel in Cairo. The hotel suites create hotels over HTTP; other
// suites only need one to exist.
export async function createHotel(
  t: TestApp,
  extra: Record<string, unknown> = {},
): Promise<Types.ObjectId> {
  hotelN += 1;
  const hotel = await t.model(Hotel.name).create({
    name: `TEST Hotel ${hotelN}`,
    address: `TEST ${hotelN} Nile Street`,
    cityId: 'cairo',
    countryCode: 'EG',
    starClass: 4,
    ...extra,
  });
  return hotel._id as Types.ObjectId;
}

export async function createRoom(
  t: TestApp,
  hotelId: Types.ObjectId,
  extra: Record<string, unknown> = {},
) {
  return t.model(Room.name).create({
    hotelId,
    name: `TEST Room ${++hotelN}`,
    type: 'Double',
    beds: 1,
    maxOccupancy: 2,
    pricePerNight: 10000,
    ...extra,
  });
}

// A valid 1x1 PNG, for upload routes.
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
