import {
  BadRequestException,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { ItinerariesService } from './itineraries.service';
import { ItineraryFlightsService } from './itinerary-flights.service';
import {
  ITN_ID,
  OWNER,
  STRANGER,
  day,
  itinerary,
} from './itinerary.fixtures-spec';

// ITN-26: flights to the first day's city, reusing FLT-11 and FLT-12.
describe('ItineraryFlightsService (ITN-26)', () => {
  // Starts in Dubai on 1 Dec; last day 4 Dec.
  const trip = () =>
    itinerary(['dubai', 'dubai', 'abu_dhabi', 'abu_dhabi'].map((c) => day(c)));

  function setup(withSearch = true, doc: any = trip()) {
    const itineraries = {
      findById: jest.fn(() => ({ lean: async () => doc })),
    };
    const airportsService = {
      assertAirportExists: jest.fn(async (code: string) => {
        if (code !== 'CAI') throw new BadRequestException('Unknown airport');
        return { _id: 'CAI' };
      }),
    };
    const airports = {
      find: jest.fn(() => ({
        sort: () => ({ lean: async () => [{ _id: 'DWC' }, { _id: 'DXB' }] }),
      })),
    };
    const search = {
      search: jest.fn(async (q: any) => ({
        data: [{ flight: `${q.from}-${q.to}` }],
        meta: { page: 1, limit: 10, total: 1, totalPages: 1 },
      })),
    };
    const service = new ItineraryFlightsService(
      new ItinerariesService(itineraries as any, {} as any),
      airportsService as any,
      airports as any,
      withSearch ? (search as any) : undefined,
    );
    return { service, search, airports };
  }

  it('searches CAI to every Dubai airport on the start date', async () => {
    const { service, search, airports } = setup();
    const result = await service.flightsFor(OWNER, ITN_ID, {
      origin: 'CAI',
      roundTrip: false,
      page: 1,
      limit: 10,
    });
    expect(airports.find).toHaveBeenCalledWith({ cityId: 'dubai' }, { _id: 1 });
    expect(search.search.mock.calls.map((c) => [c[0].to, c[0].date])).toEqual([
      ['DWC', '2026-12-01'],
      ['DXB', '2026-12-01'],
    ]);
    expect(search.search.mock.calls[0][0].returnDate).toBeUndefined();
    expect(result.data).toHaveLength(2);
  });

  it("roundTrip=true adds the return on the last day's date", async () => {
    const { service, search } = setup();
    const result = await service.flightsFor(OWNER, ITN_ID, {
      origin: 'CAI',
      roundTrip: true,
      page: 1,
      limit: 10,
    });
    expect(search.search.mock.calls[0][0].returnDate).toBe('2026-12-04');
    expect(result.search).toMatchObject({ returnDate: '2026-12-04' });
  });

  it('answers 501 with the computed search until FLT-11 is merged', async () => {
    const { service } = setup(false);
    await expect(
      service.flightsFor(OWNER, ITN_ID, {
        origin: 'CAI',
        roundTrip: false,
        page: 1,
        limit: 10,
      }),
    ).rejects.toBeInstanceOf(NotImplementedException);
  });

  it('refuses an unknown origin or an itinerary without days (400)', async () => {
    const { service } = setup();
    const q = { origin: 'XXX', roundTrip: false, page: 1, limit: 10 };
    await expect(service.flightsFor(OWNER, ITN_ID, q)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const empty = setup(true, itinerary([]));
    await expect(
      empty.service.flightsFor(OWNER, ITN_ID, { ...q, origin: 'CAI' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("answers 404 for another user's itinerary", async () => {
    const { service } = setup();
    await expect(
      service.flightsFor(STRANGER, ITN_ID, {
        origin: 'CAI',
        roundTrip: false,
        page: 1,
        limit: 10,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
