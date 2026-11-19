import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { RoomLockKind } from '../hotel-bookings/schemas/room-lock.schema';
import { RoomNightStatus } from './dto/room-availability.dto';
import {
  BLOCK_CONFLICT,
  earliestToday,
  inRanges,
  normalizeRanges,
  ONE_AVAILABILITY_ACTION,
  ROOM_HAS_RESERVATIONS,
  ROOM_WAS_RESERVED,
  RoomsService,
} from './rooms.service';

// HTL-05 (edit a room and its ranges), HTL-06 (block, deactivate, delete)
// and HTL-08 (the hotel's room calendar).
describe('RoomsService room management', () => {
  const HOTEL = '6735a1f4c1a2b3c4d5e6f801';
  const ROOM = '6735a1f4c1a2b3c4d5e6f901';
  const BOOKING = '6735a1f4c1a2b3c4d5e6fa01';
  const UPDATED_AT = new Date('2026-11-18T10:00:00Z');

  const room = {
    _id: ROOM,
    hotelId: HOTEL,
    name: '101',
    type: 'Double',
    beds: 2,
    maxOccupancy: 3,
    pricePerNight: 12000,
    isActive: true,
    bookableRanges: [
      { from: '2030-12-01', to: '2031-01-01' },
      { from: '2031-01-01', to: '2031-01-10' },
    ],
    updatedAt: UPDATED_AT,
  };

  const lean = <T>(value: T) => ({ lean: async () => value });

  function setup(
    opts: {
      room?: unknown;
      // Answers of locks.exists, one per call (the last one repeats).
      lockExists?: unknown[];
      // Answers of locks.find(...).lean(), one per call.
      lockFinds?: unknown[][];
      bookingExists?: unknown;
      bookings?: unknown[];
      updated?: unknown;
      calendarRooms?: unknown[];
    } = {},
  ) {
    const found = 'room' in opts ? opts.room : room;
    const lockExists = [...(opts.lockExists ?? [null])];
    const lockFinds = [...(opts.lockFinds ?? [[]])];
    const nextOf = <T>(list: T[]) => (list.length > 1 ? list.shift() : list[0]);

    const rooms = {
      findOne: jest.fn(() => lean(found)),
      findOneAndUpdate: jest.fn<any, [object, object, object]>(() =>
        lean('updated' in opts ? opts.updated : { ...room, updated: true }),
      ),
      updateOne: jest.fn(async () => ({ modifiedCount: 1 })),
      deleteOne: jest.fn(async () => ({ deletedCount: 1 })),
      exists: jest.fn(async () => (found ? { _id: ROOM } : null)),
      find: jest.fn(() => {
        const chain = {
          sort: jest.fn(() => chain),
          skip: jest.fn(() => chain),
          limit: jest.fn(() => chain),
          lean: async () => opts.calendarRooms ?? [],
        };
        return chain;
      }),
      countDocuments: jest.fn(async () => (opts.calendarRooms ?? []).length),
    };
    const hotels = { exists: jest.fn(async () => ({ _id: HOTEL })) };
    const locks = {
      exists: jest.fn(async () => nextOf(lockExists)),
      find: jest.fn(() => lean(nextOf(lockFinds))),
      deleteMany: jest.fn(async () => ({ deletedCount: 0 })),
    };
    const bookings = {
      exists: jest.fn(async () => opts.bookingExists ?? null),
      find: jest.fn(() => lean(opts.bookings ?? [])),
    };
    const availability = {
      lockNights: jest.fn(async () => 3),
      unblock: jest.fn(async () => 2),
    };
    const service = new RoomsService(
      hotels as any,
      rooms as any,
      locks as any,
      bookings as any,
      availability as any,
    );
    return { service, rooms, hotels, locks, bookings, availability };
  }

  describe('helpers', () => {
    it('normalizeRanges sorts ranges and lets them touch', () => {
      expect(
        normalizeRanges([
          { from: '2031-01-01', to: '2031-01-10' },
          { from: '2030-12-01', to: '2031-01-01' },
        ]),
      ).toEqual([
        { from: '2030-12-01', to: '2031-01-01' },
        { from: '2031-01-01', to: '2031-01-10' },
      ]);
    });

    it('normalizeRanges refuses overlapping ranges and to on or before from (400)', () => {
      expect(() =>
        normalizeRanges([
          { from: '2030-12-01', to: '2031-01-01' },
          { from: '2030-12-15', to: '2031-01-05' },
        ]),
      ).toThrow(BadRequestException);
      expect(() =>
        normalizeRanges([{ from: '2030-12-01', to: '2030-12-01' }]),
      ).toThrow(BadRequestException);
    });

    it('inRanges treats `to` as the day after the last night', () => {
      const ranges = [{ from: '2030-12-01', to: '2030-12-05' }];
      expect(inRanges(ranges, '2030-12-01')).toBe(true);
      expect(inRanges(ranges, '2030-12-04')).toBe(true);
      expect(inRanges(ranges, '2030-12-05')).toBe(false);
    });

    it('earliestToday is the date at UTC-12, so no time zone is ahead of it', () => {
      expect(earliestToday(new Date('2026-11-19T05:00:00Z'))).toBe(
        '2026-11-18',
      );
      expect(earliestToday(new Date('2026-11-19T13:00:00Z'))).toBe(
        '2026-11-19',
      );
    });
  });

  describe('update (HTL-05, HTL-06)', () => {
    it('changes the price without looking at reservations (they keep their snapshot)', async () => {
      const { service, rooms, locks } = setup();
      await service.update(HOTEL, ROOM, { pricePerNight: 15000 });
      const [filter, update] = rooms.findOneAndUpdate.mock.calls[0];
      expect(filter).toEqual({ _id: ROOM, hotelId: HOTEL });
      expect(update).toEqual({ $set: { pricePerNight: 15000 } });
      expect(locks.exists).not.toHaveBeenCalled();
    });

    it('answers 404 for a room of another hotel', async () => {
      const { service } = setup({ room: null });
      await expect(
        service.update(HOTEL, ROOM, { beds: 1 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses to deactivate a room with a future reservation (409) and changes nothing', async () => {
      const { service, rooms, locks } = setup({ lockExists: [{ _id: 'x' }] });
      await expect(
        service.update(HOTEL, ROOM, { isActive: false }),
      ).rejects.toThrow(ROOM_HAS_RESERVATIONS);
      expect(rooms.findOneAndUpdate).not.toHaveBeenCalled();
      // Only Booked nights and unexpired holds count, from today on.
      const filter = locks.exists.mock.calls[0] as any;
      expect(JSON.stringify(filter)).toContain(RoomLockKind.BOOKED);
    });

    it('puts the room back if a hold arrived while it was being deactivated', async () => {
      const { service, rooms } = setup({ lockExists: [null, { _id: 'x' }] });
      await expect(
        service.update(HOTEL, ROOM, { isActive: false, beds: 1 }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(rooms.updateOne).toHaveBeenCalledWith(
        { _id: ROOM, hotelId: HOTEL },
        { $set: { isActive: true, beds: 2 } },
      );
    });

    it('deactivates a room with no future reservation', async () => {
      const { service, rooms } = setup();
      await service.update(HOTEL, ROOM, { isActive: false });
      expect(rooms.findOneAndUpdate).toHaveBeenCalled();
      expect(rooms.updateOne).not.toHaveBeenCalled();
    });
  });

  describe('updateAvailability', () => {
    it('needs exactly one of ranges, block or unblock (400)', async () => {
      const { service } = setup();
      await expect(service.updateAvailability(HOTEL, ROOM, {})).rejects.toThrow(
        ONE_AVAILABILITY_ACTION,
      );
      await expect(
        service.updateAvailability(HOTEL, ROOM, {
          ranges: [],
          block: { from: '2030-12-10', to: '2030-12-12' },
        }),
      ).rejects.toThrow(ONE_AVAILABILITY_ACTION);
    });

    describe('ranges (HTL-05)', () => {
      it('refuses to remove a range that has a Confirmed night (409, with the nights)', async () => {
        const { service, rooms } = setup({
          lockFinds: [[{ date: '2031-01-03' }, { date: '2030-12-20' }]],
        });
        const err = await service
          .updateAvailability(HOTEL, ROOM, {
            ranges: [{ from: '2030-12-01', to: '2030-12-15' }],
          })
          .catch((e: ConflictException) => e);
        expect(err).toBeInstanceOf(ConflictException);
        expect((err as ConflictException).getResponse()).toMatchObject({
          details: { nights: ['2030-12-20', '2031-01-03'] },
        });
        expect(rooms.findOneAndUpdate).not.toHaveBeenCalled();
      });

      it('removes an empty range (200) with a write that fails if the room changed meanwhile', async () => {
        const { service, rooms } = setup({
          lockFinds: [[{ date: '2030-12-20' }]],
        });
        await service.updateAvailability(HOTEL, ROOM, {
          ranges: [{ from: '2030-12-01', to: '2031-01-01' }],
        });
        const [filter, update] = rooms.findOneAndUpdate.mock.calls[0];
        expect(filter).toEqual({
          _id: ROOM,
          hotelId: HOTEL,
          updatedAt: UPDATED_AT,
        });
        expect(update).toEqual({
          $set: { bookableRanges: [{ from: '2030-12-01', to: '2031-01-01' }] },
        });
      });

      it('answers 409 when the room was changed at the same time', async () => {
        const { service } = setup({ updated: null });
        await expect(
          service.updateAvailability(HOTEL, ROOM, { ranges: [] }),
        ).rejects.toBeInstanceOf(ConflictException);
      });

      it('puts the old ranges back if a hold landed outside them meanwhile', async () => {
        const { service, rooms } = setup({
          lockFinds: [[], [{ date: '2031-01-05' }]],
        });
        await expect(
          service.updateAvailability(HOTEL, ROOM, {
            ranges: [{ from: '2030-12-01', to: '2031-01-01' }],
          }),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(rooms.updateOne).toHaveBeenCalledWith(
          { _id: ROOM, hotelId: HOTEL },
          { $set: { bookableRanges: room.bookableRanges } },
        );
      });
    });

    describe('block and unblock (HTL-06)', () => {
      it('blocks the nights with Blocked locks, all or nothing', async () => {
        const { service, availability } = setup();
        const res = await service.updateAvailability(HOTEL, ROOM, {
          block: { from: '2030-12-10', to: '2030-12-13' },
        });
        expect(availability.lockNights).toHaveBeenCalledWith({
          hotelId: HOTEL,
          roomIds: [ROOM],
          checkIn: '2030-12-10',
          checkOut: '2030-12-13',
          kind: RoomLockKind.BLOCKED,
        });
        expect(res).toEqual({
          roomId: ROOM,
          from: '2030-12-10',
          to: '2030-12-13',
          nights: 3,
        });
      });

      it('answers 409 when a night is held or booked', async () => {
        const { service, availability } = setup();
        availability.lockNights.mockRejectedValueOnce(
          new ConflictException('One or more rooms are not available'),
        );
        await expect(
          service.updateAvailability(HOTEL, ROOM, {
            block: { from: '2030-12-10', to: '2030-12-13' },
          }),
        ).rejects.toThrow(BLOCK_CONFLICT);
      });

      it('refuses to on or before from (400) before touching locks', async () => {
        const { service, availability } = setup();
        await expect(
          service.updateAvailability(HOTEL, ROOM, {
            block: { from: '2030-12-10', to: '2030-12-10' },
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(availability.lockNights).not.toHaveBeenCalled();
      });

      it('unblocks only the Blocked nights of a room of this hotel', async () => {
        const { service, availability } = setup();
        const res = await service.updateAvailability(HOTEL, ROOM, {
          unblock: { from: '2030-12-10', to: '2030-12-13' },
        });
        expect(availability.unblock).toHaveBeenCalledWith(
          ROOM,
          '2030-12-10',
          '2030-12-13',
        );
        expect(res).toMatchObject({ nights: 2 });
      });

      it('unblock answers 404 for a room of another hotel', async () => {
        const { service, availability } = setup({ room: null });
        await expect(
          service.updateAvailability(HOTEL, ROOM, {
            unblock: { from: '2030-12-10', to: '2030-12-13' },
          }),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(availability.unblock).not.toHaveBeenCalled();
      });
    });
  });

  describe('remove (HTL-06)', () => {
    it('refuses to delete a room that was booked once (409) and reactivates it', async () => {
      const { service, rooms } = setup({ bookingExists: { _id: BOOKING } });
      await expect(service.remove(HOTEL, ROOM)).rejects.toThrow(
        ROOM_WAS_RESERVED,
      );
      expect(rooms.deleteOne).not.toHaveBeenCalled();
      expect(rooms.updateOne).toHaveBeenLastCalledWith(
        { _id: ROOM, hotelId: HOTEL },
        { $set: { isActive: true } },
      );
    });

    it('ignores reservations that expired unpaid when deciding', async () => {
      const { service, bookings } = setup();
      await service.remove(HOTEL, ROOM);
      expect(bookings.exists).toHaveBeenCalledWith({
        'rooms.roomId': ROOM,
        status: { $ne: 'Expired' },
      });
    });

    it('deletes a never-booked room and its blocked nights', async () => {
      const { service, rooms, locks } = setup();
      await expect(service.remove(HOTEL, ROOM)).resolves.toEqual({
        id: ROOM,
        deleted: true,
      });
      // Hidden from search first, so no hold can start during the check.
      expect(rooms.updateOne).toHaveBeenCalledWith(
        { _id: ROOM, hotelId: HOTEL },
        { $set: { isActive: false } },
      );
      expect(rooms.deleteOne).toHaveBeenCalledWith({
        _id: ROOM,
        hotelId: HOTEL,
      });
      expect(locks.deleteMany).toHaveBeenCalledWith({ roomId: ROOM });
    });

    it('answers 404 for a room of another hotel', async () => {
      const { service } = setup({ room: null });
      await expect(service.remove(HOTEL, ROOM)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('calendar (HTL-08)', () => {
    const q = { from: '2030-12-09', to: '2030-12-13', page: 1, limit: 10 };

    it('shows Booked with the reference, Blocked, Available and Unavailable nights', async () => {
      const past = new Date(Date.now() - 60 * 1000);
      const narrowRoom = {
        ...room,
        bookableRanges: [{ from: '2030-12-09', to: '2030-12-12' }],
      };
      const { service } = setup({
        calendarRooms: [narrowRoom],
        lockFinds: [
          [
            {
              roomId: ROOM,
              date: '2030-12-09',
              kind: RoomLockKind.BOOKED,
              bookingId: BOOKING,
              expiresAt: null,
            },
            {
              roomId: ROOM,
              date: '2030-12-10',
              kind: RoomLockKind.BLOCKED,
              bookingId: null,
              expiresAt: null,
            },
            // An expired hold no longer takes the night.
            {
              roomId: ROOM,
              date: '2030-12-11',
              kind: RoomLockKind.HELD,
              bookingId: 'old',
              expiresAt: past,
            },
          ],
        ],
        bookings: [
          { _id: BOOKING, reference: 'HT-7K2M9QXA', status: 'Confirmed' },
        ],
      });
      const res = await service.calendar(HOTEL, q);
      expect(res.meta).toEqual({ page: 1, limit: 10, total: 1, totalPages: 1 });
      expect(res.data[0].nights).toEqual([
        {
          date: '2030-12-09',
          status: RoomNightStatus.BOOKED,
          reference: 'HT-7K2M9QXA',
          bookingId: BOOKING,
          bookingStatus: 'Confirmed',
        },
        { date: '2030-12-10', status: RoomNightStatus.BLOCKED },
        { date: '2030-12-11', status: RoomNightStatus.AVAILABLE },
        // Outside the room's bookable ranges.
        { date: '2030-12-12', status: RoomNightStatus.UNAVAILABLE },
      ]);
    });

    it('shows a running hold as Booked, PendingPayment, without a reference yet', async () => {
      const { service } = setup({
        calendarRooms: [room],
        lockFinds: [
          [
            {
              roomId: ROOM,
              date: '2030-12-09',
              kind: RoomLockKind.HELD,
              bookingId: BOOKING,
              expiresAt: new Date(Date.now() + 5 * 60 * 1000),
            },
          ],
        ],
        bookings: [{ _id: BOOKING, reference: null, status: 'PendingPayment' }],
      });
      const res = await service.calendar(HOTEL, q);
      expect(res.data[0].nights[0]).toEqual({
        date: '2030-12-09',
        status: RoomNightStatus.BOOKED,
        reference: null,
        bookingId: BOOKING,
        bookingStatus: 'PendingPayment',
      });
    });

    it('shows every night of a deactivated room as Unavailable', async () => {
      const { service } = setup({
        calendarRooms: [{ ...room, isActive: false }],
      });
      const res = await service.calendar(HOTEL, q);
      expect(res.data[0].isActive).toBe(false);
      expect(
        res.data[0].nights.every(
          (n) => n.status === RoomNightStatus.UNAVAILABLE,
        ),
      ).toBe(true);
    });

    it('refuses from after to, and more than 31 nights (400)', async () => {
      const { service } = setup();
      await expect(
        service.calendar(HOTEL, { ...q, from: '2030-12-13', to: '2030-12-09' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.calendar(HOTEL, { ...q, from: '2030-12-01', to: '2031-01-02' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
