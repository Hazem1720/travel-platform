import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AppModule } from '../app.module';
import {
  Airport,
  Attraction,
  City,
  Country,
} from '../reference/schemas/reference.schemas';
import { loadReferenceData, validateReferenceData } from './reference-data';

// GEN-12: seeds countries, cities, airports and attractions from backend/seed-data,
// which holds the official datasets unchanged.
//
//   npm run seed:reference            insert or update every record (safe to repeat)
//   npm run seed:reference -- --prune also delete records that are no longer in the CSVs

async function upsertAll(
  model: Model<any>,
  docs: { _id: string }[],
  prune: boolean,
) {
  // bulkWrite skips Mongoose validators, so the rows are validated before this point.
  await model.bulkWrite(
    docs.map((d) => ({
      updateOne: { filter: { _id: d._id }, update: { $set: d }, upsert: true },
    })),
  );
  let removed = 0;
  if (prune) {
    const res = await model.deleteMany({
      _id: { $nin: docs.map((d) => d._id) },
    });
    removed = res.deletedCount ?? 0;
  }
  return `${docs.length} upserted${prune ? `, ${removed} removed` : ''}`;
}

async function run() {
  const prune = process.argv.includes('--prune');

  // Validate before connecting: a bad file must never reach the shared database.
  const data = loadReferenceData();
  const errors = validateReferenceData(data);
  if (errors.length) {
    throw new Error(`Seed data is invalid:\n- ${errors.join('\n- ')}`);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const model = (name: string) => app.get<Model<any>>(getModelToken(name));
    console.log(
      'countries   :',
      await upsertAll(model(Country.name), data.countries, prune),
    );
    console.log(
      'cities      :',
      await upsertAll(model(City.name), data.cities, prune),
    );
    console.log(
      'airports    :',
      await upsertAll(model(Airport.name), data.airports, prune),
    );
    console.log(
      'attractions :',
      await upsertAll(model(Attraction.name), data.attractions, prune),
    );
  } finally {
    await app.close();
  }
}

run().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
