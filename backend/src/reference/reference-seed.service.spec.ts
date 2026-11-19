import { SUPPORTED_CURRENCIES } from '../common/constants/currencies';
import * as referenceData from '../seed/reference-data';
import { currenciesOf, loadReferenceData } from '../seed/reference-data';
import { ReferenceSeedService } from './reference-seed.service';

function model() {
  return {
    bulkWrite: jest.fn<any, any[]>(async () => ({})),
    deleteMany: jest.fn<any, any[]>(async () => ({ deletedCount: 1 })),
  };
}

function setup() {
  const m = {
    countries: model(),
    cities: model(),
    airports: model(),
    attractions: model(),
    currencies: model(),
  };
  const service = new ReferenceSeedService(
    m.countries as any,
    m.cities as any,
    m.airports as any,
    m.attractions as any,
    m.currencies as any,
  );
  return { service, m };
}

describe('GEN-12: reference data seeded at setup', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
    jest.restoreAllMocks();
  });

  it('derives the supported currencies from the official countries', () => {
    const currencies = currenciesOf(loadReferenceData().countries);
    expect(currencies.map((c) => c._id)).toEqual([...SUPPORTED_CURRENCIES]);
    expect(currencies.find((c) => c._id === 'EUR')!.countries).toEqual([
      'DE',
      'FR',
    ]);
  });

  it('upserts every country, city, airport, attraction and currency by id', async () => {
    const { service, m } = setup();
    const counts = await service.seed();
    expect(counts).toEqual({
      countries: 8,
      cities: 8,
      airports: 8,
      attractions: 8,
      currencies: SUPPORTED_CURRENCIES.length,
      removed: 0,
    });
    const ops = m.airports.bulkWrite.mock.calls[0][0];
    expect(ops).toHaveLength(8);
    expect(ops[0].updateOne).toMatchObject({
      filter: { _id: expect.any(String) },
      upsert: true,
    });
    expect(m.currencies.bulkWrite.mock.calls[0][0][0].updateOne.update).toEqual(
      { $set: { _id: 'AED', countries: ['AE'] } },
    );
    expect(m.countries.deleteMany).not.toHaveBeenCalled();
  });

  it('with prune, deletes records that are no longer in the files', async () => {
    const { service, m } = setup();
    const counts = await service.seed(true);
    expect(m.cities.deleteMany).toHaveBeenCalledWith({
      _id: { $nin: expect.arrayContaining(['cairo', 'frankfurt']) },
    });
    expect(counts.removed).toBe(5);
  });

  it('writes nothing when a row is invalid', async () => {
    const data = loadReferenceData();
    data.airports[0].timeZone = 'Mars/Olympus';
    jest.spyOn(referenceData, 'loadReferenceData').mockReturnValue(data);
    const { service, m } = setup();
    await expect(service.seed()).rejects.toThrow(/not an IANA time zone/);
    expect(m.airports.bulkWrite).not.toHaveBeenCalled();
  });

  it('seeds when the server starts, unless turned off or under test', async () => {
    const { service, m } = setup();
    process.env.NODE_ENV = 'test';
    await service.onApplicationBootstrap();
    expect(m.countries.bulkWrite).not.toHaveBeenCalled();

    process.env.NODE_ENV = 'development';
    process.env.SEED_REFERENCE_ON_START = 'false';
    await service.onApplicationBootstrap();
    expect(m.countries.bulkWrite).not.toHaveBeenCalled();

    delete process.env.SEED_REFERENCE_ON_START;
    await service.onApplicationBootstrap();
    expect(m.countries.bulkWrite).toHaveBeenCalledTimes(1);
  });

  it('a database error at start-up is logged, not fatal', async () => {
    const { service, m } = setup();
    process.env.NODE_ENV = 'development';
    m.countries.bulkWrite.mockRejectedValueOnce(new Error('offline'));
    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
  });
});
