import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuthUser } from '../common/types/auth-user.type';
import { summarizeByCurrency } from '../itineraries/budget.summary';
import { ItinerariesService } from '../itineraries/itineraries.service';
import { dayDate, toDateOnly } from '../itineraries/itinerary.view';
import { City, CityDocument } from '../reference/schemas/reference.schemas';
import { PdfItinerary, renderItineraryPdf } from './itinerary.pdf';

// ITN-28 (Memo, bonus): the user's own itinerary as a PDF. Ownership is
// Moharm's: ItinerariesService.findOwned is what GET /itineraries/:id uses,
// so another user's itinerary answers 404 here too. Nothing in his module
// changes.
@Injectable()
export class ItineraryPdfService {
  constructor(
    private readonly itineraries: ItinerariesService,
    @InjectModel(City.name) private readonly cities: Model<CityDocument>,
  ) {}

  async render(
    user: AuthUser,
    id: string,
  ): Promise<{ title: string; pdf: Buffer }> {
    const view = await this.toPdfView(user, id);
    return { title: view.title, pdf: await renderItineraryPdf(view) };
  }

  async toPdfView(user: AuthUser, id: string): Promise<PdfItinerary> {
    const it = await this.itineraries.findOwned(user, id);
    const summary = summarizeByCurrency(it);

    const cityIds = [
      ...new Set([
        ...it.days.map((d) => d.cityId),
        ...(it.transportCosts ?? []).flatMap((t) => [t.fromCityId, t.toCityId]),
      ]),
    ];
    const found = await this.cities
      .find({ _id: { $in: cityIds } }, { name: 1 })
      .lean<{ _id: string; name: string }[]>();
    const city = new Map(found.map((c) => [c._id, c.name]));
    const cityName = (cityId: string) => city.get(cityId) ?? cityId;

    const days = it.days.length;
    return {
      title: it.title,
      countries: it.countries ?? [],
      startDate: toDateOnly(it.startDate),
      endDate: toDateOnly(dayDate(it.startDate, Math.max(days - 1, 0))),
      visibility: it.visibility,
      days: it.days.map((d, i) => ({
        number: i + 1,
        date: toDateOnly(dayDate(it.startDate, i)),
        city: cityName(d.cityId),
        notes: d.notes,
        activities: (d.activities ?? []).map((a) => ({
          name: a.name,
          description: a.description,
          time: a.time,
          cost: a.cost,
        })),
        budgets: (d.budgets ?? []).map((b) => ({
          category: b.category,
          amount: b.amount,
          currency: b.currency,
          note: b.note,
        })),
        total: summary.byDay[i]?.total ?? {},
      })),
      transport: (it.transportCosts ?? []).map((t) => ({
        mode: t.mode,
        from: cityName(t.fromCityId),
        to: cityName(t.toCityId),
        amount: t.amount,
        currency: t.currency,
      })),
      total: summary.total,
      byCategory: summary.byCategory,
    };
  }
}
