import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { Role } from '../common/enums/role.enum';
import { pdfFileName } from './itinerary-pdf.controller';
import { ItineraryPdfService } from './itinerary-pdf.service';
import { renderItineraryPdf, totals } from './itinerary.pdf';

// ITN-28: the itinerary PDF lists days, cities, activities and the budget;
// another user's itinerary is 404 (Moharm's findOwned).
describe('ItineraryPdfService (ITN-28)', () => {
  const user = { id: 'u1', role: Role.USER, assignedProviderId: null };

  const itinerary = {
    _id: new Types.ObjectId(),
    title: 'TEST Egypt in three days',
    countries: ['EG'],
    startDate: new Date('2026-12-10T00:00:00Z'),
    visibility: 'Private',
    days: [
      {
        _id: new Types.ObjectId(),
        cityId: 'cairo',
        notes: 'Arrive early',
        activities: [
          {
            name: 'Pyramids of Giza',
            description: 'Morning visit',
            time: '09:00',
            cost: { amount: 25, currency: 'USD' },
          },
        ],
        budgets: [
          { category: 'food', amount: 400, currency: 'EGP', note: 'Koshary' },
        ],
      },
      {
        _id: new Types.ObjectId(),
        cityId: 'cairo',
        activities: [],
        budgets: [],
      },
      {
        _id: new Types.ObjectId(),
        cityId: 'luxor',
        activities: [{ name: 'Karnak Temple', time: null, cost: null }],
        budgets: [
          { category: 'accommodation', amount: 1500.5, currency: 'EGP' },
        ],
      },
    ],
    transportCosts: [] as any[],
  };
  itinerary.transportCosts.push({
    mode: 'train',
    fromCityId: 'cairo',
    toCityId: 'luxor',
    amount: 600,
    currency: 'EGP',
    dayId: itinerary.days[2]._id,
  });

  function setup(found: unknown = itinerary) {
    const itineraries = {
      findOwned: jest.fn(async () => {
        if (!found) throw new NotFoundException('Itinerary not found');
        return found;
      }),
    };
    const cities = {
      find: jest.fn(() => ({
        lean: async () => [
          { _id: 'cairo', name: 'Cairo' },
          { _id: 'luxor', name: 'Luxor' },
        ],
      })),
    };
    const service = new ItineraryPdfService(itineraries as any, cities as any);
    return { service, itineraries };
  }

  // The text pdfkit wrote (uncompressed), as in the e-ticket test.
  const pdfText = (pdf: Buffer) =>
    (pdf.toString('latin1').match(/<([0-9a-f]+)>/g) ?? [])
      .map((h) => Buffer.from(h.slice(1, -1), 'hex').toString('latin1'))
      .join('');

  it('lists every day with its date and city, the activities, the entries and the budget', async () => {
    const { service, itineraries } = setup();
    const view = await service.toPdfView(user, String(itinerary._id));
    expect(itineraries.findOwned).toHaveBeenCalledWith(
      user,
      String(itinerary._id),
    );
    expect(view).toMatchObject({
      startDate: '2026-12-10',
      endDate: '2026-12-12',
      total: { USD: 25, EGP: 2500.5 },
    });
    expect(view.days.map((d) => `${d.date} ${d.city}`)).toEqual([
      '2026-12-10 Cairo',
      '2026-12-11 Cairo',
      '2026-12-12 Luxor',
    ]);

    const text = pdfText(await renderItineraryPdf(view, { compress: false }));
    for (const s of [
      'TEST Egypt in three days',
      'Day 1',
      '2026-12-10',
      'Cairo',
      'Day 3',
      'Luxor',
      'Pyramids of Giza',
      '09:00',
      '25.00 USD',
      'Karnak Temple',
      'Koshary',
      '400.00 EGP',
      '1500.50 EGP',
      'train: Cairo to Luxor, 600.00 EGP',
      'Total: 2500.50 EGP + 25.00 USD',
    ]) {
      expect(text).toContain(s);
    }
  });

  it("another user's (or a missing) itinerary is 404, as GET /itineraries/:id", async () => {
    await expect(setup(null).service.render(user, 'x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('renders an empty itinerary too', async () => {
    const empty = { ...itinerary, days: [], transportCosts: [] };
    const { service } = setup(empty);
    const { pdf } = await service.render(user, String(itinerary._id));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('totals per currency, and a safe file name', () => {
    expect(totals({ USD: 30, EGP: 1200 })).toBe('1200.00 EGP + 30.00 USD');
    expect(totals({})).toBe('-');
    expect(pdfFileName('A week in Tokyo!')).toBe(
      'itinerary-a-week-in-tokyo.pdf',
    );
    expect(pdfFileName('"; rm -rf /')).toBe('itinerary-rm-rf.pdf');
    expect(pdfFileName('!!!')).toBe('itinerary-export.pdf');
  });
});
