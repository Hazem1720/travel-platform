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
      service: new HotelsService(hotels as any, cities as any, {} as any),
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

  // HTL-01 photos, with the shared GEN-08 upload utility.
  describe('photos (HTL-01, GEN-08)', () => {
    const url = (n: number) =>
      `/api/uploads/00000000-0000-0000-0000-00000000000${n}.png`;
    const file = {
      originalname: 'a.png',
      mimetype: 'image/png',
      size: 1,
      buffer: Buffer.from('x'),
    };

    function photos(opts: {
      images?: string[] | null;
      pushed?: unknown;
      pulled?: unknown;
      exists?: boolean;
    }) {
      const current =
        opts.images === null ? null : { images: opts.images ?? [] };
      const hotels = {
        findById: jest.fn(() => ({ lean: async () => current })),
        findOneAndUpdate: jest.fn<any, [object, object, object]>((filter) => ({
          lean: async () => ('$expr' in filter ? opts.pushed : opts.pulled),
        })),
        exists: jest.fn(async () => (opts.exists ? { _id: ID } : null)),
      };
      const uploads = {
        save: jest.fn(async (files: unknown[]) =>
          files.map((_, i) => url(i + 1)),
        ),
        remove: jest.fn(async () => undefined),
      };
      return {
        service: new HotelsService(hotels as any, {} as any, uploads as any),
        hotels,
        uploads,
      };
    }

    it('saves the files and pushes their URLs only while there is room', async () => {
      const { service, hotels, uploads } = photos({
        images: [url(9)],
        pushed: { _id: ID },
      });
      await expect(service.addImages(ID, [file, file])).resolves.toEqual({
        _id: ID,
      });
      expect(uploads.save).toHaveBeenCalledWith([file, file]);
      const [filter, update] = hotels.findOneAndUpdate.mock.calls[0];
      expect(filter).toMatchObject({ _id: ID });
      // 5 - 2 new photos: the hotel may have at most 3 before this push.
      expect(JSON.stringify(filter)).toContain(',3]');
      expect(update).toEqual({
        $push: { images: { $each: [url(1), url(2)] } },
      });
      expect(uploads.remove).not.toHaveBeenCalled();
    });

    it('rejects a sixth photo with 400 before saving anything', async () => {
      const { service, uploads } = photos({ images: [1, 2, 3, 4, 5].map(url) });
      await expect(service.addImages(ID, [file])).rejects.toThrow(
        'At most 5 images allowed (5 already uploaded)',
      );
      expect(uploads.save).not.toHaveBeenCalled();
    });

    it('deletes the saved files when a parallel upload filled the hotel first', async () => {
      const { service, hotels, uploads } = photos({
        images: [1, 2, 3, 4].map(url),
        pushed: null,
      });
      hotels.findById
        .mockReturnValueOnce({
          lean: async () => ({ images: [1, 2, 3, 4].map(url) }),
        })
        .mockReturnValueOnce({
          lean: async () => ({ images: [1, 2, 3, 4, 5].map(url) }),
        });
      await expect(service.addImages(ID, [file])).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(uploads.remove).toHaveBeenCalledWith(url(1));
    });

    it('answers 404 for photos of an unknown hotel', async () => {
      const { service, uploads } = photos({ images: null });
      await expect(service.addImages(ID, [file])).rejects.toThrow(
        'Hotel not found',
      );
      expect(uploads.save).not.toHaveBeenCalled();
    });

    it('removes one photo and deletes its file', async () => {
      const { service, hotels, uploads } = photos({
        pulled: { _id: ID, images: [] },
      });
      const name = url(1).split('/').pop()!;
      await service.removeImage(ID, name);
      expect(hotels.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: ID, images: url(1) },
        { $pull: { images: url(1) } },
        { new: true },
      );
      expect(uploads.remove).toHaveBeenCalledWith(url(1));
    });

    it('answers 404 for a photo the hotel does not have, or an unknown hotel', async () => {
      const missingPhoto = photos({ pulled: null, exists: true });
      await expect(
        missingPhoto.service.removeImage(ID, 'x.png'),
      ).rejects.toThrow('Image not found');
      expect(missingPhoto.uploads.remove).not.toHaveBeenCalled();
      const missingHotel = photos({ pulled: null, exists: false });
      await expect(
        missingHotel.service.removeImage(ID, 'x.png'),
      ).rejects.toThrow('Hotel not found');
    });
  });
});
