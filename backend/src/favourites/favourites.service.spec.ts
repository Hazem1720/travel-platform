import { ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { Role } from '../common/enums/role.enum';
import {
  ALREADY_SAVED,
  FAVOURITE_NOT_FOUND,
  FavouritesService,
  HOTEL_NOT_FOUND,
  ITINERARY_NOT_FOUND,
} from './favourites.service';
import { FavouriteType } from './schemas/favourite.schema';

// BON-02: save hotels and public itineraries, list them, remove them.
describe('FavouritesService (BON-02)', () => {
  const USER = String(new Types.ObjectId());
  const user = { id: USER, role: Role.USER, assignedProviderId: null };
  const HOTEL = new Types.ObjectId();
  const INACTIVE = new Types.ObjectId();
  const PUBLIC = new Types.ObjectId();
  const PRIVATE = new Types.ObjectId();

  const hotelDoc = {
    _id: HOTEL,
    name: 'TEST Nile View',
    cityId: 'cairo',
    starClass: 4,
    ratingAverage: 4.5,
    images: ['/uploads/a.jpg'],
    isActive: true,
  };

  function setup() {
    const docs: any[] = [];
    const same = (a: unknown, b: unknown) => String(a) === String(b);
    const favourites = {
      docs,
      create: jest.fn(async (data: any) => {
        if (
          docs.some(
            (d) =>
              same(d.userId, data.userId) &&
              d.type === data.type &&
              same(d.targetId, data.targetId),
          )
        ) {
          throw Object.assign(new Error('E11000'), { code: 11000 });
        }
        const doc = {
          _id: new Types.ObjectId(),
          createdAt: new Date(Date.now() + docs.length),
          ...data,
        };
        docs.push(doc);
        return { toObject: () => ({ ...doc }) };
      }),
      find: jest.fn((filter: any) => {
        let rows = docs.filter((d) => same(d.userId, filter.userId));
        const chain: any = {
          sort: () => {
            rows = [...rows].sort((a, b) => b.createdAt - a.createdAt);
            return chain;
          },
          skip: (n: number) => {
            rows = rows.slice(n);
            return chain;
          },
          limit: (n: number) => {
            rows = rows.slice(0, n);
            return chain;
          },
          lean: async () => rows.map((r) => ({ ...r })),
        };
        return chain;
      }),
      countDocuments: jest.fn(
        async (filter: any) =>
          docs.filter((d) => same(d.userId, filter.userId)).length,
      ),
      deleteOne: jest.fn(async (filter: any) => {
        const i = docs.findIndex(
          (d) => same(d._id, filter._id) && same(d.userId, filter.userId),
        );
        if (i >= 0) docs.splice(i, 1);
        return { deletedCount: i >= 0 ? 1 : 0 };
      }),
    };
    let hotelActive = true;
    const hotels = {
      findOne: jest.fn((filter: any) => ({
        lean: async () =>
          same(filter._id, HOTEL) && hotelActive ? { ...hotelDoc } : null,
      })),
      find: jest.fn((filter: any) => ({
        lean: async () =>
          hotelActive && filter._id.$in.some((id: unknown) => same(id, HOTEL))
            ? [{ ...hotelDoc }]
            : [],
      })),
    };
    let itineraryPublic = true;
    const publicItineraries = {
      findPublic: jest.fn(async (id: string) => {
        if (same(id, PUBLIC) && itineraryPublic) {
          return {
            _id: PUBLIC,
            title: 'TEST A week in Tokyo',
            countries: ['JP'],
            startDate: new Date('2026-12-10'),
            days: [{}, {}, {}],
          };
        }
        throw new NotFoundException('Itinerary not found');
      }),
    };
    const service = new FavouritesService(
      favourites as any,
      hotels as any,
      publicItineraries as any,
    );
    return {
      service,
      favourites,
      deactivateHotel: () => (hotelActive = false),
      makeItineraryPrivate: () => (itineraryPublic = false),
    };
  }

  const page = { page: 1, limit: 10 } as any;

  it('saves a hotel and a public itinerary; both are listed, newest first', async () => {
    const { service } = setup();
    const h = await service.add(user, {
      type: FavouriteType.HOTEL,
      id: String(HOTEL),
    });
    expect(h).toMatchObject({
      type: 'hotel',
      targetId: String(HOTEL),
      available: true,
      hotel: { name: 'TEST Nile View', starClass: 4, image: '/uploads/a.jpg' },
      itinerary: null,
    });
    await service.add(user, {
      type: FavouriteType.ITINERARY,
      id: String(PUBLIC),
    });

    const list = await service.list(user, page);
    expect(list.meta).toEqual({ page: 1, limit: 10, total: 2, totalPages: 1 });
    expect(list.data.map((f) => f.type)).toEqual(['itinerary', 'hotel']);
    expect(list.data[0]).toMatchObject({
      available: true,
      itinerary: { title: 'TEST A week in Tokyo', countries: ['JP'], days: 3 },
    });
  });

  it('a private (or hidden, or missing) itinerary cannot be saved: 404', async () => {
    const { service, favourites } = setup();
    await expect(
      service.add(user, { type: FavouriteType.ITINERARY, id: String(PRIVATE) }),
    ).rejects.toThrow(new NotFoundException(ITINERARY_NOT_FOUND));
    expect(favourites.docs).toHaveLength(0);
  });

  it('an inactive or unknown hotel cannot be saved: 404', async () => {
    const { service } = setup();
    for (const id of [String(INACTIVE), 'not-an-id']) {
      await expect(
        service.add(user, { type: FavouriteType.HOTEL, id }),
      ).rejects.toThrow(new NotFoundException(HOTEL_NOT_FOUND));
    }
  });

  it('saving the same hotel twice: 409', async () => {
    const { service } = setup();
    const dto = { type: FavouriteType.HOTEL, id: String(HOTEL) };
    await service.add(user, dto);
    await expect(service.add(user, dto)).rejects.toThrow(
      new ConflictException(ALREADY_SAVED),
    );
  });

  it('keeps entries that are no longer available, without their details', async () => {
    const { service, deactivateHotel, makeItineraryPrivate } = setup();
    await service.add(user, { type: FavouriteType.HOTEL, id: String(HOTEL) });
    await service.add(user, {
      type: FavouriteType.ITINERARY,
      id: String(PUBLIC),
    });
    deactivateHotel();
    makeItineraryPrivate();
    const list = await service.list(user, page);
    expect(list.data).toHaveLength(2);
    for (const f of list.data) {
      expect(f).toMatchObject({
        available: false,
        hotel: null,
        itinerary: null,
      });
    }
  });

  it('lists only my own favourites', async () => {
    const { service } = setup();
    await service.add(user, { type: FavouriteType.HOTEL, id: String(HOTEL) });
    const other = { ...user, id: String(new Types.ObjectId()) };
    await expect(service.list(other, page)).resolves.toMatchObject({
      data: [],
      meta: { total: 0 },
    });
  });

  it("removes my own favourite; another user's or an unknown one is 404", async () => {
    const { service, favourites } = setup();
    const f = await service.add(user, {
      type: FavouriteType.HOTEL,
      id: String(HOTEL),
    });
    const other = { ...user, id: String(new Types.ObjectId()) };
    await expect(service.remove(other, f._id)).rejects.toThrow(
      new NotFoundException(FAVOURITE_NOT_FOUND),
    );
    await expect(service.remove(user, 'nope')).rejects.toThrow(
      new NotFoundException(FAVOURITE_NOT_FOUND),
    );
    await service.remove(user, f._id);
    expect(favourites.docs).toHaveLength(0);
  });
});
