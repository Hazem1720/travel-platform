import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Role } from '../common/enums/role.enum';
import { AuthUser } from '../common/types/auth-user.type';
import { ItinerariesService, toUtcDate } from './itineraries.service';
import { ItineraryVisibility } from './schemas/itinerary.schema';

// ITN-01: create, edit and delete; ACC-11 ownership (404 for other users).
describe('ItinerariesService (ITN-01)', () => {
  const ID = '6735a1f4c1a2b3c4d5e6f901';
  const owner: AuthUser = {
    id: '6735a1f4c1a2b3c4d5e6f001',
    role: Role.USER,
    assignedProviderId: null,
  };
  const stranger: AuthUser = { ...owner, id: '6735a1f4c1a2b3c4d5e6f002' };
  const itinerary = {
    _id: ID,
    ownerId: owner.id,
    title: 'TEST Egypt',
    countries: ['EG'],
    startDate: toUtcDate('2026-12-01'),
    visibility: ItineraryVisibility.PRIVATE,
  };
  const SEEDED = ['EG', 'AE', 'US'];

  function setup(opts: { found?: unknown; deletedCount?: number } = {}) {
    const found = 'found' in opts ? opts.found : itinerary;
    const itineraries = {
      create: jest.fn(async (doc: object) => ({
        toObject: () => ({
          _id: ID,
          visibility: ItineraryVisibility.PRIVATE,
          hidden: false,
          days: [],
          clonedFrom: null,
          ...doc,
        }),
      })),
      findById: jest.fn(() => ({ lean: async () => found })),
      findOneAndUpdate: jest.fn<any, [object, any, object]>(
        (_filter, update) => ({
          lean: async () => ({ ...itinerary, ...update.$set }),
        }),
      ),
      deleteOne: jest.fn(async () => ({
        deletedCount: opts.deletedCount ?? 1,
      })),
    };
    const countries = {
      find: jest.fn((filter: { _id: { $in: string[] } }) => ({
        lean: async () =>
          filter._id.$in
            .filter((c) => SEEDED.includes(c))
            .map((_id) => ({ _id })),
      })),
    };
    return {
      service: new ItinerariesService(itineraries as any, countries as any),
      itineraries,
      countries,
    };
  }

  const dto = {
    title: 'TEST Egypt',
    countries: ['EG'],
    startDate: '2026-12-01',
  };

  describe('create', () => {
    it('creates a Private itinerary owned by the user, with no days', async () => {
      const { service, itineraries } = setup();
      const created = await service.create(owner, dto);
      expect(itineraries.create).toHaveBeenCalledWith({
        ownerId: owner.id,
        title: 'TEST Egypt',
        countries: ['EG'],
        startDate: new Date('2026-12-01T00:00:00.000Z'),
      });
      expect(created).toMatchObject({
        visibility: ItineraryVisibility.PRIVATE,
        days: [],
      });
    });

    it('rejects an unknown country such as XX (400)', async () => {
      const { service, itineraries } = setup();
      await expect(
        service.create(owner, { ...dto, countries: ['EG', 'XX'] }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(itineraries.create).not.toHaveBeenCalled();
    });

    it('removes duplicate countries', async () => {
      const { service, itineraries } = setup();
      await service.create(owner, { ...dto, countries: ['EG', 'AE', 'EG'] });
      expect(itineraries.create).toHaveBeenCalledWith(
        expect.objectContaining({ countries: ['EG', 'AE'] }),
      );
    });
  });

  describe('update', () => {
    it('lets the owner change the title, countries and start date', async () => {
      const { service, itineraries } = setup();
      const updated = await service.update(owner, ID, {
        title: 'TEST Gulf',
        countries: ['AE'],
        startDate: '2027-01-05',
      });
      expect(itineraries.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: ID, ownerId: owner.id },
        {
          $set: {
            title: 'TEST Gulf',
            countries: ['AE'],
            startDate: new Date('2027-01-05T00:00:00.000Z'),
          },
        },
        { new: true, runValidators: true },
      );
      expect(updated).toMatchObject({ title: 'TEST Gulf', countries: ['AE'] });
    });

    it("answers 404 to another user's edit", async () => {
      const { service, itineraries } = setup();
      await expect(
        service.update(stranger, ID, { title: 'Mine now' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(itineraries.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('answers 404 for an itinerary that does not exist', async () => {
      const { service } = setup({ found: null });
      await expect(
        service.update(owner, ID, { title: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects an unknown country (400)', async () => {
      const { service, itineraries } = setup();
      await expect(
        service.update(owner, ID, { countries: ['XX'] }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(itineraries.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it("deletes only the owner's document, never clones", async () => {
      const { service, itineraries } = setup();
      await expect(service.remove(owner, ID)).resolves.toEqual({
        message: 'Itinerary deleted',
      });
      // One document by its own id: clones are separate documents with their
      // own ids (they only point back through clonedFrom), so they survive.
      expect(itineraries.deleteOne).toHaveBeenCalledTimes(1);
      expect(itineraries.deleteOne).toHaveBeenCalledWith({
        _id: ID,
        ownerId: owner.id,
      });
    });

    it("answers 404 to another user's delete", async () => {
      const { service, itineraries } = setup();
      await expect(service.remove(stranger, ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(itineraries.deleteOne).not.toHaveBeenCalled();
    });
  });
});
