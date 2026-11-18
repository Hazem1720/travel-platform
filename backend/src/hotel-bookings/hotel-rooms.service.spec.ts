import { BadRequestException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Types } from 'mongoose';
import { AvailableRoomsQueryDto } from './dto/available-rooms.dto';
import { HotelAvailabilityService } from './hotel-availability.service';
import { HOTEL_NOT_FOUND, HotelRoomsService } from './hotel-rooms.service';
import { RoomLockKind } from './schemas/room-lock.schema';

// HTL-15 with mocked models and the real HotelAvailabilityService, so the
// "free for the stay" rule is the HTL-11 one, not a copy.
describe('Available rooms of a hotel (HTL-15)', () => {
  const TODAY = '2026-11-18';
  const HOTEL = new Types.ObjectId();
  const A = new Types.ObjectId();
  const B = new Types.ObjectId();
  const C = new Types.ObjectId();
  const D = new Types.ObjectId();
  const december = [{ from: '2026-12-01', to: '2027-01-01' }];
  const room = (_id: Types.ObjectId, name: string, price: number) => ({
    _id,
    hotelId: HOTEL,
    name,
    type: 'Double',
    beds: 1,
    maxOccupancy: 2,
    pricePerNight: price,
    isActive: true,
    bookableRanges: december,
  });
  const hotelDoc = (over: object = {}) => ({
    _id: HOTEL,
    name: 'TEST Nile View',
    cityId: 'cairo',
    isActive: true,
    checkInTime: '14:00',
    checkOutTime: '12:00',
    ...over,
  });

  // A tiny in-memory lock store that answers the distinct() query the real
  // availability service sends.
  type Lock = {
    roomId: Types.ObjectId;
    date: string;
    kind: RoomLockKind;
    expiresAt: Date | null;
  };
  function setup(opts: { hotel?: any; rooms?: any[]; locks?: Lock[] } = {}) {
    const rooms = opts.rooms ?? [
      room(A, '101', 10000),
      room(B, '102', 12000),
      room(C, '103', 15000),
    ];
    const locks = opts.locks ?? [];
    const roomModel = {
      find: jest.fn(() => ({
        sort: () => ({ lean: async () => rooms }),
      })),
    };
    const lockModel = {
      distinct: jest.fn(async (_field: string, filter: any) => {
        const ids = new Set(filter.roomId.$in.map(String));
        const now = filter.$or[1].expiresAt.$gt as Date;
        return locks
          .filter(
            (l) =>
              ids.has(String(l.roomId)) &&
              l.date >= filter.date.$gte &&
              l.date < filter.date.$lt &&
              (l.kind !== RoomLockKind.HELD || (l.expiresAt ?? 0) > now),
          )
          .map((l) => l.roomId);
      }),
    };
    const availability = new HotelAvailabilityService(
      roomModel as any,
      lockModel as any,
    );
    const hotels = {
      findById: jest.fn(() => ({
        lean: async () => ('hotel' in opts ? opts.hotel : hotelDoc()),
      })),
    };
    const search = { today: jest.fn(async () => TODAY) };
    const service = new HotelRoomsService(
      hotels as any,
      availability,
      search as any,
    );
    return { service, search, hotels };
  }

  const q = (over: Partial<AvailableRoomsQueryDto> = {}) =>
    ({
      checkIn: '2026-12-05',
      checkOut: '2026-12-08',
      page: 1,
      limit: 10,
      ...over,
    }) as AvailableRoomsQueryDto;

  it('a night Booked in room A and Blocked in room B: only room C, with the right total', async () => {
    const { service } = setup({
      locks: [
        {
          roomId: A,
          date: '2026-12-06',
          kind: RoomLockKind.BOOKED,
          expiresAt: null,
        },
        {
          roomId: B,
          date: '2026-12-07',
          kind: RoomLockKind.BLOCKED,
          expiresAt: null,
        },
      ],
    });
    const res = await service.availableRooms(String(HOTEL), q());
    expect(res.data).toEqual([
      {
        id: String(C),
        name: '103',
        type: 'Double',
        beds: 1,
        maxOccupancy: 2,
        pricePerNight: 15000,
        nights: 3,
        totalPrice: 45000,
      },
    ]);
    expect(res).toMatchObject({
      nights: 3,
      currency: 'USD',
      checkIn: '2026-12-05',
      checkOut: '2026-12-08',
      hotel: { id: String(HOTEL), checkInTime: '14:00', checkOutTime: '12:00' },
      meta: { total: 1, page: 1 },
    });
  });

  it('a room whose hold has expired counts as free; an unexpired hold does not', async () => {
    const { service } = setup({
      locks: [
        {
          roomId: A,
          date: '2026-12-05',
          kind: RoomLockKind.HELD,
          expiresAt: new Date(Date.now() - 60_000),
        },
        {
          roomId: B,
          date: '2026-12-05',
          kind: RoomLockKind.HELD,
          expiresAt: new Date(Date.now() + 60_000),
        },
      ],
    });
    const res = await service.availableRooms(String(HOTEL), q());
    expect(res.data.map((r) => r.name)).toEqual(['101', '103']);
  });

  it('a lock on the check-out day does not block the stay', async () => {
    const { service } = setup({
      locks: [
        {
          roomId: A,
          date: '2026-12-08',
          kind: RoomLockKind.BOOKED,
          expiresAt: null,
        },
      ],
    });
    const res = await service.availableRooms(String(HOTEL), q());
    expect(res.data.map((r) => r.name)).toEqual(['101', '102', '103']);
  });

  it('leaves out inactive rooms and rooms not bookable on every night', async () => {
    const { service } = setup({
      rooms: [
        room(A, '101', 10000),
        {
          ...room(B, '102', 12000),
          bookableRanges: [{ from: '2026-12-01', to: '2026-12-07' }],
        },
        room(C, '103', 15000),
      ],
    });
    const res = await service.availableRooms(String(HOTEL), q());
    expect(res.data.map((r) => r.name)).toEqual(['101', '103']);
  });

  it('pages the rooms, 10 per page, cheapest first', async () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      room(new Types.ObjectId(), String(100 + i), 10000 + i),
    );
    const { service } = setup({ rooms: many });
    const res = await service.availableRooms(String(HOTEL), q({ page: 2 }));
    expect(res.data.map((r) => r.name)).toEqual(['110', '111']);
    expect(res.meta).toEqual({ page: 2, limit: 10, total: 12, totalPages: 2 });
  });

  it('no free room: 200 with an empty list', async () => {
    const { service } = setup({
      rooms: [room(D, '104', 9000)],
      locks: [
        {
          roomId: D,
          date: '2026-12-05',
          kind: RoomLockKind.BOOKED,
          expiresAt: null,
        },
      ],
    });
    const res = await service.availableRooms(String(HOTEL), q());
    expect(res.data).toEqual([]);
    expect(res.meta.total).toBe(0);
  });

  it('checkOut on or before checkIn: 400', async () => {
    const { service } = setup();
    for (const checkOut of ['2026-12-05', '2026-12-04']) {
      await expect(
        service.availableRooms(String(HOTEL), q({ checkOut })),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it("check-in yesterday in the hotel's city: 400 with details.checkIn", async () => {
    const { service, search } = setup();
    const err = await service
      .availableRooms(
        String(HOTEL),
        q({ checkIn: '2026-11-17', checkOut: '2026-11-19' }),
      )
      .catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse().details).toEqual({
      checkIn: ['checkIn cannot be in the past'],
    });
    expect(search.today).toHaveBeenCalledWith({ cityId: 'cairo' });
  });

  it('check-in today is allowed', async () => {
    const { service } = setup({
      rooms: [
        {
          ...room(A, '101', 10000),
          bookableRanges: [{ from: '2026-11-01', to: '2026-12-01' }],
        },
      ],
    });
    const res = await service.availableRooms(
      String(HOTEL),
      q({ checkIn: TODAY, checkOut: '2026-11-19' }),
    );
    expect(res.data).toHaveLength(1);
  });

  it('an unknown or inactive hotel: 404', async () => {
    for (const hotel of [null, hotelDoc({ isActive: false })]) {
      const { service } = setup({ hotel });
      await expect(service.availableRooms(String(HOTEL), q())).rejects.toThrow(
        new NotFoundException(HOTEL_NOT_FOUND),
      );
    }
  });

  describe('query validation', () => {
    const failed = async (query: object) =>
      (await validate(plainToInstance(AvailableRoomsQueryDto, query))).map(
        (e) => e.property,
      );

    it('needs real YYYY-MM-DD dates', async () => {
      expect(
        await failed({ checkIn: '2026-12-05', checkOut: '2026-12-08' }),
      ).toEqual([]);
      expect(
        await failed({ checkIn: '2026-02-30', checkOut: '12/08/2026' }),
      ).toEqual(['checkIn', 'checkOut']);
      expect(await failed({})).toEqual(['checkIn', 'checkOut']);
    });
  });
});
