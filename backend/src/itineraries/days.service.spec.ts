import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { Role } from '../common/enums/role.enum';
import { AuthUser } from '../common/types/auth-user.type';
import { DaysService } from './days.service';
import { ItinerariesService } from './itineraries.service';
import { presentItinerary } from './itinerary.view';
import { toUtcDate } from './itineraries.service';

export const OWNER: AuthUser = {
  id: '6735a1f4c1a2b3c4d5e6f001',
  role: Role.USER,
  assignedProviderId: null,
};
export const STRANGER: AuthUser = { ...OWNER, id: '6735a1f4c1a2b3c4d5e6f002' };
export const ITN_ID = '6735a1f4c1a2b3c4d5e6f901';

export function day(cityId: string, extra: object = {}) {
  return { _id: new Types.ObjectId(), cityId, notes: '', ...extra };
}

// A fake Itinerary model that keeps one document in memory and applies the
// updates the services send, so tests can check the result.
export function memoryItineraries(doc: any) {
  const state = { doc };
  const model = {
    findById: jest.fn(() => ({ lean: async () => state.doc })),
    findOneAndUpdate: jest.fn((filter: any, update: any) => ({
      lean: async () => {
        const d = state.doc;
        if (!d || String(filter.ownerId) !== String(d.ownerId)) return null;
        for (const key of Object.keys(filter)) {
          if (/^days\.\d+$/.test(key)) {
            const i = Number(key.split('.')[1]);
            if (filter[key].$exists === false && d.days[i]) return null;
          }
        }
        if (update.$push?.days) d.days = [...d.days, update.$push.days];
        if (update.$set) {
          for (const [k, v] of Object.entries(update.$set)) {
            if (k.startsWith('days.$.')) {
              const target = d.days.find(
                (x: any) => String(x._id) === String(filter['days._id']),
              );
              if (!target) return null;
              target[k.slice(7)] = v;
            } else d[k] = v;
          }
        }
        if (update.$pull?.days) {
          d.days = d.days.filter(
            (x: any) => String(x._id) !== String(update.$pull.days._id),
          );
        }
        return { ...d, days: [...d.days] };
      },
    })),
  };
  return { model, state };
}

export function makeDaysService(doc: any, knownCities = ['cairo', 'luxor']) {
  const { model, state } = memoryItineraries(doc);
  const cities = {
    exists: jest.fn(async (q: { _id: string }) =>
      knownCities.includes(q._id) ? { _id: q._id } : null,
    ),
  };
  const itinerariesService = new ItinerariesService(model as any, {} as any);
  const service = new DaysService(
    model as any,
    cities as any,
    itinerariesService,
  );
  return { service, model, state };
}

export function itinerary(days: any[] = [], startDate = '2026-12-01') {
  return {
    _id: ITN_ID,
    ownerId: OWNER.id,
    title: 'TEST trip',
    countries: ['EG'],
    startDate: toUtcDate(startDate),
    days,
  };
}

describe('DaysService (ITN-05)', () => {
  it('numbers 3 added days 1 to 3 with consecutive dates', async () => {
    const { service } = makeDaysService(itinerary());
    await service.addDay(OWNER, ITN_ID, { cityId: 'cairo' });
    await service.addDay(OWNER, ITN_ID, { cityId: 'cairo', notes: 'Museum' });
    const result = await service.addDay(OWNER, ITN_ID, { cityId: 'luxor' });
    expect(
      result.days.map((d) => [d.number, d.date.toISOString(), d.cityId]),
    ).toEqual([
      [1, '2026-12-01T00:00:00.000Z', 'cairo'],
      [2, '2026-12-02T00:00:00.000Z', 'cairo'],
      [3, '2026-12-03T00:00:00.000Z', 'luxor'],
    ]);
  });

  it('shifts every date when the start date changes', () => {
    const days = [day('cairo'), day('luxor')];
    const moved = presentItinerary(itinerary(days, '2027-01-30'));
    expect(moved.days.map((d) => d.date.toISOString())).toEqual([
      '2027-01-30T00:00:00.000Z',
      '2027-01-31T00:00:00.000Z',
    ]);
  });

  it('refuses a 61st day (400)', async () => {
    const days = Array.from({ length: 60 }, () => day('cairo'));
    const { service, model } = makeDaysService(itinerary(days));
    await expect(
      service.addDay(OWNER, ITN_ID, { cityId: 'cairo' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('refuses the 60th-day race in the update filter itself', async () => {
    const days = Array.from({ length: 59 }, () => day('cairo'));
    const { service, model } = makeDaysService(itinerary(days));
    await service.addDay(OWNER, ITN_ID, { cityId: 'cairo' });
    expect(model.findOneAndUpdate.mock.calls[0][0]).toMatchObject({
      'days.59': { $exists: false },
    });
  });

  it('refuses an unknown city (400)', async () => {
    const { service } = makeDaysService(itinerary());
    await expect(
      service.addDay(OWNER, ITN_ID, { cityId: 'atlantis' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("edits a day's city and notes", async () => {
    const d = day('cairo');
    const { service } = makeDaysService(itinerary([d]));
    const result = await service.updateDay(OWNER, ITN_ID, String(d._id), {
      cityId: 'luxor',
      notes: 'Valley of the Kings',
    });
    expect(result.days[0]).toMatchObject({
      cityId: 'luxor',
      notes: 'Valley of the Kings',
      number: 1,
    });
  });

  it('answers 404 for an unknown day or another user', async () => {
    const d = day('cairo');
    const { service } = makeDaysService(itinerary([d]));
    await expect(
      service.updateDay(OWNER, ITN_ID, String(new Types.ObjectId()), {
        notes: 'x',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.addDay(STRANGER, ITN_ID, { cityId: 'cairo' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
