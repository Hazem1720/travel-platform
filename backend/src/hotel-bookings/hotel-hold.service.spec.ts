import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { Role } from '../common/enums/role.enum';
import { AuthUser } from '../common/types/auth-user.type';
import { CreateHotelBookingDto } from './dto/create-hotel-booking.dto';
import {
  ROOM_NOT_FOUND,
  ROOMS_NOT_AVAILABLE,
} from './hotel-availability.service';
import { HotelHoldService } from './hotel-hold.service';
import { HOTEL_NOT_FOUND } from './hotel-rooms.service';
import { RoomLockKind } from './schemas/room-lock.schema';

// HTL-16 + HTL-18 with mocked models and a mocked availability service. The
// all-or-nothing lock itself (unique index, ordered insert, rollback) is
// tested in hotel-availability.service.spec.ts and live against MongoDB.
describe('HotelHoldService (HTL-16, HTL-18)', () => {
  const TODAY = '2026-11-18';
  const user: AuthUser = {
    id: new Types.ObjectId().toHexString(),
    role: Role.USER,
    assignedProviderId: null,
  };
  const HOTEL = new Types.ObjectId();
  const A = new Types.ObjectId();
  const B = new Types.ObjectId();
  const rooms = [
    {
      _id: A,
      hotelId: HOTEL,
      name: '101',
      type: 'Double',
      maxOccupancy: 2,
      pricePerNight: 10000,
    },
    {
      _id: B,
      hotelId: HOTEL,
      name: '102',
      type: 'Family',
      maxOccupancy: 4,
      pricePerNight: 15000,
    },
  ];

  function setup(
    opts: {
      hotel?: any;
      free?: Types.ObjectId[];
      lockError?: Error;
      createError?: Error;
    } = {},
  ) {
    const bookings = {
      create: jest.fn(async (doc: any) => {
        if (opts.createError) throw opts.createError;
        return {
          toObject: () => ({
            ...doc,
            currency: 'USD',
            reference: null,
            policiesAcceptedAt: null,
            createdAt: new Date(),
          }),
        };
      }),
      findById: jest.fn(),
      updateOne: jest.fn(async () => ({ modifiedCount: 1 })),
      find: jest.fn(),
    };
    const hotels = {
      findById: jest.fn(() => ({
        lean: async () =>
          'hotel' in opts
            ? opts.hotel
            : {
                _id: HOTEL,
                name: 'TEST Nile View',
                cityId: 'cairo',
                isActive: true,
              },
      })),
    };
    const roomModel = {
      find: jest.fn((filter: any) => ({
        lean: async () =>
          rooms.filter((r) => filter._id.$in.includes(String(r._id))),
      })),
    };
    const availability = {
      freeRooms: jest.fn(async () =>
        rooms.filter((r) =>
          (opts.free ?? [A, B]).some((id) => id.equals(r._id)),
        ),
      ),
      lockNights: jest.fn(async () => {
        if (opts.lockError) throw opts.lockError;
        return 6;
      }),
      releaseBooking: jest.fn(async () => 0),
    };
    const search = { today: jest.fn(async () => TODAY) };
    const service = new HotelHoldService(
      bookings as any,
      hotels as any,
      roomModel as any,
      availability as any,
      search as any,
    );
    return { service, bookings, availability, search };
  }

  const dto = (
    over: Partial<CreateHotelBookingDto> = {},
  ): CreateHotelBookingDto => ({
    hotelId: String(HOTEL),
    checkIn: '2026-12-05',
    checkOut: '2026-12-08',
    rooms: [
      { roomId: String(A), adults: 2, childAges: [] },
      { roomId: String(B), adults: 1, childAges: [4, 9] },
    ],
    ...over,
  });

  it('holds both rooms for 10 minutes as one PendingPayment reservation: 750 USD for 3 nights', async () => {
    const { service, availability, bookings } = setup();
    const before = Date.now();
    const res = await service.hold(user, dto());

    expect(res).toMatchObject({
      status: BookingStatus.PENDING_PAYMENT,
      hotelName: 'TEST Nile View',
      nights: 3,
      totalAmount: 75000,
      currency: 'USD',
      reference: null,
    });
    expect(res.rooms.map((r) => [r.name, r.subtotal])).toEqual([
      ['101', 30000],
      ['102', 45000],
    ]);
    const expiresAt = (res.expiresAt as Date).getTime();
    expect(expiresAt - before).toBeGreaterThanOrEqual(10 * 60_000 - 50);
    expect(expiresAt - Date.now()).toBeLessThanOrEqual(10 * 60_000);

    // One lockNights call for every room, Held, with the reservation's id.
    expect(availability.lockNights).toHaveBeenCalledTimes(1);
    const lock = (availability.lockNights.mock.calls as any[])[0][0];
    expect(lock).toMatchObject({
      hotelId: String(HOTEL),
      roomIds: [String(A), String(B)],
      checkIn: '2026-12-05',
      checkOut: '2026-12-08',
      kind: RoomLockKind.HELD,
    });
    const created = (bookings.create.mock.calls as any[])[0][0];
    expect(String(created._id)).toBe(lock.bookingId);
    expect(created.expiresAt).toBe(lock.expiresAt);
    expect(String(created.userId)).toBe(user.id);
  });

  it('a room that is not free (booked, blocked, held, inactive): 409 and nothing is held', async () => {
    const { service, availability, bookings } = setup({ free: [A] });
    await expect(service.hold(user, dto())).rejects.toThrow(
      new ConflictException(ROOMS_NOT_AVAILABLE),
    );
    expect(availability.lockNights).not.toHaveBeenCalled();
    expect(bookings.create).not.toHaveBeenCalled();
  });

  it('another request takes a night first (lockNights 409): no reservation is created', async () => {
    const { service, bookings } = setup({
      lockError: new ConflictException(ROOMS_NOT_AVAILABLE),
    });
    await expect(service.hold(user, dto())).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(bookings.create).not.toHaveBeenCalled();
  });

  it('saving the reservation fails: its locks are released', async () => {
    const { service, availability } = setup({
      createError: new Error('db down'),
    });
    await expect(service.hold(user, dto())).rejects.toThrow('db down');
    const lock = (availability.lockNights.mock.calls as any[])[0][0];
    expect(availability.releaseBooking).toHaveBeenCalledWith(lock.bookingId);
  });

  it('check-in yesterday in the hotel city: 400; check-in today is fine', async () => {
    const { service, search } = setup();
    await expect(
      service.hold(
        user,
        dto({ checkIn: '2026-11-17', checkOut: '2026-11-19' }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(search.today).toHaveBeenCalledWith({ cityId: 'cairo' });
    await expect(
      service.hold(user, dto({ checkIn: TODAY, checkOut: '2026-11-19' })),
    ).resolves.toMatchObject({ nights: 1 });
  });

  it('checkOut on or before checkIn: 400 before anything is read', async () => {
    const { service, bookings } = setup();
    await expect(
      service.hold(user, dto({ checkOut: '2026-12-05' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(bookings.create).not.toHaveBeenCalled();
  });

  it('0 adults or an over-full room: 400, nothing held', async () => {
    const { service, availability } = setup();
    await expect(
      service.hold(
        user,
        dto({ rooms: [{ roomId: String(A), adults: 0, childAges: [3] }] }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.hold(
        user,
        dto({ rooms: [{ roomId: String(A), adults: 2, childAges: [3] }] }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(availability.lockNights).not.toHaveBeenCalled();
  });

  it('a room of another hotel: 400', async () => {
    const { service } = setup();
    rooms.push({
      _id: new Types.ObjectId(),
      hotelId: new Types.ObjectId(),
      name: '900',
      type: 'Single',
      maxOccupancy: 1,
      pricePerNight: 5000,
    });
    const other = rooms[rooms.length - 1];
    try {
      await expect(
        service.hold(
          user,
          dto({
            rooms: [
              { roomId: String(A), adults: 1, childAges: [] },
              { roomId: String(other._id), adults: 1, childAges: [] },
            ],
          }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    } finally {
      rooms.pop();
    }
  });

  it('unknown or inactive hotel, or an unknown room: 404', async () => {
    for (const hotel of [
      null,
      { _id: HOTEL, name: 'x', cityId: 'cairo', isActive: false },
    ]) {
      const { service } = setup({ hotel });
      await expect(service.hold(user, dto())).rejects.toThrow(
        new NotFoundException(HOTEL_NOT_FOUND),
      );
    }
    const { service } = setup();
    await expect(
      service.hold(
        user,
        dto({
          rooms: [
            { roomId: String(new Types.ObjectId()), adults: 1, childAges: [] },
          ],
        }),
      ),
    ).rejects.toThrow(new NotFoundException(ROOM_NOT_FOUND));
  });

  describe('expire (HTL-18)', () => {
    const lean = (value: unknown) => ({ lean: async () => value });

    it('PendingPayment past its hold: Expired and every night freed', async () => {
      const { service, bookings, availability } = setup();
      const id = new Types.ObjectId();
      bookings.findById.mockReturnValue(
        lean({ _id: id, status: BookingStatus.PENDING_PAYMENT }),
      );
      await service.expire(String(id));
      expect(bookings.updateOne).toHaveBeenCalledWith(
        { _id: id, status: BookingStatus.PENDING_PAYMENT },
        {
          $set: { status: BookingStatus.EXPIRED, expiredAt: expect.any(Date) },
        },
      );
      expect(availability.releaseBooking).toHaveBeenCalledWith(String(id));
    });

    it('safe to call twice: an Expired reservation is left alone', async () => {
      const { service, bookings, availability } = setup();
      bookings.findById.mockReturnValue(
        lean({ _id: new Types.ObjectId(), status: BookingStatus.EXPIRED }),
      );
      await service.expire(String(new Types.ObjectId()));
      expect(bookings.updateOne).not.toHaveBeenCalled();
      expect(availability.releaseBooking).not.toHaveBeenCalled();
    });

    it('a payment confirmed it at the same moment: nothing is released', async () => {
      const { service, bookings, availability } = setup();
      bookings.findById.mockReturnValue(
        lean({
          _id: new Types.ObjectId(),
          status: BookingStatus.PENDING_PAYMENT,
        }),
      );
      bookings.updateOne.mockResolvedValueOnce({ modifiedCount: 0 });
      await service.expire(String(new Types.ObjectId()));
      expect(availability.releaseBooking).not.toHaveBeenCalled();
    });

    it('a Confirmed reservation cannot expire: 409', async () => {
      const { service, bookings } = setup();
      bookings.findById.mockReturnValue(
        lean({ _id: new Types.ObjectId(), status: BookingStatus.CONFIRMED }),
      );
      await expect(
        service.expire(String(new Types.ObjectId())),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('an unknown or malformed id does nothing', async () => {
      const { service, bookings } = setup();
      bookings.findById.mockReturnValue(lean(null));
      await service.expire(String(new Types.ObjectId()));
      await service.expire('abc');
      expect(bookings.updateOne).not.toHaveBeenCalled();
    });

    it('findExpiredHolds asks for PendingPayment past expiresAt', async () => {
      const { service, bookings } = setup();
      const id = new Types.ObjectId();
      bookings.find.mockReturnValue(lean([{ _id: id }]));
      const now = new Date('2026-11-18T10:00:00Z');
      expect(await service.findExpiredHolds(now)).toEqual([String(id)]);
      expect(bookings.find).toHaveBeenCalledWith(
        { status: BookingStatus.PENDING_PAYMENT, expiresAt: { $lte: now } },
        { _id: 1 },
      );
    });
  });
});
