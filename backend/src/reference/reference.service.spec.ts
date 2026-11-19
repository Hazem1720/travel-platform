import { ReferenceService } from './reference.service';

function model(rows: unknown[]) {
  const chain = {
    sort: jest.fn<any, any[]>(() => chain),
    skip: jest.fn<any, any[]>(() => chain),
    limit: jest.fn<any, any[]>(() => chain),
    lean: jest.fn<any, any[]>(async () => rows),
  };
  return {
    find: jest.fn<any, any[]>(() => chain),
    countDocuments: jest.fn<any, any[]>(async () => rows.length),
    chain,
  };
}

describe('GEN-12: reference lists', () => {
  const countries = model([{ _id: 'EG', name: 'Egypt', currency: 'EGP' }]);
  const cities = model([{ _id: 'cairo', name: 'Cairo', countryCode: 'EG' }]);
  const attractions = model([{ _id: 'att-1', cityId: 'cairo' }]);
  const currencies = model([{ _id: 'EGP', countries: ['EG'] }]);
  const service = new ReferenceService(
    countries as any,
    cities as any,
    attractions as any,
    currencies as any,
  );
  const q = { page: 1, limit: 10 };

  it('lists countries by name, paginated', async () => {
    const res = await service.listCountries(q);
    expect(countries.chain.sort).toHaveBeenCalledWith({ name: 1 });
    expect(res).toEqual({
      data: [{ _id: 'EG', name: 'Egypt', currency: 'EGP' }],
      meta: { page: 1, limit: 10, total: 1, totalPages: 1 },
    });
  });

  it('filters cities by country and attractions by city', async () => {
    await service.listCities({ ...q, country: 'EG' });
    expect(cities.find).toHaveBeenLastCalledWith({ countryCode: 'EG' });
    await service.listCities(q);
    expect(cities.find).toHaveBeenLastCalledWith({});
    await service.listAttractions({ ...q, city: 'cairo' });
    expect(attractions.find).toHaveBeenLastCalledWith({ cityId: 'cairo' });
  });

  it('lists currencies by code', async () => {
    await service.listCurrencies(q);
    expect(currencies.chain.sort).toHaveBeenCalledWith({ _id: 1 });
  });
});
