import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Types } from 'mongoose';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { Role } from '../common/enums/role.enum';
import { AuthUser } from '../common/types/auth-user.type';
import {
  FlightBookingGroup,
  MyFlightBookingsQueryDto,
} from './dto/my-flight-bookings.dto';
import {
  FLIGHT_GROUP_SORT,
  flightGroupFilter,
  MyFlightBookingsService,
} from './my-flight-bookings.service';

// FLT-25: my flight bookings, grouped as Upcoming, Past and Cancelled.
describe('My flight bookings (FLT-25)', () => {
  const user: AuthUser = {
    id: '6735a1f4c1a2b3c4d5e6f001',
    role: Role.USER,
    assignedProviderId: null,
  };
  const userId = new Types.ObjectId(user.id);
  const NOW = new Date('2026-12-05T09:30:00.000Z');
  const notLanded = { $elemMatch: { arrivalAt: { $gt: NOW } } };

  describe('which tab a booking belongs in', () => {
    it('upcoming: Confirmed with a flight not landed yet, and payable holds', () => {
      expect(
        flightGroupFilter(FlightBookingGroup.UPCOMING, userId, NOW),
      ).toEqual({
        userId,
        $or: [
          { status: BookingStatus.CONFIRMED, segments: notLanded },
          { status: BookingStatus.PENDING_PAYMENT, expiresAt: { $gt: NOW } },
        ],
      });
    });

    it('past: Completed, and Confirmed whose flights have all landed', () => {
      expect(flightGroupFilter(FlightBookingGroup.PAST, userId, NOW)).toEqual({
        userId,
        $or: [
          { status: BookingStatus.COMPLETED },
          { status: BookingStatus.CONFIRMED, segments: { $not: notLanded } },
        ],
      });
    });

    it('cancelled: only Cancelled bookings', () => {
      expect(
        flightGroupFilter(FlightBookingGroup.CANCELLED, userId, NOW),
      ).toEqual({ userId, status: BookingStatus.CANCELLED });
    });
  });

  describe('MyFlightBookingsService.list', () => {
    function setup() {
      const bookings = {
        aggregate: jest.fn<Promise<unknown[]>, [any[]]>(async () => [
          { _id: 'b1' },
        ]),
        countDocuments: jest.fn(async () => 11),
      };
      return {
        service: new MyFlightBookingsService(bookings as any),
        bookings,
      };
    }

    it('reads only my bookings, in the tab I asked for, and counts with the same filter', async () => {
      const { service, bookings } = setup();
      await service.list(
        user,
        { group: FlightBookingGroup.PAST, page: 1, limit: 10 },
        NOW,
      );
      const expected = flightGroupFilter(FlightBookingGroup.PAST, userId, NOW);
      expect(bookings.aggregate.mock.calls[0][0][0]).toEqual({
        $match: expected,
      });
      expect(bookings.countDocuments).toHaveBeenCalledWith(expected);
    });

    it.each([
      [FlightBookingGroup.UPCOMING, { 'segments.departureAt': 1, _id: 1 }],
      [FlightBookingGroup.PAST, { 'segments.departureAt': -1, _id: -1 }],
      [FlightBookingGroup.CANCELLED, { cancelledAt: -1, _id: -1 }],
    ])('sorts %s as %j', async (group, sort) => {
      const { service, bookings } = setup();
      await service.list(user, { group, page: 1, limit: 10 }, NOW);
      expect(bookings.aggregate.mock.calls[0][0][1]).toEqual({ $sort: sort });
      expect(FLIGHT_GROUP_SORT[group]).toEqual(sort);
    });

    it('pages 10 at a time', async () => {
      const { service, bookings } = setup();
      const result = await service.list(
        user,
        { group: FlightBookingGroup.UPCOMING, page: 2, limit: 10 },
        NOW,
      );
      const pipeline = bookings.aggregate.mock.calls[0][0];
      expect(pipeline[2]).toEqual({ $skip: 10 });
      expect(pipeline[3]).toEqual({ $limit: 10 });
      expect(result.meta).toEqual({
        page: 2,
        limit: 10,
        total: 11,
        totalPages: 2,
      });
    });

    it('shows flight, dates, cabin and passenger names, never passports or birth dates', async () => {
      const { service, bookings } = setup();
      await service.list(
        user,
        { group: FlightBookingGroup.UPCOMING, page: 1, limit: 10 },
        NOW,
      );
      const project = bookings.aggregate.mock.calls[0][0][4].$project;
      expect(Object.keys(project.segments.$map.in)).toEqual([
        'flightNumber',
        'from',
        'to',
        'departureAt',
        'arrivalAt',
        'cabin',
      ]);
      expect(project.passengers.$map.in).toEqual({
        fullName: '$$p.fullName',
        type: '$$p.type',
      });
      expect(JSON.stringify(project)).not.toMatch(/passport|dateOfBirth/);
      expect(project).toMatchObject({ reference: 1, status: 1 });
    });
  });

  describe('MyFlightBookingsQueryDto', () => {
    const check = (q: object) =>
      validate(plainToInstance(MyFlightBookingsQueryDto, q), {
        whitelist: true,
        forbidNonWhitelisted: true,
      });

    it('defaults to upcoming, page 1, 10 per page', () => {
      expect(plainToInstance(MyFlightBookingsQueryDto, {})).toMatchObject({
        group: 'upcoming',
        page: 1,
        limit: 10,
      });
    });

    it('refuses an unknown tab, more than 10 per page and a sort parameter', async () => {
      const props = async (q: object) =>
        (await check(q)).map((e) => e.property);
      expect(await props({ group: 'past' })).toEqual([]);
      expect(await props({ group: 'all' })).toEqual(['group']);
      expect(await props({ limit: '11' })).toEqual(['limit']);
      expect(await props({ sort: 'createdAt:asc' })).toEqual(['sort']);
    });
  });
});
