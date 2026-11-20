import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  BUDGET_DELETED,
  BUDGET_NOT_FOUND,
  BudgetsService,
} from './budgets.service';
import { ITN_ID, OWNER, STRANGER, day } from './itinerary.fixtures-spec';
import { BudgetCategory } from './schemas/itinerary.schema';

// ITN-14 / ITN-18: the branches of BudgetsService the summary specs do not
// reach: missing days or entries, other owners, partial updates and the
// currency fallback.
describe('BudgetsService (ITN-14, ITN-18)', () => {
  function setup(opts: { profile?: object | null; updated?: any } = {}) {
    const entry = {
      _id: new Types.ObjectId(),
      category: BudgetCategory.FOOD,
      amount: 40,
      currency: 'EUR',
      note: 'lunch',
    };
    const d1 = day('cairo', { budgets: [] as any[] });
    const d2 = day('cairo', { budgets: [entry] });
    const doc: any = {
      _id: new Types.ObjectId(ITN_ID),
      ownerId: new Types.ObjectId(OWNER.id),
      days: [d1, d2],
      transportCosts: [],
    };
    const itineraries = {
      findOne: jest.fn(() => ({ lean: async () => doc })),
      findOneAndUpdate: jest.fn(() => ({
        lean: async () => ('updated' in opts ? opts.updated : doc),
      })),
      updateOne: jest.fn(async () => ({ modifiedCount: 1 })),
    };
    const itinerariesService = { findOwned: jest.fn(async () => doc) };
    const days = {
      assertHasDay: jest.fn((it: any, dayId: string) => {
        if (!it.days.some((x: any) => String(x._id) === dayId)) {
          throw new NotFoundException('Day not found');
        }
      }),
    };
    const rates = { date: '2026-11-20', stale: true, rates: { USD: 1 } };
    const exchangeRates = {
      getRates: jest.fn(async () => rates),
      convert: jest.fn((amount: number) => amount),
    };
    const users = {
      findById: jest.fn(() => ({
        lean: async () => ('profile' in opts ? opts.profile : null),
      })),
    };
    const service = new BudgetsService(
      itineraries as any,
      itinerariesService as any,
      days as any,
      exchangeRates as any,
      users as any,
    );
    return { service, itineraries, entry, d1, d2, doc, exchangeRates };
  }

  it('adds an entry with an empty note when none is given', async () => {
    const { service, itineraries, d1 } = setup();
    const r = await service.add(OWNER, ITN_ID, String(d1._id), {
      category: BudgetCategory.FOOD,
      amount: 12,
      currency: 'EGP',
    } as any);
    expect(r).toMatchObject({ note: '', amount: 12, dayId: String(d1._id) });
    const [filter, update] = (itineraries.findOneAndUpdate.mock
      .calls[0] as any[]) ?? [{}, {}];
    expect(filter).toMatchObject({
      ownerId: OWNER.id,
      'days._id': String(d1._id),
    });
    expect(update.$push['days.$.budgets'].note).toBe('');
  });

  it('answers 404 when the day does not exist', async () => {
    const { service } = setup();
    await expect(
      service.add(OWNER, ITN_ID, String(new Types.ObjectId()), {
        category: BudgetCategory.FOOD,
        amount: 1,
        currency: 'EGP',
      } as any),
    ).rejects.toThrow('Day not found');
  });

  it('answers 404 when the day disappears before the write', async () => {
    const { service, d1 } = setup({ updated: null });
    await expect(
      service.add(OWNER, ITN_ID, String(d1._id), {
        category: BudgetCategory.FOOD,
        amount: 1,
        currency: 'EGP',
      } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('updates only the fields that are sent', async () => {
    const { service, itineraries, entry } = setup();
    await service.update(OWNER, String(entry._id), { amount: 55 } as any);
    const update = (itineraries.findOneAndUpdate.mock.calls[0] as any[])[1];
    expect(Object.keys(update.$set)).toEqual(['days.$[d].budgets.$[b].amount']);
    expect(update.$set['days.$[d].budgets.$[b].amount']).toBe(55);
  });

  it('sends all four fields when all are given, including an empty note', async () => {
    const { service, itineraries, entry } = setup();
    await service.update(OWNER, String(entry._id), {
      category: BudgetCategory.ACCOMMODATION,
      amount: 3,
      currency: 'USD',
      note: '',
    } as any);
    const update = (itineraries.findOneAndUpdate.mock.calls[0] as any[])[1];
    expect(Object.keys(update.$set).sort()).toEqual(
      ['amount', 'category', 'currency', 'note'].map(
        (k) => `days.$[d].budgets.$[b].${k}`,
      ),
    );
  });

  it('returns the entry with its day after an update', async () => {
    const { service, entry, d2 } = setup();
    const r = await service.update(OWNER, String(entry._id), {
      note: 'dinner',
    } as any);
    expect(r).toMatchObject({ _id: entry._id, dayId: d2._id });
  });

  it('answers 404 when the entry vanished between read and write', async () => {
    const { service, entry } = setup({ updated: null });
    await expect(
      service.update(OWNER, String(entry._id), { amount: 1 } as any),
    ).rejects.toThrow(BUDGET_NOT_FOUND);
  });

  it("answers 404 (not 403) for another user's entry", async () => {
    const { service, entry, itineraries } = setup();
    await expect(
      service.update(STRANGER, String(entry._id), { amount: 1 } as any),
    ).rejects.toThrow(BUDGET_NOT_FOUND);
    await expect(service.remove(STRANGER, String(entry._id))).rejects.toThrow(
      BUDGET_NOT_FOUND,
    );
    expect(itineraries.updateOne).not.toHaveBeenCalled();
    expect(itineraries.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('answers 404 for an id that is in no itinerary', async () => {
    const { service, itineraries } = setup();
    itineraries.findOne.mockReturnValueOnce({ lean: async () => null } as any);
    await expect(
      service.remove(OWNER, String(new Types.ObjectId())),
    ).rejects.toThrow(BUDGET_NOT_FOUND);
  });

  it('answers 404 when the itinerary matched but the entry is not in any day', async () => {
    const { service } = setup();
    await expect(
      service.update(OWNER, String(new Types.ObjectId()), {
        amount: 1,
      } as any),
    ).rejects.toThrow(BUDGET_NOT_FOUND);
  });

  it('removes an entry with $pull scoped to the owner', async () => {
    const { service, itineraries, entry, doc } = setup();
    const r = await service.remove(OWNER, String(entry._id));
    expect(r).toEqual({ message: BUDGET_DELETED });
    const [filter, update] = itineraries.updateOne.mock.calls[0] as any[];
    expect(filter).toEqual({ _id: doc._id, ownerId: OWNER.id });
    expect(String(update.$pull['days.$[].budgets']._id)).toBe(
      String(entry._id),
    );
  });

  it('summarises in USD when the user has no profile or currency', async () => {
    const { service } = setup({ profile: null });
    const r = await service.summary(OWNER, ITN_ID);
    expect(r.currency).toBe('USD');
    expect(r.rateDate).toBe('2026-11-20');
    expect(r.ratesAreOld).toBe(true);
  });

  it("summarises in the user's preferred currency", async () => {
    const { service, exchangeRates } = setup({
      profile: { preferredCurrency: 'EGP' },
    });
    const r = await service.summary(OWNER, ITN_ID);
    expect(r.currency).toBe('EGP');
    expect(exchangeRates.convert).toHaveBeenCalledWith(
      40,
      'EUR',
      'EGP',
      expect.objectContaining({ date: '2026-11-20' }),
    );
  });
});
