import { NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Types } from 'mongoose';
import { ActivitiesService } from './activities.service';
import { DaysService } from './days.service';
import { CreateActivityDto } from './dto/activity.dto';
import { ItinerariesService } from './itineraries.service';
import {
  ITN_ID,
  OWNER,
  STRANGER,
  day,
  itinerary,
} from './itinerary.fixtures-spec';

// ITN-10: add, edit and delete activities; other users get 404.
describe('Activities (ITN-10)', () => {
  function setup() {
    const activity = {
      _id: new Types.ObjectId(),
      name: 'Museum',
      description: '',
      time: null,
      cost: null,
      images: [],
    };
    const d: any = day('cairo', { activities: [activity] });
    const doc = itinerary([d]);
    const itineraries = {
      findById: jest.fn(() => ({ lean: async () => doc })),
      findOne: jest.fn(() => ({ lean: async () => doc })),
      findOneAndUpdate: jest.fn<any, [any, any, any]>((_f, update) => ({
        lean: async () => {
          const pushed = update.$push?.['days.$.activities'];
          if (pushed) d.activities.push(pushed);
          for (const [k, v] of Object.entries(update.$set ?? {})) {
            (activity as any)[k.split('.').pop() as string] = v;
          }
          return doc;
        },
      })),
      updateOne: jest.fn(async () => ({ modifiedCount: 1 })),
    };
    const itinerariesService = new ItinerariesService(
      itineraries as any,
      {} as any,
    );
    const days = new DaysService(
      itineraries as any,
      {} as any,
      itinerariesService,
    );
    const service = new ActivitiesService(
      itineraries as any,
      itinerariesService,
      days,
    );
    return { service, itineraries, activity, d };
  }

  it('adds an activity with an optional time and cost', async () => {
    const { service, d } = setup();
    const created = await service.add(OWNER, ITN_ID, String(d._id), {
      name: 'Felucca ride',
      time: '17:00',
      cost: { amount: 300, currency: 'EGP' },
    });
    expect(created).toMatchObject({
      name: 'Felucca ride',
      time: '17:00',
      cost: { amount: 300, currency: 'EGP' },
      dayId: d._id,
      itineraryId: ITN_ID,
    });
  });

  it('edits an activity through array filters', async () => {
    const { service, itineraries, activity } = setup();
    const updated = await service.update(OWNER, String(activity._id), {
      name: 'Egyptian Museum',
      cost: null,
    });
    const [, update, options] = itineraries.findOneAndUpdate.mock.calls[0];
    expect(update.$set).toEqual({
      'days.$[d].activities.$[a].name': 'Egyptian Museum',
      'days.$[d].activities.$[a].cost': null,
    });
    expect(options.arrayFilters).toHaveLength(2);
    expect(updated.name).toBe('Egyptian Museum');
  });

  it('deletes an activity', async () => {
    const { service, itineraries, activity } = setup();
    await expect(service.remove(OWNER, String(activity._id))).resolves.toEqual({
      message: 'Activity deleted',
    });
    expect(itineraries.updateOne).toHaveBeenCalledTimes(1);
  });

  it("answers 404 for another user's activity", async () => {
    const { service, itineraries, activity } = setup();
    await expect(
      service.update(STRANGER, String(activity._id), { name: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.remove(STRANGER, String(activity._id)),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(itineraries.updateOne).not.toHaveBeenCalled();
  });

  describe('validation', () => {
    const errorsFor = async (body: object) =>
      (await validate(plainToInstance(CreateActivityDto, body))).map(
        (e) => e.property,
      );

    it('rejects a negative cost (400)', async () => {
      expect(
        await errorsFor({ name: 'x', cost: { amount: -1, currency: 'EGP' } }),
      ).toEqual(['cost']);
    });

    it('rejects the currency ABC (400)', async () => {
      expect(
        await errorsFor({ name: 'x', cost: { amount: 1, currency: 'ABC' } }),
      ).toEqual(['cost']);
    });

    it('rejects a time that is not HH:mm (400)', async () => {
      expect(await errorsFor({ name: 'x', time: '25:00' })).toEqual(['time']);
    });

    it('requires a name (400)', async () => {
      expect(await errorsFor({ description: 'no name' })).toEqual(['name']);
    });
  });
});
