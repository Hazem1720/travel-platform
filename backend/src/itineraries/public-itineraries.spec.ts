import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { AccountStatus } from '../common/enums/role.enum';
import { OWNER, STRANGER, day, itinerary } from './itinerary.fixtures-spec';
import { PublicItinerariesService } from './public-itineraries.service';
import { ItineraryVisibility } from './schemas/itinerary.schema';

// ITN-21: public search, read-only view and clone.
describe('PublicItinerariesService (ITN-21)', () => {
  const DEACTIVATED_ID = new Types.ObjectId();

  function setup(found: any = null) {
    const created: any[] = [];
    const itineraries = {
      aggregate: jest.fn<Promise<any[]>, [any[]]>(async () => [
        {
          data: [
            {
              _id: 'x',
              title: 'TEST Nile',
              ownerId: new Types.ObjectId(OWNER.id),
              cityIds: ['luxor', 'luxor', 'aswan'],
            },
          ],
          total: [{ n: 1 }],
        },
      ]),
      findOne: jest.fn<any, [any]>(() => ({ lean: async () => found })),
      create: jest.fn(async (doc: any) => {
        created.push(doc);
        return { toObject: () => ({ _id: new Types.ObjectId(), ...doc }) };
      }),
    };
    const users = {
      distinct: jest.fn(async () => [DEACTIVATED_ID]),
      find: jest.fn(() => ({
        lean: async () => [{ _id: new Types.ObjectId(OWNER.id), name: 'Ziad' }],
      })),
    };
    const countries = {
      find: jest.fn(() => ({ lean: async () => [] })),
    };
    const cities = {
      find: jest.fn(() => ({ lean: async () => [{ _id: 'luxor' }] })),
    };
    const service = new PublicItinerariesService(
      itineraries as any,
      users as any,
      countries as any,
      cities as any,
    );
    return { service, itineraries, users, cities, created };
  }

  it('finds itineraries by a city name, only Public, visible and active authors', async () => {
    const { service, itineraries, users, cities } = setup();
    const result = await service.search({
      page: 1,
      limit: 10,
      keyword: 'Luxor',
    });
    const match = itineraries.aggregate.mock.calls[0][0][0].$match;
    expect(match).toMatchObject({
      visibility: ItineraryVisibility.PUBLIC,
      hidden: { $ne: true },
      // Stored as the id string: both forms are excluded (ACC-12).
      ownerId: {
        $nin: [
          String(DEACTIVATED_ID),
          new Types.ObjectId(String(DEACTIVATED_ID)),
        ],
      },
    });
    expect(match.$and[0].$or).toContainEqual({
      'days.cityId': { $in: ['luxor'] },
    });
    expect(users.distinct).toHaveBeenCalledWith('_id', {
      status: AccountStatus.DEACTIVATED,
    });
    expect(cities.find).toHaveBeenCalled();
    expect(result.data[0]).toMatchObject({
      title: 'TEST Nile',
      cities: ['luxor', 'aswan'],
      author: { name: 'Ziad' },
    });
    expect(result.meta.total).toBe(1);
  });

  it('filters by duration, country and city', async () => {
    const { service, itineraries } = setup();
    await service.search({
      page: 1,
      limit: 10,
      minDays: 2,
      maxDays: 5,
      country: 'EG',
      city: 'luxor',
    });
    const pipeline = itineraries.aggregate.mock.calls[0][0];
    expect(pipeline[0].$match.$and).toEqual([
      { countries: 'EG' },
      { 'days.cityId': 'luxor' },
    ]);
    expect(pipeline[2]).toEqual({ $match: { dayCount: { $gte: 2, $lte: 5 } } });
  });

  it('refuses minDays above maxDays (400)', async () => {
    const { service } = setup();
    await expect(
      service.search({ page: 1, limit: 10, minDays: 6, maxDays: 3 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('shows a public itinerary with its author and budget', async () => {
    const source = { ...itinerary([day('cairo')]), visibility: 'Public' };
    const { service } = setup(source);
    const view = await service.view(String(source._id));
    expect(view.author.name).toBe('Ziad');
    expect(view.days[0]).toMatchObject({ number: 1, cityId: 'cairo' });
    expect(view.budget.total).toEqual({});
  });

  it('answers 404 for a private, hidden or missing itinerary', async () => {
    const { service, itineraries } = setup(null);
    await expect(
      service.view('6735a1f4c1a2b3c4d5e6f901'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.clone(STRANGER, '6735a1f4c1a2b3c4d5e6f901'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(itineraries.findOne.mock.calls[0][0]).toMatchObject({
      visibility: ItineraryVisibility.PUBLIC,
    });
  });

  it('clones into a new Private copy with new ids that credits the author', async () => {
    const d = day('luxor', {
      activities: [
        {
          _id: new Types.ObjectId(),
          name: 'Karnak',
          description: '',
          time: null,
          cost: { amount: 600, currency: 'EGP' },
          images: ['/api/uploads/a.png'],
        },
      ],
      budgets: [
        {
          _id: new Types.ObjectId(),
          category: 'food',
          amount: 200,
          currency: 'EGP',
          note: '',
        },
      ],
    });
    const source: any = {
      ...itinerary([d]),
      visibility: 'Public',
      transportCosts: [
        {
          _id: new Types.ObjectId(),
          mode: 'train',
          fromCityId: 'cairo',
          toCityId: 'luxor',
          amount: 900,
          currency: 'EGP',
          dayId: d._id,
        },
      ],
    };
    const { service, created } = setup(source);
    const copy = await service.clone(STRANGER, String(source._id));
    const doc = created[0];
    expect(doc).toMatchObject({
      ownerId: STRANGER.id,
      visibility: ItineraryVisibility.PRIVATE,
      clonedFrom: {
        itineraryId: source._id,
        authorId: OWNER.id,
        authorName: 'Ziad',
      },
    });
    // Deep copy with new ids: editing it cannot touch the original.
    expect(String(doc.days[0]._id)).not.toBe(String(d._id));
    expect(String(doc.days[0].activities[0]._id)).not.toBe(
      String(d.activities[0]._id),
    );
    expect(doc.days[0].activities[0]).not.toBe(d.activities[0]);
    expect(doc.days[0].budgets[0]).toMatchObject({ amount: 200 });
    expect(String(doc.transportCosts[0].dayId)).toBe(String(doc.days[0]._id));
    doc.days[0].activities[0].name = 'Changed';
    expect(d.activities[0].name).toBe('Karnak');
    expect(copy.days[0].number).toBe(1);
  });
});
