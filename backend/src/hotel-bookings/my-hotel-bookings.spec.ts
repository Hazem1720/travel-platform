import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Types } from 'mongoose';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { Role } from '../common/enums/role.enum';
import { AuthUser } from '../common/types/auth-user.type';
import {
  MyHotelBookingsQueryDto,
  ReservationGroup,
} from './dto/my-hotel-bookings.dto';
import {
  GROUP_SORT,
  groupFilter,
  MyHotelBookingsService,
  utcToday,
} from './my-hotel-bookings.service';

// HTL-20: my hotel reservations, grouped as Upcoming, Past and Cancelled.
describe('My hotel reservations (HTL-20)', () => {
  const user: AuthUser = {
    id: '6735a1f4c1a2b3c4d5e6f001',
    role: Role.USER,
    assignedProviderId: null,
  };
  const userId = new Types.ObjectId(user.id);
  // 5 Dec 2026, 09:30 UTC.
  const NOW = new Date('2026-12-05T09:30:00.000Z');

  describe('which tab a reservation belongs in', () => {
    it("uses today's UTC date in the same YYYY-MM-DD form as the stay dates", () => {
      expect(utcToday(NOW)).toBe('2026-12-05');
      // Just before midnight UTC is still the same day.
      expect(utcToday(new Date('2026-12-05T23:59:59.999Z'))).toBe('2026-12-05');
    });

    it('upcoming: Confirmed stays not over yet, and holds still payable', () => {
      expect(groupFilter(ReservationGroup.UPCOMING, userId, NOW)).toEqual({
        userId,
        $or: [
          { status: BookingStatus.CONFIRMED, checkOut: { $gte: '2026-12-05' } },
          { status: BookingStatus.PENDING_PAYMENT, expiresAt: { $gt: NOW } },
        ],
      });
    });

    it('past: Completed stays, and Confirmed stays whose check-out has passed', () => {
      expect(groupFilter(ReservationGroup.PAST, userId, NOW)).toEqual({
        userId,
        $or: [
          { status: BookingStatus.COMPLETED },
          { status: BookingStatus.CONFIRMED, checkOut: { $lt: '2026-12-05' } },
        ],
      });
    });

    it('cancelled: only Cancelled reservations', () => {
      expect(groupFilter(ReservationGroup.CANCELLED, userId, NOW)).toEqual({
        userId,
        status: BookingStatus.CANCELLED,
      });
    });

    // The same rules, checked on concrete reservations: every reservation is
    // in exactly one tab, or in none if it was never paid.
    function tabsOf(r: {
      status: BookingStatus;
      checkOut: string;
      expiresAt?: Date | null;
    }): ReservationGroup[] {
      const today = utcToday(NOW);
      const matches = (f: any): boolean =>
        (f.$or ?? [f]).some(
          (c: any) =>
            c.status === r.status &&
            (!c.checkOut ||
              (c.checkOut.$gte !== undefined &&
                r.checkOut >= c.checkOut.$gte) ||
              (c.checkOut.$lt !== undefined && r.checkOut < c.checkOut.$lt)) &&
            (!c.expiresAt || (r.expiresAt ?? new Date(0)) > c.expiresAt.$gt),
        );
      expect(today).toBe('2026-12-05');
      return Object.values(ReservationGroup).filter((g) =>
        matches(groupFilter(g, userId, NOW)),
      );
    }

    it.each([
      ['a stay next week', ['upcoming'], BookingStatus.CONFIRMED, '2026-12-12'],
      [
        'a stay checking out today',
        ['upcoming'],
        BookingStatus.CONFIRMED,
        '2026-12-05',
      ],
      [
        'a stay that ended yesterday, not yet Completed',
        ['past'],
        BookingStatus.CONFIRMED,
        '2026-12-04',
      ],
      ['a Completed stay', ['past'], BookingStatus.COMPLETED, '2026-11-20'],
      [
        'a Cancelled reservation',
        ['cancelled'],
        BookingStatus.CANCELLED,
        '2026-12-20',
      ],
      ['an Expired hold (never paid)', [], BookingStatus.EXPIRED, '2026-12-20'],
    ] as const)('%s -> %j', (_label, expected, status, checkOut) => {
      expect(tabsOf({ status, checkOut })).toEqual(expected);
    });

    it('a hold still waiting for payment is upcoming; a dead one is nowhere', () => {
      const live = new Date(NOW.getTime() + 5 * 60_000);
      const dead = new Date(NOW.getTime() - 60_000);
      expect(
        tabsOf({
          status: BookingStatus.PENDING_PAYMENT,
          checkOut: '2026-12-20',
          expiresAt: live,
        }),
      ).toEqual(['upcoming']);
      expect(
        tabsOf({
          status: BookingStatus.PENDING_PAYMENT,
          checkOut: '2026-12-20',
          expiresAt: dead,
        }),
      ).toEqual([]);
    });
  });

  describe('MyHotelBookingsService.list', () => {
    function setup() {
      const bookings = {
        aggregate: jest.fn<Promise<unknown[]>, [any[]]>(async () => [
          { _id: 'r1' },
        ]),
        countDocuments: jest.fn(async () => 11),
      };
      return {
        service: new MyHotelBookingsService(bookings as any),
        bookings,
      };
    }

    it('reads only my reservations, in the tab I asked for', async () => {
      const { service, bookings } = setup();
      await service.list(
        user,
        { group: ReservationGroup.CANCELLED, page: 1, limit: 10 },
        NOW,
      );
      const expected = groupFilter(ReservationGroup.CANCELLED, userId, NOW);
      expect(bookings.aggregate.mock.calls[0][0][0]).toEqual({
        $match: expected,
      });
      // The count uses the same filter, so totalPages matches the rows.
      expect(bookings.countDocuments).toHaveBeenCalledWith(expected);
      // The id is compared as an ObjectId (aggregate does not convert it).
      expect(expected.userId).toBeInstanceOf(Types.ObjectId);
    });

    it.each([
      [ReservationGroup.UPCOMING, { checkIn: 1, _id: 1 }],
      [ReservationGroup.PAST, { checkOut: -1, _id: -1 }],
      [ReservationGroup.CANCELLED, { cancelledAt: -1, _id: -1 }],
    ])('sorts %s as %j', async (group, sort) => {
      const { service, bookings } = setup();
      await service.list(user, { group, page: 1, limit: 10 }, NOW);
      expect(bookings.aggregate.mock.calls[0][0][1]).toEqual({ $sort: sort });
      expect(GROUP_SORT[group]).toEqual(sort);
    });

    it('pages 10 at a time and reports the page count', async () => {
      const { service, bookings } = setup();
      const result = await service.list(
        user,
        { group: ReservationGroup.UPCOMING, page: 2, limit: 10 },
        NOW,
      );
      const pipeline = bookings.aggregate.mock.calls[0][0];
      expect(pipeline[2]).toEqual({ $skip: 10 });
      expect(pipeline[3]).toEqual({ $limit: 10 });
      expect(result).toEqual({
        data: [{ _id: 'r1' }],
        meta: { page: 2, limit: 10, total: 11, totalPages: 2 },
      });
    });

    it('returns the fields HTL-20 lists: reference, hotel, rooms, dates, guests, total, status', async () => {
      const { service, bookings } = setup();
      await service.list(
        user,
        { group: ReservationGroup.UPCOMING, page: 1, limit: 10 },
        NOW,
      );
      const project = bookings.aggregate.mock.calls[0][0][4].$project;
      expect(Object.keys(project)).toEqual(
        expect.arrayContaining([
          'reference',
          'hotelName',
          'rooms',
          'checkIn',
          'checkOut',
          'nights',
          'guests',
          'totalAmount',
          'currency',
          'status',
        ]),
      );
      // Rooms show their name and type only, not prices.
      expect(project.rooms.$map.in).toEqual({
        name: '$$r.name',
        type: '$$r.type',
      });
      expect(project.guests.adults).toEqual({ $sum: '$rooms.adults' });
    });
  });

  describe('MyHotelBookingsQueryDto', () => {
    const toDto = (q: object) => plainToInstance(MyHotelBookingsQueryDto, q);
    // The same options as the app's global ValidationPipe.
    const check = (q: object) =>
      validate(toDto(q), { whitelist: true, forbidNonWhitelisted: true });

    it('defaults to the upcoming tab, page 1, 10 per page', async () => {
      const dto = toDto({});
      expect(dto).toMatchObject({ group: 'upcoming', page: 1, limit: 10 });
      expect(await check({})).toHaveLength(0);
    });

    it('accepts each tab and turns page and limit into numbers', async () => {
      for (const group of ['upcoming', 'past', 'cancelled']) {
        expect(await check({ group, page: '2', limit: '5' })).toHaveLength(0);
      }
      expect(toDto({ page: '2' }).page).toBe(2);
    });

    it('refuses an unknown tab, a page below 1 and more than 10 per page', async () => {
      const props = async (q: object) =>
        (await check(q)).map((e) => e.property);
      expect(await props({ group: 'all' })).toEqual(['group']);
      expect(await props({ page: '0' })).toEqual(['page']);
      expect(await props({ limit: '11' })).toEqual(['limit']);
    });

    it('has no sort parameter: each tab has a fixed order', async () => {
      expect(await check({ sort: 'checkIn:asc' })).toHaveLength(1);
    });
  });
});
