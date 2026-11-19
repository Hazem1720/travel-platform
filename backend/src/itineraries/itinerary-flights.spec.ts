import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ItinerariesService } from './itineraries.service';
import { ItineraryFlightsService } from './itinerary-flights.service';
import {
  ITN_ID,
  OWNER,
  STRANGER,
  day,
  itinerary,
} from './itinerary.fixtures-spec';

// A flight option as FlightSearchService.findOptions() returns it.
function option(from: string, to: string, depart: string, price = 20000) {
  const dep = new Date(depart);
  return {
    _id: `${from}-${to}-${depart}`,
    from,
    to,
    departure: { utc: dep.toISOString() },
    arrival: { utc: new Date(dep.getTime() + 3 * 3600_000).toISOString() },
    lowestPrice: price,
  };
}

// ITN-26: flights to the first day's city, reusing FLT-11 and FLT-12.
describe('ItineraryFlightsService (ITN-26)', () => {
  // Starts in Dubai on 1 Dec; last day 4 Dec.
  const trip = () =>
    itinerary(['dubai', 'dubai', 'abu_dhabi', 'abu_dhabi'].map((c) => day(c)));

  function setup(doc: any = trip()) {
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
    const flights: Record<string, any[]> = {
      'CAI-DWC': [option('CAI', 'DWC', '2026-12-01T12:00:00Z', 30000)],
      'CAI-DXB': [option('CAI', 'DXB', '2026-12-01T08:00:00Z', 25000)],
      'DXB-CAI': [option('DXB', 'CAI', '2026-12-04T09:00:00Z')],
      'DWC-CAI': [option('DWC', 'CAI', '2026-12-04T07:00:00Z')],
    };
    const search = {
      findOptions: jest.fn<any, any[]>(
        async (c: any) => flights[`${c.from}-${c.to}`] ?? [],
      ),
    };
    const service = new ItineraryFlightsService(
      new ItinerariesService(itineraries as any, {} as any),
      airportsService as any,
      airports as any,
      search as any,
    );
    return { service, search, airports };
  }
  const q = (extra: object = {}) =>
    ({
      origin: 'CAI',
      roundTrip: false,
      page: 1,
      limit: 10,
      returnPage: 1,
      ...extra,
    }) as any;

  it('searches CAI to every airport of the first city on the start date, merged earliest first', async () => {
    const { service, search, airports } = setup();
    const result = await service.flightsFor(OWNER, ITN_ID, q());
    expect(airports.find).toHaveBeenCalledWith({ cityId: 'dubai' }, { _id: 1 });
    expect(search.findOptions.mock.calls.map((c) => c[0])).toEqual([
      expect.objectContaining({ from: 'CAI', to: 'DWC', date: '2026-12-01' }),
      expect.objectContaining({ from: 'CAI', to: 'DXB', date: '2026-12-01' }),
    ]);
    expect(search.findOptions.mock.calls[0][0].passengers).toEqual({
      adults: 1,
      children: 0,
      infants: 0,
    });
    expect(result.data.map((f: any) => f.to)).toEqual(['DXB', 'DWC']);
    expect(result.meta.total).toBe(2);
    expect(result.returnFlights).toBeNull();
    expect(result.search).toEqual({
      origin: 'CAI',
      cityId: 'dubai',
      destinations: ['DWC', 'DXB'],
      date: '2026-12-01',
      roundTrip: false,
    });
  });

  it("roundTrip=true adds the flights back on the last day's date", async () => {
    const { service, search } = setup();
    const result = await service.flightsFor(
      OWNER,
      ITN_ID,
      q({ roundTrip: true }),
    );
    const back = search.findOptions.mock.calls
      .map((c) => c[0])
      .filter((c) => c.to === 'CAI');
    expect(back.map((c) => [c.from, c.date])).toEqual([
      ['DWC', '2026-12-04'],
      ['DXB', '2026-12-04'],
    ]);
    expect(result.search).toMatchObject({
      returnDate: '2026-12-04',
      roundTrip: true,
    });
    expect(result.returnFlights!.data.map((f: any) => f.from)).toEqual([
      'DWC',
      'DXB',
    ]);
  });

  it('uses the dates, passengers, cabin and sort the user gives', async () => {
    const { service, search } = setup();
    const result = await service.flightsFor(
      OWNER,
      ITN_ID,
      q({
        date: '2026-12-02',
        returnDate: '2026-12-06',
        adults: 2,
        infants: 1,
        cabin: 'Business',
        sort: 'price:desc',
      }),
    );
    expect(search.findOptions.mock.calls[0][0]).toMatchObject({
      date: '2026-12-02',
      passengers: { adults: 2, children: 0, infants: 1 },
      cabin: 'Business',
      sort: { field: 'price', direction: -1 },
    });
    expect(result.search.returnDate).toBe('2026-12-06');
    expect(result.data.map((f: any) => f.lowestPrice)).toEqual([30000, 25000]);
  });

  it('applies the FLT-12 rules: return date and passenger mix (400)', async () => {
    const { service } = setup();
    await expect(
      service.flightsFor(OWNER, ITN_ID, q({ returnDate: '2026-11-30' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.flightsFor(OWNER, ITN_ID, q({ adults: 1, infants: 2 })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('says "No flights found" when none match', async () => {
    const { service, search } = setup();
    search.findOptions.mockResolvedValue([]);
    const result = await service.flightsFor(OWNER, ITN_ID, q());
    expect(result).toMatchObject({ data: [], message: 'No flights found' });
  });

  it('refuses an unknown origin or an itinerary without days (400)', async () => {
    const { service } = setup();
    await expect(
      service.flightsFor(OWNER, ITN_ID, q({ origin: 'XXX' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    const empty = setup(itinerary([]));
    await expect(
      empty.service.flightsFor(OWNER, ITN_ID, q()),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("answers 404 for another user's itinerary", async () => {
    const { service } = setup();
    await expect(
      service.flightsFor(STRANGER, ITN_ID, q()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
