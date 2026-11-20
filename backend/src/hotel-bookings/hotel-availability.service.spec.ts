import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  coversStay,
  HotelAvailabilityService,
  MAX_STAY_NIGHTS,
  ROOMS_NOT_AVAILABLE,
  stayNights,
} from './hotel-availability.service';
import { RoomLockKind } from './schemas/room-lock.schema';

// HTL-11 (free rooms), with the room-night locks of HTL-18, HTL-17 and HTL-06.
describe('HotelAvailabilityService (HTL-11)', () => {
  const H1 = '6735a1f4c1a2b3c4d5e6f801';
  const H2 = '6735a1f4c1a2b3c4d5e6f802';
  const R1 = '6735a1f4c1a2b3c4d5e6f901';
  const R2 = '6735a1f4c1a2b3c4d5e6f902';
  const R3 = '6735a1f4c1a2b3c4d5e6f903';
  const december = [{ from: '2026-12-01', to: '2027-01-01' }];
  const room = (id: string, hotelId: string, ranges = december) => ({
    _id: id,
    hotelId,
    name: id.slice(-3),
    maxOccupancy: 2,
    pricePerNight: 12000,
    isActive: true,
    bookableRanges: ranges,
  });

  describe('stayNights', () => {
    // The field-keyed details of the 400 (shared error format, GEN-02).
    const details = (checkIn: string, checkOut: string) => {
      try {
        stayNights(checkIn, checkOut);
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        return ((e as BadRequestException).getResponse() as { details: object })
          .details;
      }
      throw new Error('expected a 400');
    };

    it('lists the nights from checkIn up to, not including, checkOut', () => {
      expect(stayNights('2026-12-30', '2027-01-02')).toEqual([
        '2026-12-30',
        '2026-12-31',
        '2027-01-01',
      ]);
      expect(stayNights('2028-02-28', '2028-03-01')).toHaveLength(2);
    });

    it('refuses checkOut on or before checkIn with 400', () => {
      for (const out of ['2026-12-10', '2026-12-09']) {
        expect(details('2026-12-10', out)).toEqual({
          checkOut: ['checkOut must be after checkIn'],
        });
      }
    });

    it('refuses a date that is not real, and a stay that is too long', () => {
      expect(details('2026-02-30', '2026-03-02')).toHaveProperty('checkIn');
      expect(details('2026-12-10', 'tomorrow')).toHaveProperty('checkOut');
      expect(stayNights('2026-01-01', '2027-01-02')).toHaveLength(
        MAX_STAY_NIGHTS,
      );
      expect(details('2026-01-01', '2027-01-03')).toEqual({
        checkOut: [`A stay can be at most ${MAX_STAY_NIGHTS} nights`],
      });
    });
  });

  describe('coversStay (HTL-04 ranges)', () => {
    const ranges = [
      { from: '2026-12-01', to: '2026-12-10' },
      { from: '2026-12-10', to: '2026-12-20' },
      { from: '2026-12-25', to: '2027-01-01' },
    ];

    it('accepts a stay inside one range, or across two touching ranges', () => {
      expect(coversStay(ranges, '2026-12-02', '2026-12-05')).toBe(true);
      expect(coversStay(ranges, '2026-12-08', '2026-12-12')).toBe(true);
      // Check-out on the range's `to` day: the last night is the 19th.
      expect(coversStay(ranges, '2026-12-15', '2026-12-20')).toBe(true);
    });

    it('refuses a stay with any night outside the ranges', () => {
      expect(coversStay(ranges, '2026-12-18', '2026-12-26')).toBe(false);
      expect(coversStay(ranges, '2026-11-30', '2026-12-02')).toBe(false);
      expect(coversStay(ranges, '2026-12-31', '2027-01-02')).toBe(false);
      expect(coversStay([], '2026-12-02', '2026-12-03')).toBe(false);
    });
  });

  function setup(
    opts: { rooms?: unknown[]; taken?: string[]; owned?: number } = {},
  ) {
    const find = { sort: jest.fn(), lean: jest.fn() };
    find.sort.mockReturnValue(find);
    find.lean.mockResolvedValue(opts.rooms ?? []);
    const rooms = {
      find: jest.fn<any, [object]>(() => find),
      countDocuments: jest.fn(async () => opts.owned ?? 1),
    };
    const locks = {
      distinct: jest.fn<any, [string, any]>(async () => opts.taken ?? []),
      deleteMany: jest.fn<any, [any]>(async () => ({ deletedCount: 2 })),
      insertMany: jest.fn<any, [any[], object]>(async (docs) => docs),
      updateMany: jest.fn<any, [object, object]>(async () => ({
        modifiedCount: 3,
      })),
    };
    return {
      service: new HotelAvailabilityService(rooms as any, locks as any),
      rooms,
      locks,
      find,
    };
  }

  describe('freeRooms / freeRoomsByHotel', () => {
    it('returns active rooms bookable for every night and with no lock', async () => {
      const { service, rooms, locks, find } = setup({
        rooms: [
          room(R1, H1),
          // Bookable only until the 11th: not free for a stay to the 12th.
          room(R2, H1, [{ from: '2026-12-01', to: '2026-12-11' }]),
          room(R3, H1),
        ],
        taken: [R3],
      });
      const free = await service.freeRooms(H1, '2026-12-10', '2026-12-12');
      expect(free.map((r) => r._id)).toEqual([R1]);

      expect(rooms.find).toHaveBeenCalledWith({
        hotelId: { $in: [H1] },
        isActive: true,
        bookableRanges: {
          $elemMatch: {
            from: { $lte: '2026-12-10' },
            to: { $gt: '2026-12-10' },
          },
        },
      });
      expect(find.sort).toHaveBeenCalledWith({ pricePerNight: 1, name: 1 });
      // Only R1 and R3 cover the stay, so only they are checked for locks.
      const [field, filter] = locks.distinct.mock.calls[0];
      expect(field).toBe('roomId');
      expect(filter.roomId).toEqual({ $in: [R1, R3] });
      expect(filter.date).toEqual({ $gte: '2026-12-10', $lt: '2026-12-12' });
    });

    it('counts Blocked and Booked locks, and only unexpired Held ones', async () => {
      const { service, locks } = setup({ rooms: [room(R1, H1)] });
      await service.freeRooms(H1, '2026-12-10', '2026-12-12');
      const filter = locks.distinct.mock.calls[0][1];
      expect(filter.$or[0]).toEqual({ kind: { $ne: RoomLockKind.HELD } });
      expect(filter.$or[1].expiresAt.$gt).toBeInstanceOf(Date);
      expect(Math.abs(filter.$or[1].expiresAt.$gt - Date.now())).toBeLessThan(
        5000,
      );
    });

    it('groups many hotels in two queries and leaves out full hotels', async () => {
      const { service, rooms, locks } = setup({
        rooms: [room(R1, H1), room(R2, H2), room(R3, H2)],
        taken: [R1, R3],
      });
      const byHotel = await service.freeRoomsByHotel(
        [H1, H2],
        '2026-12-10',
        '2026-12-12',
      );
      expect([...byHotel.keys()]).toEqual([H2]);
      expect(byHotel.get(H2)!.map((r) => r._id)).toEqual([R2]);
      expect(rooms.find).toHaveBeenCalledTimes(1);
      expect(locks.distinct).toHaveBeenCalledTimes(1);
    });

    it('answers an empty list without querying locks when nothing is bookable', async () => {
      const { service, locks } = setup({ rooms: [] });
      await expect(
        service.freeRooms(H1, '2026-12-10', '2026-12-12'),
      ).resolves.toEqual([]);
      expect(locks.distinct).not.toHaveBeenCalled();
    });

    it('refuses bad dates with 400 before any query', async () => {
      const { service, rooms } = setup();
      await expect(
        service.freeRooms(H1, '2026-12-12', '2026-12-10'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(rooms.find).not.toHaveBeenCalled();
    });
  });

  describe('lockNights (HTL-18, HTL-06)', () => {
    const inFiveMinutes = () => new Date(Date.now() + 5 * 60 * 1000);
    const hold = (roomIds = [R1, R2]) => ({
      hotelId: H1,
      roomIds,
      checkIn: '2026-12-10',
      checkOut: '2026-12-12',
      kind: RoomLockKind.HELD,
      bookingId: '6735a1f4c1a2b3c4d5e6fa01',
      expiresAt: inFiveMinutes(),
    });

    it('inserts one lock per room per night in one ordered insert', async () => {
      const { service, rooms, locks } = setup({ owned: 2 });
      const input = hold();
      await expect(service.lockNights(input)).resolves.toBe(4);

      expect(rooms.countDocuments).toHaveBeenCalledWith({
        _id: { $in: [R1, R2] },
        hotelId: H1,
      });
      const [docs, options] = locks.insertMany.mock.calls[0];
      expect(options).toEqual({ ordered: true });
      expect(
        docs.map((d: { roomId: string; date: string }) => d.roomId + d.date),
      ).toEqual([
        R1 + '2026-12-10',
        R1 + '2026-12-11',
        R2 + '2026-12-10',
        R2 + '2026-12-11',
      ]);
      expect(docs[0]).toMatchObject({
        hotelId: H1,
        kind: RoomLockKind.HELD,
        bookingId: input.bookingId,
        expiresAt: input.expiresAt,
      });
    });

    it('clears expired holds on those nights before inserting', async () => {
      const { service, locks } = setup({ owned: 2 });
      await service.lockNights(hold());
      const filter = locks.deleteMany.mock.calls[0][0];
      expect(filter).toMatchObject({
        roomId: { $in: [R1, R2] },
        date: { $gte: '2026-12-10', $lt: '2026-12-12' },
        kind: RoomLockKind.HELD,
      });
      expect(filter.expiresAt.$lte).toBeInstanceOf(Date);
    });

    it('takes nothing when one night is already locked: deletes its own locks and answers 409', async () => {
      const { service, locks } = setup({ owned: 2 });
      locks.insertMany.mockRejectedValueOnce(
        Object.assign(new Error('E11000 duplicate key'), { code: 11000 }),
      );
      await expect(service.lockNights(hold())).rejects.toThrow(
        new ConflictException(ROOMS_NOT_AVAILABLE),
      );
      const ids = locks.insertMany.mock.calls[0][0].map(
        (d: { _id: unknown }) => d._id,
      );
      expect(locks.deleteMany).toHaveBeenLastCalledWith({
        _id: { $in: ids },
      });
    });

    it('passes any other database error on unchanged', async () => {
      const { service, locks } = setup({ owned: 2 });
      locks.insertMany.mockRejectedValueOnce(new Error('network'));
      await expect(service.lockNights(hold())).rejects.toThrow('network');
      expect(locks.deleteMany).toHaveBeenCalledTimes(1);
    });

    it('answers 404 if a room is not in this hotel', async () => {
      const { service, locks } = setup({ owned: 1 });
      await expect(service.lockNights(hold())).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(locks.insertMany).not.toHaveBeenCalled();
    });

    it('blocks without a booking or an expiry', async () => {
      const { service, locks } = setup({ owned: 1 });
      await service.lockNights({
        hotelId: H1,
        roomIds: [R1, R1],
        checkIn: '2026-12-10',
        checkOut: '2026-12-13',
        kind: RoomLockKind.BLOCKED,
      });
      const docs = locks.insertMany.mock.calls[0][0];
      expect(docs).toHaveLength(3);
      expect(docs[0]).toMatchObject({ bookingId: null, expiresAt: null });
    });

    it('refuses inputs that would store a broken lock', async () => {
      const { service, locks } = setup({ owned: 2 });
      await expect(
        service.lockNights({ ...hold(), expiresAt: new Date(Date.now() - 1) }),
      ).rejects.toThrow('expiresAt in the future');
      await expect(
        service.lockNights({ ...hold(), bookingId: undefined }),
      ).rejects.toThrow('bookingId');
      await expect(
        service.lockNights({ ...hold(), kind: RoomLockKind.BLOCKED }),
      ).rejects.toThrow('bookingId');
      await expect(service.lockNights(hold([]))).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(locks.insertMany).not.toHaveBeenCalled();
    });
  });

  describe('confirmHeld, releaseBooking, unblock', () => {
    const BOOKING = '6735a1f4c1a2b3c4d5e6fa01';

    it('turns only Held nights of the booking into Booked', async () => {
      const { service, locks } = setup();
      await expect(service.confirmHeld(BOOKING)).resolves.toBe(3);
      expect(locks.updateMany).toHaveBeenCalledWith(
        { bookingId: BOOKING, kind: RoomLockKind.HELD },
        { $set: { kind: RoomLockKind.BOOKED, expiresAt: null } },
      );
    });

    it('frees every night of a booking', async () => {
      const { service, locks } = setup();
      await expect(service.releaseBooking(BOOKING)).resolves.toBe(2);
      expect(locks.deleteMany).toHaveBeenCalledWith({ bookingId: BOOKING });
    });

    it('removes only Blocked nights in the range', async () => {
      const { service, locks } = setup();
      await service.unblock(R1, '2026-12-10', '2026-12-12');
      expect(locks.deleteMany).toHaveBeenCalledWith({
        roomId: R1,
        date: { $gte: '2026-12-10', $lt: '2026-12-12' },
        kind: RoomLockKind.BLOCKED,
      });
    });
  });
});
