import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ItinerariesService } from './itineraries.service';
import { ItineraryHotelsService, groupStay } from './itinerary-hotels.service';
import {
  ITN_ID,
  OWNER,
  STRANGER,
  day,
  itinerary,
} from './itinerary.fixtures-spec';

// ITN-25: hotels for a city group's dates, reusing HTL-11 availability.
describe('ItineraryHotelsService (ITN-25)', () => {
  // Cairo 1-4 Dec, Luxor 5-6 Dec.
  const trip = () =>
    itinerary(
      ['cairo', 'cairo', 'cairo', 'cairo', 'luxor', 'luxor'].map((c) => day(c)),
    );

  it('a Luxor group on 5 and 6 Dec searches from 5 Dec to 7 Dec', () => {
    expect(groupStay(trip(), 1)).toMatchObject({
      cityId: 'luxor',
      checkIn: '2026-12-05',
      checkOut: '2026-12-07',
    });
  });

  it('refuses a group that does not exist (400)', () => {
    expect(() => groupStay(trip(), 5)).toThrow(BadRequestException);
  });

  function setup() {
    const doc = trip();
    const itineraries = {
      findById: jest.fn(() => ({ lean: async () => doc })),
    };
    const hotels = Array.from({ length: 12 }, (_, i) => ({
      id: new Types.ObjectId().toString(),
      name: `TEST Hotel ${i + 1}`,
      cityId: 'luxor',
      fromPricePerNight: 5000 + i * 1000,
    }));
    const hotelSearch = { search: jest.fn(async () => hotels) };
    const service = new ItineraryHotelsService(
      new ItinerariesService(itineraries as any, {} as any),
      hotelSearch as any,
    );
    return { service, hotelSearch };
  }

  it("calls Memo's hotel search (HTL-11) with the group's city and dates", async () => {
    const { service, hotelSearch } = setup();
    const result = await service.hotelsForGroup(OWNER, ITN_ID, {
      groupIndex: 1,
      guests: 2,
      rooms: 1,
      page: 2,
      limit: 10,
    });
    expect(hotelSearch.search).toHaveBeenCalledWith({
      cityId: 'luxor',
      checkIn: '2026-12-05',
      checkOut: '2026-12-07',
      guests: 2,
      rooms: 1,
    });
    expect(result.data.map((h: any) => h.name)).toEqual([
      'TEST Hotel 11',
      'TEST Hotel 12',
    ]);
    expect(result.meta).toEqual({
      page: 2,
      limit: 10,
      total: 12,
      totalPages: 2,
    });
    expect(result.search).toMatchObject({ checkIn: '2026-12-05', guests: 2 });
  });

  it('refuses more rooms than guests (400) and other users (404)', async () => {
    const { service } = setup();
    const q = { groupIndex: 0, guests: 1, rooms: 2, page: 1, limit: 10 };
    await expect(
      service.hotelsForGroup(OWNER, ITN_ID, q),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.hotelsForGroup(STRANGER, ITN_ID, { ...q, rooms: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
