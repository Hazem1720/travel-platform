import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  currenciesOf,
  loadReferenceData,
  validateReferenceData,
} from '../seed/reference-data';
import {
  Airport,
  AirportDocument,
  Attraction,
  AttractionDocument,
  City,
  CityDocument,
  Country,
  CountryDocument,
  Currency,
  CurrencyDocument,
} from './schemas/reference.schemas';

export interface SeedCounts {
  countries: number;
  cities: number;
  airports: number;
  attractions: number;
  currencies: number;
  removed: number;
}

// GEN-12: loads the official countries, cities, airports and attractions
// (backend/seed-data, copies of Mock Data.xlsx) and the supported currencies
// into the database at setup. It runs when the server starts (so a fresh
// database is ready without a manual step) and from `npm run seed:reference`.
// Records are upserted by id, so running it again changes nothing.
@Injectable()
export class ReferenceSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger('ReferenceSeed');

  constructor(
    @InjectModel(Country.name)
    private readonly countries: Model<CountryDocument>,
    @InjectModel(City.name) private readonly cities: Model<CityDocument>,
    @InjectModel(Airport.name)
    private readonly airports: Model<AirportDocument>,
    @InjectModel(Attraction.name)
    private readonly attractions: Model<AttractionDocument>,
    @InjectModel(Currency.name)
    private readonly currencies: Model<CurrencyDocument>,
  ) {}

  // On by default; SEED_REFERENCE_ON_START=false turns it off. Tests never
  // seed on start (NODE_ENV=test), so they never write to a database.
  async onApplicationBootstrap() {
    if (
      process.env.NODE_ENV === 'test' ||
      process.env.SEED_REFERENCE_ON_START === 'false'
    ) {
      return;
    }
    try {
      const c = await this.seed();
      this.logger.log(
        `Reference data ready: ${c.countries} countries, ${c.cities} cities, ` +
          `${c.airports} airports, ${c.attractions} attractions, ` +
          `${c.currencies} currencies`,
      );
    } catch (err) {
      // The server still starts; `npm run seed:reference` reports the cause.
      this.logger.error(
        `Reference data was not seeded: ${(err as Error).message}`,
      );
    }
  }

  // Validates every file first: nothing is written if one row is invalid.
  async seed(prune = false): Promise<SeedCounts> {
    const data = loadReferenceData();
    const errors = validateReferenceData(data);
    if (errors.length) {
      throw new Error(`Seed data is invalid:\n- ${errors.join('\n- ')}`);
    }
    const currencies = currenciesOf(data.countries);
    const removed = await Promise.all([
      this.upsertAll(this.countries, data.countries, prune),
      this.upsertAll(this.cities, data.cities, prune),
      this.upsertAll(this.airports, data.airports, prune),
      this.upsertAll(this.attractions, data.attractions, prune),
      this.upsertAll(this.currencies, currencies, prune),
    ]);
    return {
      countries: data.countries.length,
      cities: data.cities.length,
      airports: data.airports.length,
      attractions: data.attractions.length,
      currencies: currencies.length,
      removed: removed.reduce((a, b) => a + b, 0),
    };
  }

  // bulkWrite skips Mongoose validators, so the rows are validated above.
  private async upsertAll(
    model: Model<any>,
    docs: { _id: string }[],
    prune: boolean,
  ): Promise<number> {
    if (docs.length) {
      await model.bulkWrite(
        docs.map((d) => ({
          updateOne: {
            filter: { _id: d._id },
            update: { $set: d },
            upsert: true,
          },
        })),
      );
    }
    if (!prune) return 0;
    const res = await model.deleteMany({
      _id: { $nin: docs.map((d) => d._id) },
    });
    return res.deletedCount ?? 0;
  }
}
