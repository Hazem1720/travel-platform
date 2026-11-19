import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto';
import { paginated } from '../common/pagination/pagination.helper';
import { AttractionQueryDto, CityQueryDto } from './dto/reference-query.dto';
import {
  Attraction,
  AttractionDocument,
  City,
  CityDocument,
  Country,
  CountryDocument,
  Currency,
  CurrencyDocument,
} from './schemas/reference.schemas';

// GEN-12: read-only lists of the seeded reference data, for forms and
// filters (itinerary countries and cities, budget currencies, attractions).
@Injectable()
export class ReferenceService {
  constructor(
    @InjectModel(Country.name)
    private readonly countries: Model<CountryDocument>,
    @InjectModel(City.name) private readonly cities: Model<CityDocument>,
    @InjectModel(Attraction.name)
    private readonly attractions: Model<AttractionDocument>,
    @InjectModel(Currency.name)
    private readonly currencies: Model<CurrencyDocument>,
  ) {}

  listCountries(q: PaginationQueryDto) {
    return this.page(this.countries, {}, { name: 1 }, q);
  }

  listCities(q: CityQueryDto) {
    return this.page(
      this.cities,
      q.country ? { countryCode: q.country } : {},
      { name: 1 },
      q,
    );
  }

  listAttractions(q: AttractionQueryDto) {
    return this.page(
      this.attractions,
      q.city ? { cityId: q.city } : {},
      { name: 1 },
      q,
    );
  }

  listCurrencies(q: PaginationQueryDto) {
    return this.page(this.currencies, {}, { _id: 1 }, q);
  }

  private async page(
    model: Model<any>,
    filter: Record<string, unknown>,
    sort: Record<string, 1 | -1>,
    q: PaginationQueryDto,
  ) {
    const [data, total] = await Promise.all([
      model
        .find(filter)
        .sort(sort)
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      model.countDocuments(filter),
    ]);
    return paginated(data as unknown[], total, q.page, q.limit);
  }
}
