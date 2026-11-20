import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RoomsService } from './rooms.service';

// HTL-03 (add a room) and HTL-04 (bookable ranges).
describe('RoomsService', () => {
  const HOTEL = '6735a1f4c1a2b3c4d5e6f801';
  const ROOM = '6735a1f4c1a2b3c4d5e6f901';

  function setup(
    opts: { hotelExists?: boolean; updated?: unknown; room?: unknown } = {},
  ) {
    const hotels = {
      exists: jest.fn(async () =>
        (opts.hotelExists ?? true) ? { _id: HOTEL } : null,
      ),
    };
    const rooms = {
      create: jest.fn(async (doc: object) => ({
        toObject: () => ({
          _id: ROOM,
          isActive: true,
          bookableRanges: [],
          ...doc,
        }),
      })),
      findOneAndUpdate: jest.fn<any, [object, object, object]>(() => ({
        lean: async () => opts.updated ?? null,
      })),
      findOne: jest.fn(() => ({ lean: async () => opts.room ?? null })),
    };
    return {
      service: new RoomsService(
        hotels as any,
        rooms as any,
        {} as any,
        {} as any,
        {} as any,
      ),
      hotels,
      rooms,
    };
  }

  describe('create (HTL-03)', () => {
    const dto = {
      name: '101',
      type: 'Double',
      beds: 2,
      maxOccupancy: 3,
      pricePerNight: 12000,
    };

    it('adds a room, taking the hotel id from the route', async () => {
      const { service, rooms } = setup();
      const room = await service.create(HOTEL, dto);
      expect(rooms.create).toHaveBeenCalledWith({ ...dto, hotelId: HOTEL });
      expect(room).toMatchObject({ _id: ROOM, name: '101' });
    });

    it('answers 404 when the hotel does not exist', async () => {
      const { service, rooms } = setup({ hotelExists: false });
      await expect(service.create(HOTEL, dto)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(rooms.create).not.toHaveBeenCalled();
    });
  });

  describe('addAvailability (HTL-04)', () => {
    it('adds a range with one conditional update that refuses overlaps', async () => {
      const { service, rooms } = setup({
        updated: { _id: ROOM, bookableRanges: [] },
      });
      await service.addAvailability(HOTEL, ROOM, {
        from: '2026-12-01',
        to: '2027-01-01',
      });
      const [filter, update] = rooms.findOneAndUpdate.mock.calls[0] as any[];
      expect(filter).toMatchObject({ _id: ROOM, hotelId: HOTEL });
      // An existing range [a, b) overlaps [from, to) when a < to and b > from.
      expect(filter.bookableRanges.$not.$elemMatch).toEqual({
        from: { $lt: '2027-01-01' },
        to: { $gt: '2026-12-01' },
      });
      expect(update.$push.bookableRanges.$each).toEqual([
        { from: '2026-12-01', to: '2027-01-01' },
      ]);
    });

    it('rejects `to` on or before `from` (400) without touching the database', async () => {
      const { service, rooms } = setup();
      for (const to of ['2026-12-01', '2026-11-30']) {
        await expect(
          service.addAvailability(HOTEL, ROOM, { from: '2026-12-01', to }),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
      expect(rooms.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('answers 400 when the range overlaps an existing one', async () => {
      const { service } = setup({ updated: null, room: { _id: ROOM } });
      await expect(
        service.addAvailability(HOTEL, ROOM, {
          from: '2026-12-15',
          to: '2027-01-05',
        }),
      ).rejects.toThrow('overlaps');
    });

    it('answers 404 when the room is not in this hotel', async () => {
      const { service } = setup({ updated: null, room: null });
      await expect(
        service.addAvailability(HOTEL, ROOM, {
          from: '2026-12-01',
          to: '2027-01-01',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
