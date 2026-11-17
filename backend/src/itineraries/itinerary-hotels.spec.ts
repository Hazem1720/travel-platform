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
    const small = new Types.ObjectId();
    const big = new Types.ObjectId();
    const hotels = {
      find: jest.fn(() => ({
        lean: async () => [
          { _id: small, name: 'TEST Small', cityId: 'luxor' },
          { _id: big, name: 'TEST Big', cityId: 'luxor' },
        ],
      })),
    };
    const availability = {
      freeRoomsByHotel: jest.fn(
        async () =>
          new Map([
            [String(small), [{ maxOccupancy: 1, pricePerNight: 5000 }]],
            [
              String(big),
              [
                { maxOccupancy: 2, pricePerNight: 9000 },
                { maxOccupancy: 3, pricePerNight: 15000 },
              ],
            ],
          ]),
      ),
    };
    const service = new ItineraryHotelsService(
      new ItinerariesService(itineraries as any, {} as any),
      availability as any,
      hotels as any,
    );
    return { service, hotels, availability };
  }

  it('asks HTL-11 availability for the group dates and keeps hotels that fit the guests', async () => {
    const { service, hotels, availability } = setup();
    const result = await service.hotelsForGroup(OWNER, ITN_ID, {
      groupIndex: 1,
      guests: 2,
      rooms: 1,
      page: 1,
      limit: 10,
    });
    expect(hotels.find).toHaveBeenCalledWith({
      cityId: 'luxor',
      isActive: true,
    });
    expect(availability.freeRoomsByHotel.mock.calls[0]).toEqual([
      expect.any(Array),
      '2026-12-05',
      '2026-12-07',
    ]);
    expect(result.data.map((h: any) => h.name)).toEqual(['TEST Big']);
    expect(result.data[0]).toMatchObject({ fromPricePerNight: 9000 });
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
