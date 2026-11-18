import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { FlightSearchQueryDto } from './dto/flight-search-query.dto';
import { FlightSearchService, NO_FLIGHTS_FOUND } from './flight-search.service';
import { CabinCategory, FlightStatus } from '../flights/schemas/flight.schema';

// FLT-11 with mocked models. The chapter's "Test when done" cases.
describe('FlightSearchService (FLT-11)', () => {
  const AIRLINE = new Types.ObjectId();
  const INACTIVE = new Types.ObjectId();
  const AIRPORTS: Record<string, { _id: string; timeZone: string }> = {
    CAI: { _id: 'CAI', timeZone: 'Africa/Cairo' },
    DXB: { _id: 'DXB', timeZone: 'Asia/Dubai' },
  };

  // A CAI -> DXB flight leaving 00:30 Cairo time on 2 Dec (22:30 UTC, 1 Dec).
  function flight(seatsLeft: number, extra: object = {}) {
    return {
      _id: new Types.ObjectId(),
      airlineId: AIRLINE,
      flightNumber: 'NP101',
      from: 'CAI',
      to: 'DXB',
      departureAt: new Date('2026-12-01T22:30:00Z'),
      arrivalAt: new Date('2026-12-02T02:30:00Z'),
      departureDate: '2026-12-02',
      status: FlightStatus.SCHEDULED,
      cabins: [
        {
          _id: new Types.ObjectId(),
          category: CabinCategory.ECONOMY,
          totalSeats: 10,
          bookedSeats: 10 - seatsLeft,
          heldSeats: 0,
          price: 20000,
          freeBags: 1,
          maxKgPerBag: 23,
        },
      ],
      ...extra,
    };
  }

  function setup(found: object[] = []) {
    const flightQuery = {
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn(async () => found),
    };
    const flights = { find: jest.fn(() => flightQuery) };
    const airlines = {
      find: jest.fn((filter: { isActive?: boolean }) => ({
        lean: async () =>
          filter.isActive === false
            ? [{ _id: INACTIVE }]
            : [{ _id: AIRLINE, name: 'Nile Air', code: 'NP', logo: null }],
      })),
    };
    const airports = {
      assertAirportExists: jest.fn(async (code: string) => {
        if (!AIRPORTS[code]) {
          throw new BadRequestException(`Unknown airport "${code}"`);
        }
        return AIRPORTS[code];
      }),
    };
    // Hazem's toViews(), reduced to what the search uses.
    const views = {
      toViews: jest.fn(async (fs: any[]) =>
        fs.map((f) => ({
          _id: String(f._id),
          airlineId: String(f.airlineId),
          cabins: f.cabins,
        })),
      ),
    };
    const service = new FlightSearchService(
      flights as any,
      airlines as any,
      airports as any,
      views as any,
    );
    return { service, flights, flightQuery };
  }

  const query = (q: Partial<FlightSearchQueryDto> = {}) =>
    ({
      from: 'CAI',
      to: 'DXB',
      date: '2026-12-02',
      page: 1,
      limit: 10,
      ...q,
    }) as FlightSearchQueryDto;

  it('searches the local day at the departure airport, in UTC', async () => {
    const { service, flights } = setup();
    await service.search(query());
    const filter = (flights.find.mock.calls as any[])[0][0];
    // 2 Dec in Cairo (UTC+2) = 22:00 UTC on 1 Dec up to 22:00 UTC on 2 Dec,
    // so 22:30 UTC on 1 Dec is inside it ...
    expect(filter.departureAt.$gte).toEqual(new Date('2026-12-01T22:00:00Z'));
    expect(filter.departureAt.$lt).toEqual(new Date('2026-12-02T22:00:00Z'));
  });

  it('... and date=2026-12-01 ends before that flight leaves', async () => {
    const { service, flights } = setup();
    await service.search(query({ date: '2026-12-01' }));
    const filter = (flights.find.mock.calls as any[])[0][0];
    expect(filter.departureAt.$lt).toEqual(new Date('2026-12-01T22:00:00Z'));
    expect(new Date('2026-12-01T22:30:00Z') < filter.departureAt.$lt).toBe(
      false,
    );
  });

  it('lists only Scheduled, not yet departed flights of active airlines', async () => {
    const { service, flights, flightQuery } = setup();
    await service.search(query());
    const filter = (flights.find.mock.calls as any[])[0][0];
    expect(filter).toMatchObject({
      status: FlightStatus.SCHEDULED,
      from: 'CAI',
      to: 'DXB',
      airlineId: { $nin: [INACTIVE] },
    });
    expect(filter.departureAt.$gt).toBeInstanceOf(Date);
    expect(flightQuery.sort).toHaveBeenCalledWith({ departureAt: 1 });
  });

  it('lists a flight with enough seats, with its airline', async () => {
    const { service } = setup([flight(4)]);
    const res = await service.search(query({ passengers: 4 }));
    expect(res.data).toHaveLength(1);
    expect(res.data[0].airline).toMatchObject({ name: 'Nile Air', code: 'NP' });
    expect(res.message).toBeNull();
  });

  it('does not list 3 free seats for 4 passengers', async () => {
    const { service } = setup([flight(3)]);
    const res = await service.search(query({ passengers: 4 }));
    expect(res.data).toEqual([]);
    expect(res.message).toBe(NO_FLIGHTS_FOUND);
  });

  it('infants take no seat: 2 adults + 1 infant fit in 2 seats', async () => {
    const { service } = setup([flight(2)]);
    const res = await service.search(query({ adults: 2, infants: 1 }));
    expect(res.data).toHaveLength(1);
  });

  it('answers 200 with "No flights found" when nothing matches', async () => {
    const { service } = setup([]);
    await expect(service.search(query())).resolves.toMatchObject({
      data: [],
      meta: { total: 0 },
      message: NO_FLIGHTS_FOUND,
    });
  });

  it('rejects the same airport twice and unknown airports with 400', async () => {
    const { service } = setup();
    await expect(service.search(query({ to: 'CAI' }))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.search(query({ to: 'XXX' }))).rejects.toThrow(
      'Unknown airport "XXX"',
    );
  });

  it('rejects ?passengers mixed with ?adults', async () => {
    const { service } = setup();
    await expect(
      service.search(query({ passengers: 2, adults: 1 })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('pages the results, 10 per page', async () => {
    const many = Array.from({ length: 12 }, () => flight(5));
    const { service } = setup(many);
    const res = await service.search(query({ page: 2 }));
    expect(res.data).toHaveLength(2);
    expect(res.meta).toEqual({ page: 2, limit: 10, total: 12, totalPages: 2 });
  });
});
