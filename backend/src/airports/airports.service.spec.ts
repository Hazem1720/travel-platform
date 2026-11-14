import { BadRequestException } from '@nestjs/common';
import { AirportsService } from './airports.service';

// FLT-02: the read-only airport list and the "known airport" check.
const AIRPORTS = [
  {
    _id: 'CAI',
    name: 'Cairo International Airport',
    cityId: 'cairo',
    countryCode: 'EG',
    timeZone: 'Africa/Cairo',
  },
  {
    _id: 'FRA',
    name: 'Frankfurt Airport',
    cityId: 'frankfurt',
    countryCode: 'DE',
    timeZone: 'Europe/Berlin',
  },
];

// A chainable stand-in for Model.find(): records the calls, returns `rows`.
function query(rows: unknown) {
  const q: any = {};
  for (const m of ['sort', 'skip', 'limit']) q[m] = jest.fn(() => q);
  q.lean = jest.fn(async () => rows);
  return q;
}

function setup() {
  const found = query(AIRPORTS);
  const airports = {
    find: jest.fn<any, [any]>(() => found),
    countDocuments: jest.fn(async () => AIRPORTS.length),
    findById: jest.fn((id: string) => ({
      lean: async () => AIRPORTS.find((a) => a._id === id) ?? null,
    })),
  };
  const cities = {
    find: jest.fn(() =>
      query([
        { _id: 'cairo', name: 'Cairo' },
        { _id: 'frankfurt', name: 'Frankfurt' },
      ]),
    ),
  };
  const countries = {
    find: jest.fn(() =>
      query([
        { _id: 'EG', name: 'Egypt' },
        { _id: 'DE', name: 'Germany' },
      ]),
    ),
  };
  const service = new AirportsService(
    airports as any,
    cities as any,
    countries as any,
  );
  return { service, airports, found };
}

describe('AirportsService', () => {
  describe('list', () => {
    it('returns code, name, city, country and time zone', async () => {
      const { service, found } = setup();
      const page = await service.list({ page: 1, limit: 10 });
      expect(page.meta).toEqual({
        page: 1,
        limit: 10,
        total: 2,
        totalPages: 1,
      });
      expect(page.data[1]).toEqual({
        code: 'FRA',
        name: 'Frankfurt Airport',
        cityId: 'frankfurt',
        city: 'Frankfurt',
        countryCode: 'DE',
        country: 'Germany',
        timeZone: 'Europe/Berlin',
      });
      expect(found.sort).toHaveBeenCalledWith({ _id: 1 });
      expect(found.skip).toHaveBeenCalledWith(0);
      expect(found.limit).toHaveBeenCalledWith(10);
    });

    it('searches code, name and city id case-insensitively', async () => {
      const { service, airports } = setup();
      await service.list({ page: 1, limit: 10, search: 'cai' });
      const filter = airports.find.mock.calls[0][0];
      expect(filter.$or).toHaveLength(3);
      expect(filter.$or[0]._id.test('CAI')).toBe(true);
    });

    it('treats search text literally, not as a pattern', async () => {
      const { service, airports } = setup();
      await service.list({ page: 1, limit: 10, search: '.*' });
      const re: RegExp = airports.find.mock.calls[0][0].$or[1].name;
      expect(re.test('Cairo International Airport')).toBe(false);
      expect(re.test('a.* b')).toBe(true);
    });

    it('sorts by name and skips to the requested page', async () => {
      const { service, found } = setup();
      await service.list({ page: 2, limit: 5, sort: 'name:desc' });
      expect(found.sort).toHaveBeenCalledWith({ name: -1 });
      expect(found.skip).toHaveBeenCalledWith(5);
    });

    it('rejects an unknown sort field', async () => {
      const { service } = setup();
      await expect(
        service.list({ page: 1, limit: 10, sort: 'timeZone:asc' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('assertAirportExists', () => {
    it('returns a known airport with its time zone', async () => {
      const { service } = setup();
      await expect(service.assertAirportExists('FRA')).resolves.toMatchObject({
        _id: 'FRA',
        timeZone: 'Europe/Berlin',
      });
    });

    it('accepts a lowercase code', async () => {
      const { service, airports } = setup();
      await service.assertAirportExists(' cai ');
      expect(airports.findById).toHaveBeenCalledWith('CAI');
    });

    it.each(['XXX', '', undefined])('rejects %p with 400', async (code) => {
      const { service } = setup();
      await expect(service.assertAirportExists(code)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
