import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { HotelSearchQueryDto } from './dto/hotel-search.dto';
import {
  HotelSearchCriteria,
  HotelSearchService,
  parseHotelSort,
} from './hotel-search.service';

// HTL-12: price and rating filters and sorting on top of the HTL-11 search.
describe('Hotel search filters and sort (HTL-12)', () => {
  const TODAY = '2026-11-18';
  // id, name, cheapest free room (cents), rating average, rating count
  const HOTELS: [string, string, number, number, number][] = [
    ['6735a1f4c1a2b3c4d5e6f801', 'TEST Fifty', 5000, 3.5, 4],
    ['6735a1f4c1a2b3c4d5e6f802', 'TEST Eighty', 8000, 4.6, 10],
    ['6735a1f4c1a2b3c4d5e6f803', 'TEST One Twenty', 12000, 4.0, 2],
    ['6735a1f4c1a2b3c4d5e6f804', 'TEST Unrated', 9000, 0, 0],
  ];

  function setup(hotels = HOTELS) {
    const hotelModel = {
      find: jest.fn(() => ({
        lean: async () =>
          hotels.map(([_id, name, , ratingAverage, ratingCount]) => ({
            _id,
            name,
            address: 'TEST street',
            cityId: 'cairo',
            countryCode: 'EG',
            starClass: 4,
            isActive: true,
            checkInTime: '14:00',
            checkOutTime: '12:00',
            ratingAverage,
            ratingCount,
          })),
      })),
    };
    const availability = {
      freeRoomsByHotel: jest.fn(
        async () =>
          new Map(
            hotels.map(([id, , price]) => [
              id,
              [
                { maxOccupancy: 2, pricePerNight: price },
                { maxOccupancy: 2, pricePerNight: price + 3000 },
              ],
            ]),
          ),
      ),
    };
    const service = new HotelSearchService(
      hotelModel as any,
      { exists: async () => true } as any,
      { exists: async () => true } as any,
      {} as any,
      availability as any,
    );
    jest.spyOn(service, 'today').mockResolvedValue(TODAY);
    return service;
  }

  const criteria = (over: Partial<HotelSearchCriteria> = {}) => ({
    cityId: 'cairo',
    checkIn: '2026-12-05',
    checkOut: '2026-12-07',
    guests: 2,
    rooms: 1,
    ...over,
  });
  const names = (r: { name: string }[]) => r.map((h) => h.name);

  it('hotels at 50, 80 and 120 USD: minPrice=80&maxPrice=120 returns 2 (inclusive)', async () => {
    const service = setup(HOTELS.slice(0, 3));
    const res = await service.search(
      criteria({ minPrice: 8000, maxPrice: 12000 }),
    );
    expect(names(res)).toEqual(['TEST Eighty', 'TEST One Twenty']);
  });

  it("uses the cheapest qualifying room's price, not a dearer room's", async () => {
    // TEST Fifty's second room costs 80 USD, but the hotel's price is 50.
    const service = setup(HOTELS.slice(0, 3));
    const res = await service.search(criteria({ minPrice: 8000 }));
    expect(names(res)).not.toContain('TEST Fifty');
    const max = await service.search(criteria({ maxPrice: 5000 }));
    expect(names(max)).toEqual(['TEST Fifty']);
  });

  it('minRating=4 keeps hotels rated 4 or more and hides the unrated hotel', async () => {
    const service = setup();
    const res = await service.search(criteria({ minRating: 4 }));
    expect(names(res)).toEqual(['TEST Eighty', 'TEST One Twenty']);
  });

  it('minRating=1 still hides the unrated hotel; no minRating keeps it', async () => {
    const service = setup();
    expect(names(await service.search(criteria({ minRating: 1 })))).toEqual([
      'TEST Fifty',
      'TEST Eighty',
      'TEST One Twenty',
    ]);
    expect(names(await service.search(criteria()))).toContain('TEST Unrated');
  });

  it('price and rating filters together keep the other criteria', async () => {
    const service = setup();
    const res = await service.search(
      criteria({ minPrice: 6000, maxPrice: 13000, minRating: 4.5 }),
    );
    expect(names(res)).toEqual(['TEST Eighty']);
  });

  it('sort=price:asc (the default) and price:desc', async () => {
    const service = setup();
    const asc = await service.search(
      criteria({ sort: parseHotelSort('price:asc') }),
    );
    expect(asc.map((h) => h.fromPricePerNight)).toEqual([
      5000, 8000, 9000, 12000,
    ]);
    expect(names(await service.search(criteria()))).toEqual(names(asc));
    const desc = await service.search(
      criteria({ sort: parseHotelSort('price:desc') }),
    );
    expect(desc.map((h) => h.fromPricePerNight)).toEqual([
      12000, 9000, 8000, 5000,
    ]);
  });

  it('sort=rating:desc puts the best rated first and the unrated last', async () => {
    const service = setup();
    const res = await service.search(
      criteria({ sort: parseHotelSort('rating:desc') }),
    );
    expect(res.map((h) => h.ratingAverage)).toEqual([4.6, 4.0, 3.5, 0]);
    const asc = await service.search(
      criteria({ sort: parseHotelSort('rating') }),
    );
    expect(asc.map((h) => h.ratingAverage)).toEqual([0, 3.5, 4.0, 4.6]);
  });

  it('equal ratings: the cheaper hotel first', async () => {
    const service = setup([
      ['6735a1f4c1a2b3c4d5e6f811', 'TEST B Dear', 9000, 4, 3],
      ['6735a1f4c1a2b3c4d5e6f812', 'TEST A Cheap', 6000, 4, 5],
    ]);
    const res = await service.search(
      criteria({ sort: parseHotelSort('rating:desc') }),
    );
    expect(names(res)).toEqual(['TEST A Cheap', 'TEST B Dear']);
  });

  it('minPrice above maxPrice: 400 with details.minPrice', async () => {
    const service = setup();
    const err = await service
      .search(criteria({ minPrice: 12000, maxPrice: 8000 }))
      .catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse().details).toEqual({
      minPrice: ['minPrice cannot be greater than maxPrice'],
    });
  });

  it('searchPage passes the filters and the sort through, then pages', async () => {
    const service = setup();
    const page = await service.searchPage({
      city: 'cairo',
      checkIn: '2026-12-05',
      checkOut: '2026-12-07',
      guests: 2,
      rooms: 1,
      page: 1,
      limit: 10,
      minRating: 4,
      sort: 'rating:desc',
    } as HotelSearchQueryDto);
    expect(names(page.data)).toEqual(['TEST Eighty', 'TEST One Twenty']);
    expect(page.meta.total).toBe(2);
  });

  describe('parseHotelSort', () => {
    it('reads price and rating with an optional direction', () => {
      expect(parseHotelSort()).toEqual({ field: 'price', direction: 1 });
      expect(parseHotelSort('rating:desc')).toEqual({
        field: 'rating',
        direction: -1,
      });
    });
    it('refuses anything else with 400', () => {
      for (const s of ['name', 'price:up', 'rating:desc:x']) {
        expect(() => parseHotelSort(s)).toThrow(BadRequestException);
      }
    });
  });

  describe('query validation', () => {
    const base = {
      city: 'cairo',
      checkIn: '2026-12-05',
      checkOut: '2026-12-07',
      guests: '2',
    };
    const failed = async (extra: object) =>
      (
        await validate(
          plainToInstance(HotelSearchQueryDto, { ...base, ...extra }),
        )
      ).map((e) => e.property);

    it('accepts the HTL-12 parameters', async () => {
      expect(
        await failed({
          minPrice: '8000',
          maxPrice: '12000',
          minRating: '4.5',
          sort: 'price:asc',
        }),
      ).toEqual([]);
    });

    it('minRating=6 and minRating=0: 400', async () => {
      expect(await failed({ minRating: '6' })).toEqual(['minRating']);
      expect(await failed({ minRating: '0' })).toEqual(['minRating']);
    });

    it('negative or fractional prices and an unknown sort: 400', async () => {
      expect(await failed({ minPrice: '-1' })).toEqual(['minPrice']);
      expect(await failed({ maxPrice: '10.5' })).toEqual(['maxPrice']);
      expect(await failed({ sort: 'stars:desc' })).toEqual(['sort']);
    });
  });
});
