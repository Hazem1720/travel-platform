// Shared test fixtures for the itinerary specs. The name ends in -spec.ts so
// the build skips it (tsconfig.build.json) but Jest does not run it as a suite.
import { Types } from 'mongoose';
import { Role } from '../common/enums/role.enum';
import { AuthUser } from '../common/types/auth-user.type';
import { DaysService } from './days.service';
import { ItinerariesService } from './itineraries.service';
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
        if (filter.updatedAt && filter.updatedAt !== d.updatedAt) return null;
        for (const key of Object.keys(filter)) {
          if (/^days\.\d+$/.test(key)) {
            const i = Number(key.split('.')[1]);
            if (filter[key].$exists === false && d.days[i]) return null;
          }
        }
        if (update.$push?.days) d.days = [...d.days, update.$push.days];
        if (update.$set) {
          for (const [k, v] of Object.entries(update.$set)) {
            if (k === 'days') {
              d.days = v;
            } else if (k.startsWith('days.$.')) {
              const target = d.days.find(
                (x: any) => String(x._id) === String(filter['days._id']),
              );
              if (!target) return null;
              target[k.slice(7)] = v;
            } else {
              d[k] = v;
            }
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
