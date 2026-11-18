import { BadRequestException } from '@nestjs/common';
import {
  fitsGuests,
  HotelSearchCriteria,
  HotelSearchService,
} from './hotel-search.service';

// HTL-11: hotel search on top of HotelAvailabilityService.freeRoomsByHotel.
describe('HotelSearchService (HTL-11)', () => {
  const TODAY = '2026-11-18';
  const H1 = '6735a1f4c1a2b3c4d5e6f801';
  const H2 = '6735a1f4c1a2b3c4d5e6f802';
  const H3 = '6735a1f4c1a2b3c4d5e6f803';
  const hotel = (id: string, name: string) => ({
    _id: id,
    name,
    address: 'TEST street',
    cityId: 'cairo',
    countryCode: 'EG',
    starClass: 4,
    images: [],
    amenities: ['wifi'],
    isActive: true,
    checkInTime: '14:00',
    checkOutTime: '12:00',
    ratingAverage: 0,
    ratingCount: 0,
  });
  const room = (maxOccupancy: number, pricePerNight: number) => ({
    maxOccupancy,
    pricePerNight,
  });

  function setup(free: Record<string, ReturnType<typeof room>[]>) {
    const hotels = {
      find: jest.fn(() => ({
        lean: async () => [
          hotel(H1, 'TEST Two Rooms'),
          hotel(H2, 'TEST Cheap'),
          hotel(H3, 'TEST Full'),
        ],
      })),
    };
    const cities = { exists: jest.fn(async ({ _id }) => _id === 'cairo') };
    const countries = { exists: jest.fn(async ({ _id }) => _id === 'EG') };
    const availability = {
      freeRoomsByHotel: jest.fn(async () => new Map(Object.entries(free))),
    };
    const service = new HotelSearchService(
      hotels as any,
      cities as any,
      countries as any,
      availability as any,
    );
    jest.spyOn(service, 'today').mockReturnValue(TODAY);
    return { service, hotels, availability };
  }

  const criteria = (over: Partial<HotelSearchCriteria> = {}) => ({
    cityId: 'cairo',
    checkIn: '2026-12-05',
    checkOut: '2026-12-07',
    guests: 2,
    rooms: 1,
    ...over,
  });

  // The field-keyed details of a 400 (shared error format, GEN-02).
  async function details(p: Promise<unknown>) {
    try {
      await p;
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      return ((e as BadRequestException).getResponse() as { details: object })
        .details;
    }
    throw new Error('expected a 400');
  }

  describe('fitsGuests', () => {
    const rooms = [room(2, 0), room(3, 0)];
    it('two free rooms with occupancy 2 and 3: guests=5, rooms=2 fits', () => {
      expect(fitsGuests(rooms, 5, 2)).toBe(true);
    });
    it('guests=6 does not fit, and rooms=3 does not fit', () => {
      expect(fitsGuests(rooms, 6, 2)).toBe(false);
      expect(fitsGuests(rooms, 2, 3)).toBe(false);
    });
    it('uses the largest rooms first', () => {
      expect(fitsGuests([room(1, 0), room(4, 0), room(2, 0)], 4, 1)).toBe(true);
    });
  });

  it('lists only active hotels in the city that fit, cheapest first', async () => {
    const { service, hotels, availability } = setup({
      [H1]: [room(2, 15000), room(3, 9000)],
      [H2]: [room(2, 5000)],
      // H3 has no free room for the whole stay, so it is not in the map.
    });
    const result = await service.search(criteria());
    expect(hotels.find).toHaveBeenCalledWith({
      isActive: true,
      cityId: 'cairo',
    });
    expect(availability.freeRoomsByHotel).toHaveBeenCalledWith(
      [H1, H2, H3],
      '2026-12-05',
      '2026-12-07',
    );
    expect(
      result.map((h) => [h.name, h.fromPricePerNight, h.freeRoomCount]),
    ).toEqual([
      ['TEST Cheap', 5000, 1],
      ['TEST Two Rooms', 9000, 2],
    ]);
    expect(result[0]).toMatchObject({ id: H2, cityId: 'cairo', starClass: 4 });
  });

  it('5 guests in 2 rooms keeps only the hotel whose rooms hold them', async () => {
    const { service } = setup({
      [H1]: [room(2, 15000), room(3, 9000)],
      [H2]: [room(2, 5000)],
    });
    const result = await service.search(criteria({ guests: 5, rooms: 2 }));
    expect(result.map((h) => h.id)).toEqual([H1]);
    expect(await service.search(criteria({ guests: 6, rooms: 2 }))).toEqual([]);
    expect(await service.search(criteria({ guests: 2, rooms: 3 }))).toEqual([]);
  });

  it('searches a whole country', async () => {
    const { service, hotels } = setup({});
    await service.search(criteria({ cityId: undefined, countryCode: 'EG' }));
    expect(hotels.find).toHaveBeenCalledWith({
      isActive: true,
      countryCode: 'EG',
    });
  });

  it('refuses checkOut on or before checkIn, and check-in yesterday (400)', async () => {
    const { service } = setup({});
    expect(
      await details(service.search(criteria({ checkOut: '2026-12-05' }))),
    ).toEqual({ checkOut: ['checkOut must be after checkIn'] });
    expect(
      await details(
        service.search(
          criteria({ checkIn: '2026-11-17', checkOut: '2026-11-19' }),
        ),
      ),
    ).toEqual({ checkIn: ['checkIn cannot be in the past'] });
    await expect(
      service.search(criteria({ checkIn: TODAY, checkOut: '2026-11-19' })),
    ).resolves.toEqual([]);
  });

  it('needs a known city or country (400)', async () => {
    const { service } = setup({});
    expect(
      await details(service.search(criteria({ cityId: undefined }))),
    ).toEqual({ city: ['Give a city or a country'] });
    expect(
      await details(service.search(criteria({ cityId: 'atlantis' }))),
    ).toEqual({ city: ['Unknown city "atlantis"'] });
    expect(
      await details(
        service.search(criteria({ cityId: undefined, countryCode: 'XX' })),
      ),
    ).toEqual({ country: ['Unknown country "XX"'] });
  });

  it('pages the results (GEN-05)', async () => {
    const { service } = setup({
      [H1]: [room(2, 15000)],
      [H2]: [room(2, 5000)],
      [H3]: [room(2, 7000)],
    });
    const page = await service.searchPage({
      city: 'cairo',
      checkIn: '2026-12-05',
      checkOut: '2026-12-07',
      guests: 2,
      rooms: 1,
      page: 2,
      limit: 2,
    });
    expect(page.data.map((h) => h.id)).toEqual([H1]);
    expect(page.meta).toEqual({ page: 2, limit: 2, total: 3, totalPages: 2 });
  });
});
