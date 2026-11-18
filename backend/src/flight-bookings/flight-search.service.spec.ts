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
          departure: { utc: f.departureAt.toISOString() },
          durationMinutes: (f.arrivalAt - f.departureAt) / 60_000,
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

  it('shows what the passengers pay per cabin: 2 adults + 1 infant = 420 USD', async () => {
    const { service } = setup([flight(5)]);
    const res = await service.search(query({ adults: 2, infants: 1 }));
    expect(res.data[0].cabins[0]).toMatchObject({
      price: 20000,
      totalFare: 42000,
    });
  });

  it('filters by cabin (FLT-12)', async () => {
    const business = {
      _id: new Types.ObjectId(),
      category: CabinCategory.BUSINESS,
      totalSeats: 8,
      bookedSeats: 0,
      heldSeats: 0,
      price: 90000,
      freeBags: 2,
      maxKgPerBag: 32,
    };
    const both = flight(5);
    both.cabins.push(business);
    const economyOnly = flight(5);
    const { service } = setup([both, economyOnly]);

    const res = await service.search(query({ cabin: CabinCategory.BUSINESS }));
    expect(res.data).toHaveLength(1);
    expect(res.data[0].cabins.map((c) => c.category)).toEqual([
      CabinCategory.BUSINESS,
    ]);

    const all = await service.search(query());
    expect(all.data[0].cabins).toHaveLength(2);
  });

  it('one way: returnFlights is null', async () => {
    const { service } = setup([flight(5)]);
    await expect(service.search(query())).resolves.toMatchObject({
      returnFlights: null,
    });
  });

  it('round trip: searches the reversed route on returnDate too', async () => {
    const { service, flights } = setup([flight(5)]);
    const res = await service.search(query({ returnDate: '2026-12-09' }));
    const filters = (flights.find.mock.calls as any[]).map((c) => c[0]);
    expect(filters).toHaveLength(2);
    expect(filters[1]).toMatchObject({ from: 'DXB', to: 'CAI' });
    // 9 Dec at the return's departure airport, Dubai (UTC+4).
    expect(filters[1].departureAt.$gte).toEqual(
      new Date('2026-12-08T20:00:00Z'),
    );
    expect(res.data).toHaveLength(1);
    expect(res.returnFlights).toMatchObject({ meta: { total: 1 } });
  });

  it('round trip: each list says "No flights found" on its own', async () => {
    const { service, flightQuery } = setup();
    flightQuery.lean
      .mockResolvedValueOnce([flight(5)])
      .mockResolvedValueOnce([]);
    const res = await service.search(query({ returnDate: '2026-12-09' }));
    expect(res.message).toBeNull();
    expect(res.returnFlights?.message).toBe(NO_FLIGHTS_FOUND);
  });

  it('round trip: a return date before the date is 400', async () => {
    const { service } = setup();
    await expect(
      service.search(query({ returnDate: '2026-12-01' })),
    ).rejects.toBeInstanceOf(BadRequestException);
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

  // FLT-15. Three flights: 100 USD leaving 08:00 for 4h, 200 USD leaving
  // 06:00 for 2h, 300 USD leaving 07:00 for 3h (all UTC, 2 Dec).
  function priced() {
    const at = (h: number, hours: number, price: number) => {
      const f = flight(5, {
        flightNumber: `NP${price}`,
        departureAt: new Date(`2026-12-02T0${h}:00:00Z`),
        arrivalAt: new Date(
          `2026-12-02T${String(h + hours).padStart(2, '0')}:00:00Z`,
        ),
      });
      f.cabins[0].price = price * 100;
      return f;
    };
    return [at(8, 4, 100), at(6, 2, 200), at(7, 3, 300)];
  }
  const numbers = (res: { data: { flightNumber?: string; _id: string }[] }) =>
    res.data.map((o: any) => o.lowestPrice / 100);

  describe('price filter and sort (FLT-15)', () => {
    it('minPrice=200&maxPrice=300 keeps 2 of 100, 200, 300 (inclusive)', async () => {
      const { service } = setup(priced());
      const res = await service.search(
        query({ minPrice: 20000, maxPrice: 30000 }),
      );
      expect(numbers(res).sort()).toEqual([200, 300]);
    });

    it('minPrice above maxPrice is 400', async () => {
      const { service } = setup(priced());
      await expect(
        service.search(query({ minPrice: 30000, maxPrice: 10000 })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('sorts by price, both ways', async () => {
      const { service } = setup(priced());
      expect(numbers(await service.search(query({ sort: 'price' })))).toEqual([
        100, 200, 300,
      ]);
      expect(
        numbers(await service.search(query({ sort: 'price:desc' }))),
      ).toEqual([300, 200, 100]);
    });

    it('sorts by duration (arrival minus departure)', async () => {
      const { service } = setup(priced());
      const res = await service.search(query({ sort: 'duration' }));
      expect(res.data.map((o) => o.durationMinutes)).toEqual([120, 180, 240]);
    });

    it('sorts by departure, earliest first by default', async () => {
      const { service } = setup(priced());
      expect(numbers(await service.search(query()))).toEqual([200, 300, 100]);
      expect(
        numbers(await service.search(query({ sort: 'departure:desc' }))),
      ).toEqual([100, 300, 200]);
    });

    it('rejects an unknown sort with 400', async () => {
      const { service } = setup(priced());
      await expect(
        service.search(query({ sort: 'airline' })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('uses the chosen cabin for the price when ?cabin is given', async () => {
      const f = flight(5);
      f.cabins.push({
        _id: new Types.ObjectId(),
        category: CabinCategory.BUSINESS,
        totalSeats: 8,
        bookedSeats: 0,
        heldSeats: 0,
        price: 90000,
        freeBags: 2,
        maxKgPerBag: 32,
      });
      const { service } = setup([f]);
      const cheapest = await service.search(query());
      expect(cheapest.data[0].lowestPrice).toBe(20000);
      const business = await service.search(
        query({ cabin: CabinCategory.BUSINESS, minPrice: 50000 }),
      );
      expect(business.data[0].lowestPrice).toBe(90000);
    });
  });
});
