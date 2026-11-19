import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { Role } from '../common/enums/role.enum';
import { AuthUser } from '../common/types/auth-user.type';
import {
  csvField,
  CSV_HEADER,
  FlightPassengersService,
  MODERATOR_VISIBLE,
  ON_BOARD,
  toCsv,
} from './flight-passengers.service';

// FLT-29: an airline moderator's bookings and passenger list per flight.
describe("A flight's bookings and passengers (FLT-29)", () => {
  const AIRLINE = '6735a1f4c1a2b3c4d5e6f601';
  const moderator: AuthUser = {
    id: '6735a1f4c1a2b3c4d5e6f002',
    role: Role.AIRLINE_MODERATOR,
    assignedProviderId: AIRLINE,
  };
  const FLIGHT = new Types.ObjectId('6735a1f4c1a2b3c4d5e6f701');
  const flight = {
    _id: FLIGHT,
    airlineId: new Types.ObjectId(AIRLINE),
    flightNumber: 'MS777',
    from: 'CAI',
    to: 'CDG',
    departureAt: new Date('2026-12-05T08:00:00.000Z'),
    status: 'Scheduled',
    cabins: [
      { category: 'Economy', totalSeats: 150, bookedSeats: 42, heldSeats: 2 },
      { category: 'Business', totalSeats: 20, bookedSeats: 20, heldSeats: 0 },
    ],
  };

  function setup(rows: unknown[] = [], getOwned?: jest.Mock) {
    const bookings = {
      aggregate: jest.fn<Promise<unknown[]>, [any[]]>(async () => rows),
      countDocuments: jest.fn(async () => rows.length),
    };
    const flights = { getOwned: getOwned ?? jest.fn(async () => flight) };
    return {
      service: new FlightPassengersService(bookings as any, flights as any),
      bookings,
      flights,
    };
  }

  describe('GET /flights/:id/bookings', () => {
    it("checks the flight is the moderator's own, then lists its paid bookings newest first", async () => {
      const { service, bookings, flights } = setup([{ _id: 'b1' }]);
      const result = await service.listBookings(moderator, String(FLIGHT), {
        page: 2,
        limit: 10,
      });
      expect(flights.getOwned).toHaveBeenCalledWith(moderator, String(FLIGHT));
      const pipeline = bookings.aggregate.mock.calls[0][0];
      expect(pipeline[0]).toEqual({
        $match: {
          'segments.flightId': FLIGHT,
          status: { $in: MODERATOR_VISIBLE },
        },
      });
      expect(MODERATOR_VISIBLE).toEqual([
        BookingStatus.CONFIRMED,
        BookingStatus.COMPLETED,
        BookingStatus.CANCELLED,
      ]);
      expect(pipeline[1]).toEqual({ $sort: { createdAt: -1, _id: -1 } });
      expect(pipeline[2]).toEqual({ $skip: 10 });
      expect(pipeline[3]).toEqual({ $limit: 10 });
      // Only names and types, no passports in the list.
      expect(JSON.stringify(pipeline)).not.toMatch(
        /passportNumber|dateOfBirth/,
      );
      expect(result.flight).toMatchObject({
        flightNumber: 'MS777',
        from: 'CAI',
      });
      expect(result.meta).toMatchObject({ page: 2, total: 1 });
    });

    it('shows seats remaining per cabin: total - booked - held', async () => {
      const { service } = setup();
      const result = await service.listBookings(moderator, String(FLIGHT), {
        page: 1,
        limit: 10,
      });
      expect(result.seats).toEqual([
        {
          category: 'Economy',
          totalSeats: 150,
          bookedSeats: 42,
          heldSeats: 2,
          remainingSeats: 106,
        },
        {
          category: 'Business',
          totalSeats: 20,
          bookedSeats: 20,
          heldSeats: 0,
          remainingSeats: 0,
        },
      ]);
    });

    it("another airline's flight (403) or an unknown one (404) lists nothing", async () => {
      for (const err of [
        new ForbiddenException('You can only manage your assigned provider'),
        new NotFoundException('Flight not found'),
      ]) {
        const { service, bookings } = setup(
          [],
          jest.fn(async () => Promise.reject(err)),
        );
        await expect(
          service.listBookings(moderator, String(FLIGHT), {
            page: 1,
            limit: 10,
          }),
        ).rejects.toBe(err);
        expect(bookings.aggregate).not.toHaveBeenCalled();
      }
    });
  });

  describe('GET /flights/:id/passengers/export', () => {
    it('one CSV row per passenger of the Confirmed and Completed bookings, by reference', async () => {
      const { service, bookings } = setup([
        {
          reference: 'FL-AAAAAAAA',
          status: 'Confirmed',
          cabin: 'Economy',
          passengers: [
            {
              fullName: 'Sara Ali',
              type: 'adult',
              dateOfBirth: '1995-01-01',
              passportNumber: 'A1234567',
            },
            {
              fullName: 'Mona Ali',
              type: 'child',
              dateOfBirth: '2018-05-05',
              passportNumber: 'B7654321',
            },
          ],
        },
      ]);
      const { filename, csv } = await service.exportPassengers(
        moderator,
        String(FLIGHT),
      );
      const pipeline = bookings.aggregate.mock.calls[0][0];
      expect(pipeline[0]).toEqual({
        $match: { 'segments.flightId': FLIGHT, status: { $in: ON_BOARD } },
      });
      expect(ON_BOARD).not.toContain(BookingStatus.CANCELLED);
      expect(pipeline[1]).toEqual({ $sort: { reference: 1, _id: 1 } });
      expect(filename).toBe('MS777-2026-12-05-passengers.csv');
      expect(csv.split('\r\n')).toEqual([
        CSV_HEADER.map((h) => `"${h}"`).join(','),
        '"FL-AAAAAAAA","Sara Ali","adult","1995-01-01","A1234567","Economy","Confirmed"',
        '"FL-AAAAAAAA","Mona Ali","child","2018-05-05","B7654321","Economy","Confirmed"',
        '',
      ]);
    });

    it('a flight with no passengers gives just the header', async () => {
      const { service } = setup([]);
      const { csv } = await service.exportPassengers(moderator, String(FLIGHT));
      expect(csv).toBe(CSV_HEADER.map((h) => `"${h}"`).join(',') + '\r\n');
    });
  });

  describe('CSV safety', () => {
    it('quotes every field and doubles quotes inside', () => {
      expect(csvField('Ali, "Junior"')).toBe('"Ali, ""Junior"""');
      expect(csvField(null)).toBe('""');
      expect(toCsv([['a', 1]])).toBe('"a","1"\r\n');
    });

    it('never lets a spreadsheet run a typed-in formula', () => {
      for (const evil of ['=HYPERLINK("x")', '+1+1', '-2+3', '@SUM(A1)']) {
        expect(csvField(evil).startsWith(`"'`)).toBe(true);
      }
      expect(csvField('Sara-Ali')).toBe('"Sara-Ali"');
    });
  });
});
