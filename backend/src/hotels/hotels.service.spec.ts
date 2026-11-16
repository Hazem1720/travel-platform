import { BadRequestException, NotFoundException } from '@nestjs/common';
import { HotelsService } from './hotels.service';

// HTL-01, HTL-02 (profile part), HTL-09, HTL-10.
describe('HotelsService', () => {
  const ID = '6735a1f4c1a2b3c4d5e6f801';
  const hotel = { _id: ID, name: 'TEST Nile View', cityId: 'cairo' };

  function setup(opts: { found?: unknown; city?: unknown } = {}) {
    const found = 'found' in opts ? opts.found : hotel;
    const city =
      'city' in opts ? opts.city : { _id: 'cairo', countryCode: 'EG' };
    const hotels = {
      create: jest.fn(async (doc: object) => ({
        toObject: () => ({ _id: ID, isActive: true, ...doc }),
      })),
      findById: jest.fn(() => ({ lean: async () => found })),
      findByIdAndUpdate: jest.fn<any, [string, object, object]>(() => ({
        lean: async () => found,
      })),
    };
    const cities = { findById: jest.fn(() => ({ lean: async () => city })) };
    return {
      service: new HotelsService(hotels as any, cities as any),
      hotels,
      cities,
    };
  }

  const dto = {
    name: 'TEST Nile View',
    address: '12 Corniche',
    cityId: 'cairo',
    countryCode: 'EG',
    starClass: 4,
  };

  describe('create (HTL-01)', () => {
    it('creates a hotel in cairo / EG', async () => {
      const { service, hotels } = setup();
      const created = await service.create(dto);
      expect(hotels.create).toHaveBeenCalledWith(dto);
      expect(created).toMatchObject({ _id: ID, isActive: true });
    });

    it('rejects cairo with the country DE (400)', async () => {
      const { service, hotels } = setup();
      await expect(
        service.create({ ...dto, countryCode: 'DE' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(hotels.create).not.toHaveBeenCalled();
    });

    it('rejects an unknown city (400)', async () => {
      const { service, hotels } = setup({ city: null });
      await expect(
        service.create({ ...dto, cityId: 'atlantis' }),
      ).rejects.toThrow('Unknown city');
      expect(hotels.create).not.toHaveBeenCalled();
    });
  });

  describe('getPublic (HTL-02)', () => {
    it('returns an active hotel', async () => {
      const { service } = setup({ found: { ...hotel, isActive: true } });
      await expect(service.getPublic(ID)).resolves.toMatchObject({ _id: ID });
    });

    it('answers 404 for an inactive or unknown hotel', async () => {
      await expect(
        setup({ found: { ...hotel, isActive: false } }).service.getPublic(ID),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        setup({ found: null }).service.getPublic(ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update (HTL-01)', () => {
    it('updates only the given fields, with schema validation', async () => {
      const { service, hotels, cities } = setup();
      await service.update(ID, { description: 'New text' });
      expect(hotels.findByIdAndUpdate).toHaveBeenCalledWith(
        ID,
        { $set: { description: 'New text' } },
        { new: true, runValidators: true },
      );
      expect(cities.findById).not.toHaveBeenCalled();
    });

    it("checks a new country against the hotel's current city", async () => {
      const { service, hotels } = setup({
        found: { ...hotel, countryCode: 'EG' },
      });
      await expect(
        service.update(ID, { countryCode: 'DE' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(hotels.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('answers 404 for an unknown hotel', async () => {
      const { service } = setup({ found: null });
      await expect(service.update(ID, { name: 'X' })).rejects.toThrow(
        'Hotel not found',
      );
    });
  });

  describe('setPolicies (HTL-09, HTL-10)', () => {
    const policies = {
      checkInTime: '14:00',
      checkOutTime: '12:00',
      cancellationTiers: [{ daysBefore: 7, refundPercent: 100 }],
    };

    it('replaces the times and the tiers', async () => {
      const { service, hotels } = setup();
      await service.setPolicies(ID, policies);
      expect(hotels.findByIdAndUpdate).toHaveBeenCalledWith(
        ID,
        { $set: policies },
        { new: true, runValidators: true },
      );
    });

    it('answers 404 for an unknown hotel', async () => {
      const { service } = setup({ found: null });
      await expect(service.setPolicies(ID, policies)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
