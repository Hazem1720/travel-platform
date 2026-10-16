import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Model } from 'mongoose';
import { AppModule } from '../app.module';
import {
  Airport,
  Attraction,
  City,
  Country,
} from '../reference/schemas/reference.schemas';

// Run from the backend folder:  npx ts-node src/seed/seed-reference.ts
// Reads the four CSV files in backend/seed-data. Safe to run many times (upsert by id).

// Used only when the airports CSV has no time_zone column.
const FALLBACK_TIME_ZONES: Record<string, string> = {
  CAI: 'Africa/Cairo',
  DXB: 'Asia/Dubai',
  LHR: 'Europe/London',
  JFK: 'America/New_York',
  CDG: 'Europe/Paris',
  HND: 'Asia/Tokyo',
  RUH: 'Asia/Riyadh',
};

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((v) => v.trim() !== '')) rows.push(row);

  const header = rows[0].map((h) => h.trim().replace(/^\uFEFF/, ''));
  return rows.slice(1).map((r) =>
    Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])),
  );
}

function readCsv(name: string) {
  return parseCsv(readFileSync(join(process.cwd(), 'seed-data', name), 'utf8'));
}

async function upsertAll(model: Model<any>, docs: { _id: string }[]) {
  if (docs.length === 0) return 0;
  await model.bulkWrite(
    docs.map((d) => ({
      updateOne: { filter: { _id: d._id }, update: { $set: d }, upsert: true },
    })),
  );
  return docs.length;
}

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const countryModel = app.get<Model<any>>(getModelToken(Country.name));
  const cityModel = app.get<Model<any>>(getModelToken(City.name));
  const airportModel = app.get<Model<any>>(getModelToken(Airport.name));
  const attractionModel = app.get<Model<any>>(getModelToken(Attraction.name));

  const countries = readCsv('countries.csv').map((r) => ({
    _id: r.code, name: r.name, currency: r.currency,
  }));
  const cities = readCsv('cities.csv').map((r) => ({
    _id: r.city_id, name: r.name, countryCode: r.country_code,
  }));
  const airports = readCsv('airports.csv').map((r) => ({
    _id: r.iata_code,
    name: r.name,
    cityId: r.city_id,
    countryCode: r.country_code,
    timeZone: r.time_zone || FALLBACK_TIME_ZONES[r.iata_code] || null,
  }));
  const attractions = readCsv('attractions.csv').map((r) => ({
    _id: r.attraction_id, name: r.name, cityId: r.city_id,
  }));

  console.log('countries   :', await upsertAll(countryModel, countries));
  console.log('cities      :', await upsertAll(cityModel, cities));
  console.log('airports    :', await upsertAll(airportModel, airports));
  console.log('attractions :', await upsertAll(attractionModel, attractions));

  const noTz = airports.filter((a) => !a.timeZone).map((a) => a._id);
  if (noTz.length) console.warn('Airports without a time zone:', noTz.join(', '));

  await app.close();
}

run().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
