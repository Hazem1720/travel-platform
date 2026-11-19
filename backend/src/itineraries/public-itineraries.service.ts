import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import { AccountStatus } from '../common/enums/role.enum';
import { paginated } from '../common/pagination/pagination.helper';
import { AuthUser } from '../common/types/auth-user.type';
import {
  City,
  CityDocument,
  Country,
  CountryDocument,
} from '../reference/schemas/reference.schemas';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  BudgetSummary,
  CurrencyTotals,
  presentWithBudget,
  summarizeByCurrency,
} from './budget.summary';
import { PublicSearchQueryDto } from './dto/public-search.dto';
import { ITINERARY_NOT_FOUND } from './itineraries.service';
import {
  Itinerary,
  ItineraryDocument,
  ItineraryVisibility,
} from './schemas/itinerary.schema';

// ITN-21: what a guest sees of a public itinerary.
export type PublicItineraryView = Record<string, unknown> & {
  author: { id: unknown; name: string };
  days: { number: number; date: Date; cityId: string }[];
  budget: BudgetSummary<CurrencyTotals>;
};

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ITN-21: shared (public) itineraries. Only Public, not hidden (GEN-10), and
// not by a deactivated author (ACC-12). ITN-20: setting Private removes an
// itinerary from all of this at once.
@Injectable()
export class PublicItinerariesService {
  constructor(
    @InjectModel(Itinerary.name)
    private readonly itineraries: Model<ItineraryDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Country.name)
    private readonly countries: Model<CountryDocument>,
    @InjectModel(City.name) private readonly cities: Model<CityDocument>,
  ) {}

  async search(q: PublicSearchQueryDto) {
    if (
      q.minDays !== undefined &&
      q.maxDays !== undefined &&
      q.minDays > q.maxDays
    ) {
      throw new BadRequestException({
        error: 'Bad Request',
        message: 'Validation failed',
        details: { minDays: ['minDays must not be above maxDays'] },
      });
    }
    const match: Record<string, unknown> = await this.visibleFilter();
    const and: Record<string, unknown>[] = [];
    if (q.keyword) and.push(await this.keywordFilter(q.keyword));
    if (q.country) and.push({ countries: q.country });
    if (q.city) and.push({ 'days.cityId': q.city });
    if (and.length) match.$and = and;

    const duration: Record<string, number> = {};
    if (q.minDays !== undefined) duration.$gte = q.minDays;
    if (q.maxDays !== undefined) duration.$lte = q.maxDays;

    const pipeline: PipelineStage[] = [
      { $match: match },
      { $addFields: { dayCount: { $size: '$days' } } },
      ...(Object.keys(duration).length
        ? [{ $match: { dayCount: duration } }]
        : []),
      { $sort: { updatedAt: -1, _id: -1 } },
      {
        $facet: {
          data: [
            { $skip: (q.page - 1) * q.limit },
            { $limit: q.limit },
            {
              $project: {
                title: 1,
                countries: 1,
                startDate: 1,
                dayCount: 1,
                cityIds: '$days.cityId',
                ownerId: 1,
                updatedAt: 1,
              },
            },
          ],
          total: [{ $count: 'n' }],
        },
      },
    ];
    const [result] = await this.itineraries.aggregate(pipeline);
    const rows = (result?.data ?? []) as {
      ownerId: Types.ObjectId;
      cityIds: string[];
    }[];
    const names = await this.authorNames(rows.map((r) => r.ownerId));
    const data = rows.map(({ ownerId, cityIds, ...rest }) => ({
      ...rest,
      cities: [...new Set(cityIds)],
      author: { id: ownerId, name: names.get(String(ownerId)) ?? '' },
    }));
    return paginated(data, result?.total[0]?.n ?? 0, q.page, q.limit);
  }

  // ITN-21: the read-only view with author, days, activities and budget (in
  // the entries' own currencies).
  async view(id: string): Promise<PublicItineraryView> {
    // ITN-27: the owner's linked bookings stay private, out of the budget too.
    const itinerary = { ...(await this.findPublic(id)), linkedBookings: [] };
    const names = await this.authorNames([itinerary.ownerId]);
    return {
      ...presentWithBudget(itinerary),
      author: {
        id: itinerary.ownerId,
        name: names.get(String(itinerary.ownerId)) ?? '',
      },
      budget: summarizeByCurrency(itinerary),
    };
  }

  // ITN-21: clones a public itinerary into a new, independent, Private copy
  // for the user, with all days, activities, budgets and transport costs
  // (new ids everywhere) and clonedFrom crediting the original author.
  async clone(user: AuthUser, id: string) {
    const source = await this.findPublic(id);
    const names = await this.authorNames([source.ownerId]);
    const dayIds = new Map<string, Types.ObjectId>();
    const days = source.days.map((d) => {
      const _id = new Types.ObjectId();
      dayIds.set(String(d._id), _id);
      return {
        _id,
        cityId: d.cityId,
        notes: d.notes,
        activities: (d.activities ?? []).map((a) => ({
          _id: new Types.ObjectId(),
          name: a.name,
          description: a.description,
          time: a.time,
          cost: a.cost ? { ...a.cost } : null,
          images: [...(a.images ?? [])],
        })),
        budgets: (d.budgets ?? []).map((b) => ({
          _id: new Types.ObjectId(),
          category: b.category,
          amount: b.amount,
          currency: b.currency,
          note: b.note,
        })),
      };
    });
    const transportCosts = (source.transportCosts ?? [])
      .filter((t) => dayIds.has(String(t.dayId)))
      .map((t) => ({
        _id: new Types.ObjectId(),
        mode: t.mode,
        fromCityId: t.fromCityId,
        toCityId: t.toCityId,
        amount: t.amount,
        currency: t.currency,
        dayId: dayIds.get(String(t.dayId)),
      }));
    const created = await this.itineraries.create({
      ownerId: user.id,
      title: source.title,
      countries: [...source.countries],
      startDate: source.startDate,
      visibility: ItineraryVisibility.PRIVATE,
      hidden: false,
      days,
      transportCosts,
      clonedFrom: {
        itineraryId: source._id,
        authorId: source.ownerId,
        authorName: names.get(String(source.ownerId)) ?? '',
      },
    });
    return presentWithBudget(created.toObject());
  }

  // A public itinerary anyone may see, or 404 (private, hidden, deleted, or
  // by a deactivated author).
  async findPublic(id: string) {
    const itinerary = await this.itineraries
      .findOne({ _id: id, ...(await this.visibleFilter()) })
      .lean();
    if (!itinerary) throw new NotFoundException(ITINERARY_NOT_FOUND);
    return itinerary;
  }

  private async visibleFilter() {
    const deactivated = await this.users.distinct('_id', {
      status: AccountStatus.DEACTIVATED,
    });
    return {
      visibility: ItineraryVisibility.PUBLIC,
      hidden: { $ne: true },
      ...(deactivated.length ? { ownerId: { $nin: deactivated } } : {}),
    };
  }

  // The keyword matches the title, a country (by name or code) or a city (by
  // name or id) of the itinerary.
  private async keywordFilter(keyword: string) {
    const re = new RegExp(escapeRegex(keyword), 'i');
    const [countries, cities] = await Promise.all([
      this.countries
        .find({ $or: [{ name: re }, { _id: re }] }, { _id: 1 })
        .lean(),
      this.cities.find({ $or: [{ name: re }, { _id: re }] }, { _id: 1 }).lean(),
    ]);
    return {
      $or: [
        { title: re },
        { countries: { $in: countries.map((c) => c._id) } },
        { 'days.cityId': { $in: cities.map((c) => c._id) } },
      ],
    };
  }

  private async authorNames(ids: unknown[]) {
    const users = await this.users
      .find({ _id: { $in: ids } }, { name: 1 })
      .lean();
    return new Map(users.map((u) => [String(u._id), u.name]));
  }
}
