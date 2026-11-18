import { NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Types } from 'mongoose';
import { summarizeByCurrency } from './budget.summary';
import { BudgetsService } from './budgets.service';
import { DaysService } from './days.service';
import { CreateBudgetDto } from './dto/budget.dto';
import { ItinerariesService } from './itineraries.service';
import {
  ITN_ID,
  OWNER,
  STRANGER,
  day,
  itinerary,
} from './itinerary.fixtures-spec';
import { BudgetCategory } from './schemas/itinerary.schema';

// ITN-14: budget entries and the summary by category and by day.
describe('Budget (ITN-14)', () => {
  // Day 1 Cairo: food 400 EGP, hotel 50 USD, museum 300 EGP.
  // Day 2 Cairo: taxi 100 EGP.
  // Day 3 Luxor: food 250 EGP, plus a 900 EGP train from Cairo.
  function trip() {
    const days = [
      day('cairo', {
        budgets: [
          {
            _id: new Types.ObjectId(),
            category: 'food',
            amount: 400,
            currency: 'EGP',
          },
          {
            _id: new Types.ObjectId(),
            category: 'accommodation',
            amount: 50,
            currency: 'USD',
          },
        ],
        activities: [
          {
            _id: new Types.ObjectId(),
            name: 'Museum',
            cost: { amount: 300, currency: 'EGP' },
          },
        ],
      }),
      day('cairo', {
        budgets: [
          {
            _id: new Types.ObjectId(),
            category: 'in_city_transport',
            amount: 100,
            currency: 'EGP',
          },
        ],
        activities: [{ _id: new Types.ObjectId(), name: 'Walk', cost: null }],
      }),
      day('luxor', {
        budgets: [
          {
            _id: new Types.ObjectId(),
            category: 'food',
            amount: 250,
            currency: 'EGP',
          },
        ],
      }),
    ];
    return {
      ...itinerary(days),
      transportCosts: [
        {
          _id: new Types.ObjectId(),
          mode: 'train',
          fromCityId: 'cairo',
          toCityId: 'luxor',
          amount: 900,
          currency: 'EGP',
          dayId: days[2]._id,
        },
      ],
    };
  }

  it('equals the entries plus activity costs plus transport, by category and by day', () => {
    const s = summarizeByCurrency(trip());
    expect(s.total).toEqual({ EGP: 1950, USD: 50 });
    expect(s.byCategory).toEqual({
      food: { EGP: 650 },
      accommodation: { USD: 50 },
      in_city_transport: { EGP: 100 },
      activities: { EGP: 300 },
      intercity_transport: { EGP: 900 },
    });
    expect(s.byDay.map((d) => [d.number, d.cityId, d.total])).toEqual([
      [1, 'cairo', { EGP: 700, USD: 50 }],
      [2, 'cairo', { EGP: 100 }],
      [3, 'luxor', { EGP: 1150 }],
    ]);
    expect(s.byDay[2].byCategory.intercity_transport).toEqual({ EGP: 900 });
  });

  it('gives each city group its budget subtotal (ITN-09)', () => {
    const s = summarizeByCurrency(trip());
    expect(s.cityGroups).toEqual([
      {
        cityId: 'cairo',
        fromDay: 1,
        toDay: 2,
        dayCount: 2,
        budgetSubtotal: { EGP: 800, USD: 50 },
      },
      {
        cityId: 'luxor',
        fromDay: 3,
        toDay: 3,
        dayCount: 1,
        budgetSubtotal: { EGP: 1150 },
      },
    ]);
  });

  it('drops a deleted day from every total (ITN-07)', () => {
    const t = trip();
    t.days.splice(0, 1);
    const s = summarizeByCurrency(t);
    expect(s.total).toEqual({ EGP: 1250 });
    expect(s.byDay.map((d) => d.number)).toEqual([1, 2]);
  });

  it('rejects a negative amount (400)', async () => {
    const errors = await validate(
      plainToInstance(CreateBudgetDto, {
        category: BudgetCategory.FOOD,
        amount: -1,
        currency: 'EGP',
      }),
    );
    expect(errors.map((e) => e.property)).toEqual(['amount']);
  });

  describe('BudgetsService', () => {
    function setup() {
      const doc: any = trip();
      const rates = {
        getRates: jest.fn(async () => ({
          date: '2026-11-17',
          base: 'USD',
          rates: { USD: 1, EGP: 50 },
          stale: false,
        })),
        convert: (a: number, from: string, to: string, r: any) =>
          (a / r.rates[from]) * r.rates[to],
      };
      const users = {
        findById: jest.fn(() => ({
          lean: async () => ({ preferredCurrency: 'EGP' }),
        })),
      };
      const itineraries = {
        findById: jest.fn(() => ({ lean: async () => doc })),
        findOne: jest.fn(() => ({ lean: async () => doc })),
        findOneAndUpdate: jest.fn(() => ({ lean: async () => doc })),
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
      return {
        doc,
        itineraries,
        service: new BudgetsService(
          itineraries as any,
          itinerariesService,
          days,
          rates as any,
          users as any,
        ),
      };
    }

    it('adds an entry to a day', async () => {
      const { service, doc, itineraries } = setup();
      const dayId = String(doc.days[1]._id);
      const entry = await service.add(OWNER, ITN_ID, dayId, {
        category: BudgetCategory.FOOD,
        amount: 120,
        currency: 'EGP',
      });
      expect(entry).toMatchObject({ category: 'food', amount: 120, dayId });
      expect(itineraries.findOneAndUpdate).toHaveBeenCalledTimes(1);
    });

    it('converts the summary to my preferred currency with the rate date (ITN-18)', async () => {
      const { service } = setup();
      const s = await service.summary(OWNER, ITN_ID);
      // 1950 EGP + 50 USD x 50 = 4450 EGP.
      expect(s).toMatchObject({
        currency: 'EGP',
        rateDate: '2026-11-17',
        ratesAreOld: false,
        total: 4450,
      });
      expect(s.byCategory.accommodation).toBe(2500);
      expect(s.byDay.map((d) => d.total)).toEqual([3200, 100, 1150]);
      expect(s.cityGroups.map((g) => g.budgetSubtotal)).toEqual([3300, 1150]);
      expect(s.original.total).toEqual({ EGP: 1950, USD: 50 });
    });

    it("answers 404 for another user's entry or summary", async () => {
      const { service, doc } = setup();
      const entryId = String(doc.days[0].budgets[0]._id);
      await expect(service.remove(STRANGER, entryId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.summary(STRANGER, ITN_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
