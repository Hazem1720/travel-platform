import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { Role } from '../common/enums/role.enum';
import { AuthUser } from '../common/types/auth-user.type';
import { MODERATOR_VISIBLE } from './dto/hotel-reservations.dto';
import {
  HotelReservationsService,
  reservationsFilter,
} from './hotel-reservations.service';

// HTL-22: a hotel moderator's reservations for their own hotel.
describe("A hotel's reservations (HTL-22)", () => {
  const HOTEL = '6735a1f4c1a2b3c4d5e6f801';
  const HOTEL_ID = new Types.ObjectId(HOTEL);
  const moderator: AuthUser = {
    id: '6735a1f4c1a2b3c4d5e6f002',
    role: Role.HOTEL_MODERATOR,
    assignedProviderId: HOTEL,
  };

  function setup(rows: unknown[] = [], hotelExists = true) {
    const bookings = {
      aggregate: jest.fn<Promise<unknown[]>, [any[]]>(async () => rows),
      countDocuments: jest.fn(async () => rows.length),
    };
    const hotels = {
      exists: jest.fn(async () => (hotelExists ? { _id: HOTEL_ID } : null)),
    };
    const users = { collection: { name: 'users' } };
    return {
      service: new HotelReservationsService(
        bookings as any,
        hotels as any,
        users as any,
      ),
      bookings,
      hotels,
    };
  }

  it('lists the paid reservations of the hotel by check-in date, with the guest', async () => {
    const { service, bookings } = setup([{ _id: 'r1' }]);
    const result = await service.list(moderator, HOTEL, {
      page: 2,
      limit: 10,
    });
    const pipeline = bookings.aggregate.mock.calls[0][0];
    expect(pipeline[0]).toEqual({
      $match: { hotelId: HOTEL_ID, status: { $in: MODERATOR_VISIBLE } },
    });
    expect(MODERATOR_VISIBLE).toEqual([
      BookingStatus.CONFIRMED,
      BookingStatus.COMPLETED,
      BookingStatus.CANCELLED,
    ]);
    expect(pipeline[1]).toEqual({ $sort: { checkIn: 1, _id: 1 } });
    expect(pipeline[2]).toEqual({ $skip: 10 });
    expect(pipeline[3]).toEqual({ $limit: 10 });
    expect(pipeline[4].$lookup).toMatchObject({
      from: 'users',
      localField: 'userId',
      foreignField: '_id',
      pipeline: [{ $project: { name: 1, email: 1 } }],
    });
    const projected = pipeline[5].$project;
    for (const field of ['reference', 'status', 'checkIn', 'checkOut']) {
      expect(projected[field]).toBe(1);
    }
    expect(projected.guest).toBeDefined();
    expect(projected.guests).toBeDefined();
    // Only the guest's name and email; never the password hash or tokens.
    expect(JSON.stringify(pipeline)).not.toMatch(/password|token/i);
    expect(result.meta).toMatchObject({ page: 2, total: 1 });
  });

  it("another hotel's id or a non-moderator gets 403 before any lookup", async () => {
    for (const user of [
      { ...moderator, assignedProviderId: '6735a1f4c1a2b3c4d5e6f899' },
      { ...moderator, role: Role.AIRLINE_MODERATOR },
      { ...moderator, role: Role.USER, assignedProviderId: undefined },
    ] as AuthUser[]) {
      const { service, bookings, hotels } = setup();
      await expect(
        service.list(user, HOTEL, { page: 1, limit: 10 }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(hotels.exists).not.toHaveBeenCalled();
      expect(bookings.aggregate).not.toHaveBeenCalled();
    }
  });

  it("the moderator's hotel no longer existing is 404", async () => {
    const { service, bookings } = setup([], false);
    await expect(
      service.list(moderator, HOTEL, { page: 1, limit: 10 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(bookings.aggregate).not.toHaveBeenCalled();
  });

  describe('filters', () => {
    it('by one status', () => {
      expect(
        reservationsFilter(HOTEL_ID, { status: BookingStatus.CANCELLED }),
      ).toEqual({ hotelId: HOTEL_ID, status: BookingStatus.CANCELLED });
    });

    it('from/to keep stays with a night in the range', () => {
      expect(
        reservationsFilter(HOTEL_ID, { from: '2026-12-01', to: '2026-12-31' }),
      ).toEqual({
        hotelId: HOTEL_ID,
        status: { $in: MODERATOR_VISIBLE },
        checkIn: { $lte: '2026-12-31' },
        checkOut: { $gt: '2026-12-01' },
      });
      // A stay checking out on `from` has no night in the range.
      expect(reservationsFilter(HOTEL_ID, { from: '2026-12-01' })).toEqual({
        hotelId: HOTEL_ID,
        status: { $in: MODERATOR_VISIBLE },
        checkOut: { $gt: '2026-12-01' },
      });
    });

    it('to before from is 400', () => {
      expect(() =>
        reservationsFilter(HOTEL_ID, { from: '2026-12-31', to: '2026-12-01' }),
      ).toThrow(BadRequestException);
    });
  });
});
