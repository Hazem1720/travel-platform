import { BadRequestException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Types } from 'mongoose';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import {
  BookingRoomDto,
  CreateHotelBookingDto,
} from './dto/create-hotel-booking.dto';
import {
  assertRoomSelection,
  assertRoomsFit,
  HOLD_MINUTES,
  holdExpiry,
  priceRooms,
  RoomForBooking,
} from './hotel-booking.rules';
import { HotelBookingsController } from './hotel-bookings.controller';

// HTL-16 rules (pure functions) and the request's validation.
describe('Hotel booking rules (HTL-16, HTL-18)', () => {
  const HOTEL = new Types.ObjectId();
  const OTHER_HOTEL = new Types.ObjectId();
  const roomDoc = (
    price: number,
    maxOccupancy = 3,
    hotelId = HOTEL,
  ): RoomForBooking => ({
    _id: new Types.ObjectId(),
    hotelId,
    name: `TEST ${price}`,
    type: 'Double',
    maxOccupancy,
    pricePerNight: price,
  });
  const pick = (
    room: RoomForBooking,
    adults: number,
    childAges: number[] = [],
  ) => ({ roomId: String(room._id), adults, childAges }) as BookingRoomDto;
  const byId = (...rooms: RoomForBooking[]) =>
    new Map(rooms.map((r) => [String(r._id), r]));
  const details = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      return ((e as BadRequestException).getResponse() as { details: object })
        .details;
    }
    throw new Error('expected a 400');
  };

  describe('priceRooms', () => {
    it('two rooms for 3 nights at 100 and 150 USD: total 750 USD', () => {
      const a = roomDoc(10000);
      const b = roomDoc(15000);
      const res = priceRooms([pick(a, 2), pick(b, 1, [7])], byId(a, b), 3);
      expect(res.totalAmount).toBe(75000);
      expect(res.rooms.map((r) => [r.pricePerNight, r.subtotal])).toEqual([
        [10000, 30000],
        [15000, 45000],
      ]);
      expect(res.rooms[1]).toMatchObject({ adults: 1, childAges: [7] });
    });

    it('is a snapshot: changing the room price afterwards does not alter it', () => {
      const a = roomDoc(10000);
      const res = priceRooms([pick(a, 1)], byId(a), 2);
      a.pricePerNight = 99900;
      expect(res.totalAmount).toBe(20000);
      expect(res.rooms[0].pricePerNight).toBe(10000);
    });
  });

  describe('assertRoomSelection', () => {
    it('0 adults in the whole reservation: 400', () => {
      const a = roomDoc(10000);
      expect(details(() => assertRoomSelection([pick(a, 0, [5])]))).toEqual({
        rooms: ['A reservation needs at least one adult'],
      });
    });

    it('one adult in any room is enough (a children-only room is fine)', () => {
      const a = roomDoc(10000);
      const b = roomDoc(12000);
      expect(() =>
        assertRoomSelection([pick(a, 1), pick(b, 0, [10, 12])]),
      ).not.toThrow();
    });

    it('a room with no guest at all: 400', () => {
      const a = roomDoc(10000);
      const b = roomDoc(12000);
      expect(
        details(() => assertRoomSelection([pick(a, 2), pick(b, 0)])),
      ).toEqual({ 'rooms.1': ['Each room needs at least one guest'] });
    });

    it('the same room twice: 400', () => {
      const a = roomDoc(10000);
      expect(
        details(() => assertRoomSelection([pick(a, 1), pick(a, 1)])),
      ).toEqual({
        'rooms.1.roomId': [
          'Each room can be booked only once in a reservation',
        ],
      });
    });
  });

  describe('assertRoomsFit', () => {
    it('4 guests in a 3-person room: 400', () => {
      const a = roomDoc(10000, 3);
      expect(
        details(() =>
          assertRoomsFit(String(HOTEL), [pick(a, 2, [4, 9])], byId(a)),
        ),
      ).toEqual({
        'rooms.0': [`Room ${a.name} sleeps at most 3 guests, not 4`],
      });
    });

    it('3 guests in a 3-person room is fine', () => {
      const a = roomDoc(10000, 3);
      expect(() =>
        assertRoomsFit(String(HOTEL), [pick(a, 1, [4, 9])], byId(a)),
      ).not.toThrow();
    });

    it('rooms from two hotels: 400', () => {
      const a = roomDoc(10000);
      const b = roomDoc(12000, 3, OTHER_HOTEL);
      expect(
        details(() =>
          assertRoomsFit(String(HOTEL), [pick(a, 1), pick(b, 1)], byId(a, b)),
        ),
      ).toEqual({
        'rooms.1.roomId': [
          'All rooms of a reservation must be in the same hotel',
        ],
      });
    });
  });

  it('the hold lasts 10 minutes', () => {
    const now = new Date('2026-11-18T10:00:00Z');
    expect(HOLD_MINUTES).toBe(10);
    expect(holdExpiry(now).toISOString()).toBe('2026-11-18T10:10:00.000Z');
  });

  describe('request validation', () => {
    const body = (rooms: object[]) => ({
      hotelId: String(HOTEL),
      checkIn: '2026-12-05',
      checkOut: '2026-12-08',
      rooms,
    });
    const failed = async (b: object) => {
      const errors = await validate(plainToInstance(CreateHotelBookingDto, b));
      const paths: string[] = [];
      const walk = (errs: typeof errors, prefix: string) =>
        errs.forEach((e) => {
          const p = prefix ? `${prefix}.${e.property}` : e.property;
          if (e.constraints) paths.push(p);
          walk(e.children ?? [], p);
        });
      walk(errors, '');
      return paths;
    };
    const room = { roomId: String(new Types.ObjectId()) };

    it('accepts a valid request', async () => {
      expect(
        await failed(body([{ ...room, adults: 2, childAges: [0, 17] }])),
      ).toEqual([]);
    });

    it('child age 18 (or -1): 400 on that room', async () => {
      expect(
        await failed(body([{ ...room, adults: 1, childAges: [18] }])),
      ).toEqual(['rooms.0.childAges']);
      expect(
        await failed(body([{ ...room, adults: 1, childAges: [-1] }])),
      ).toEqual(['rooms.0.childAges']);
    });

    it('no rooms, a bad room id, a bad hotel id or bad dates: 400', async () => {
      expect(await failed(body([]))).toEqual(['rooms']);
      expect(
        await failed(body([{ roomId: 'abc', adults: 1, childAges: [] }])),
      ).toEqual(['rooms.0.roomId']);
      expect(
        await failed({
          ...body([{ ...room, adults: 1, childAges: [] }]),
          hotelId: 'x',
          checkIn: '2026-02-30',
        }),
      ).toEqual(['hotelId', 'checkIn']);
    });

    it('missing adults or childAges: 400', async () => {
      expect(await failed(body([{ ...room }]))).toEqual([
        'rooms.0.adults',
        'rooms.0.childAges',
      ]);
    });
  });

  it('only registered users can book (admins and moderators get 403)', () => {
    const roles = new Reflector().get<Role[]>(
      ROLES_KEY,
      HotelBookingsController.prototype.create,
    );
    expect(roles).toEqual([Role.USER]);
  });
});
