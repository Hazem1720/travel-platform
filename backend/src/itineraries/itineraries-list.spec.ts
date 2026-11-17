import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { Role } from '../common/enums/role.enum';
import { AuthUser } from '../common/types/auth-user.type';
import { ItinerariesService } from './itineraries.service';

// ITN-03: my itineraries, most recently updated first; open one by id.
describe('ItinerariesService list and details (ITN-03)', () => {
  const owner: AuthUser = {
    id: '6735a1f4c1a2b3c4d5e6f001',
    role: Role.USER,
    assignedProviderId: null,
  };
  const stranger: AuthUser = { ...owner, id: '6735a1f4c1a2b3c4d5e6f002' };
  const ID = '6735a1f4c1a2b3c4d5e6f901';

  function setup(found: unknown = { _id: ID, ownerId: owner.id }) {
    const itineraries = {
      aggregate: jest.fn<Promise<unknown[]>, [any[]]>(async () => [
        { _id: ID },
      ]),
      countDocuments: jest.fn(async () => 11),
      findById: jest.fn(() => ({ lean: async () => found })),
    };
    return {
      service: new ItinerariesService(itineraries as any, {} as any),
      itineraries,
    };
  }

  it('lists only my itineraries, newest update first, 10 per page', async () => {
    const { service, itineraries } = setup();
    const result = await service.listMine(owner, { page: 2, limit: 10 });
    const pipeline = itineraries.aggregate.mock.calls[0][0];
    expect(pipeline[0]).toEqual({
      $match: { ownerId: new Types.ObjectId(owner.id) },
    });
    expect(pipeline[1]).toEqual({ $sort: { updatedAt: -1, _id: -1 } });
    expect(pipeline[2]).toEqual({ $skip: 10 });
    expect(pipeline[3]).toEqual({ $limit: 10 });
    expect(pipeline[4].$project).toMatchObject({
      title: 1,
      countries: 1,
      startDate: 1,
      dayCount: { $size: '$days' },
      visibility: 1,
    });
    expect(result.meta).toEqual({
      page: 2,
      limit: 10,
      total: 11,
      totalPages: 2,
    });
  });

  it('refuses an unknown sort field (400)', async () => {
    const { service } = setup();
    await expect(
      service.listMine(owner, { page: 1, limit: 10, sort: 'price:asc' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('opens my itinerary', async () => {
    const { service } = setup();
    await expect(service.getMine(owner, ID)).resolves.toMatchObject({
      _id: ID,
    });
  });

  it("answers 404 for another user's private itinerary", async () => {
    const { service } = setup();
    await expect(service.getMine(stranger, ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
