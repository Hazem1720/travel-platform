import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import {
  buildSort,
  paginated,
  PaginatedResult,
} from '../common/pagination/pagination.helper';
import {
  Airport,
  AirportDocument,
  City,
  CityDocument,
  Country,
  CountryDocument,
} from '../reference/schemas/reference.schemas';
import { AirportQueryDto } from './dto/airport-query.dto';

export interface AirportView {
  code: string;
  name: string;
  cityId: string;
  city: string;
  countryCode: string;
  country: string;
  timeZone: string;
}

const escapeRegex = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// FLT-02: the predefined, read-only airport list loaded by the reference seed
// (GEN-12). Nothing here writes to the airports collection.
@Injectable()
export class AirportsService {
  constructor(
    @InjectModel(Airport.name)
    private readonly airports: Model<AirportDocument>,
    @InjectModel(City.name) private readonly cities: Model<CityDocument>,
    @InjectModel(Country.name)
    private readonly countries: Model<CountryDocument>,
  ) {}

  async list(q: AirportQueryDto): Promise<PaginatedResult<AirportView>> {
    const { page, limit } = q;
    const filter: FilterQuery<AirportDocument> = {};
    if (q.search) {
      const re = new RegExp(escapeRegex(q.search), 'i');
      filter.$or = [{ _id: re }, { name: re }, { cityId: re }];
    }
    const sort = buildSort(q.sort, ['code', 'name'], 'code:asc');
    if ('code' in sort) {
      sort._id = sort.code;
      delete sort.code;
    }

    const [docs, total] = await Promise.all([
      this.airports
        .find(filter)
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<Airport[]>(),
      this.airports.countDocuments(filter),
    ]);
    return paginated(await this.withNames(docs), total, page, limit);
  }

  // FLT-03 and Aabsy's search (FLT-11): only airports from the list are
  // accepted. Returns the airport, including its time zone; 400 otherwise.
  async assertAirportExists(code: string): Promise<Airport> {
    const iata = typeof code === 'string' ? code.trim().toUpperCase() : '';
    const airport = iata
      ? await this.airports.findById(iata).lean<Airport>()
      : null;
    if (!airport) {
      throw new BadRequestException(`Unknown airport "${code}"`);
    }
    return airport;
  }

  private async withNames(docs: Airport[]): Promise<AirportView[]> {
    const cityIds = [...new Set(docs.map((a) => a.cityId))];
    const countryCodes = [...new Set(docs.map((a) => a.countryCode))];
    const [cities, countries] = await Promise.all([
      this.cities.find({ _id: { $in: cityIds } }).lean<City[]>(),
      this.countries.find({ _id: { $in: countryCodes } }).lean<Country[]>(),
    ]);
    const cityName = new Map(cities.map((c) => [c._id, c.name]));
    const countryName = new Map(countries.map((c) => [c._id, c.name]));
    return docs.map((a) => ({
      code: a._id,
      name: a.name,
      cityId: a.cityId,
      city: cityName.get(a.cityId) ?? a.cityId,
      countryCode: a.countryCode,
      country: countryName.get(a.countryCode) ?? a.countryCode,
      timeZone: a.timeZone,
    }));
  }
}
