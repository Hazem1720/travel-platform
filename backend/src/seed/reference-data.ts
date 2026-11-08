import { readFileSync } from 'fs';
import { join } from 'path';

// Folder with the official datasets (docs/requirements/official-datasets).
// Resolved from this file, so it works from src/ (ts-node) and dist/ (node).
export const SEED_DATA_DIR = join(__dirname, '..', '..', 'seed-data');

export interface CountryRow {
  _id: string;
  name: string;
  currency: string;
}
export interface CityRow {
  _id: string;
  name: string;
  countryCode: string;
}
export interface AirportRow {
  _id: string;
  name: string;
  cityId: string;
  countryCode: string;
  timeZone: string;
}
export interface AttractionRow {
  _id: string;
  name: string;
  cityId: string;
}
export interface ReferenceData {
  countries: CountryRow[];
  cities: CityRow[];
  airports: AirportRow[];
  attractions: AttractionRow[];
}

// RFC 4180 CSV: quoted cells, escaped quotes, CRLF or LF, optional BOM.
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        cell += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
    } else {
      cell += c;
    }
  }
  row.push(cell);
  if (row.some((v) => v.trim() !== '')) rows.push(row);
  if (rows.length === 0) return [];

  const header = rows[0].map((h) => h.trim().replace(/^﻿/, ''));
  return rows
    .slice(1)
    .map((r) =>
      Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])),
    );
}

function readCsv(dir: string, name: string) {
  return parseCsv(readFileSync(join(dir, name), 'utf8'));
}

export function loadReferenceData(dir = SEED_DATA_DIR): ReferenceData {
  return {
    countries: readCsv(dir, 'countries.csv').map((r) => ({
      _id: r.code,
      name: r.name,
      currency: r.currency,
    })),
    cities: readCsv(dir, 'cities.csv').map((r) => ({
      _id: r.city_id,
      name: r.name,
      countryCode: r.country_code,
    })),
    airports: readCsv(dir, 'airports.csv').map((r) => ({
      _id: r.iata_code,
      name: r.name,
      cityId: r.city_id,
      countryCode: r.country_code,
      timeZone: r.time_zone,
    })),
    attractions: readCsv(dir, 'attractions.csv').map((r) => ({
      _id: r.attraction_id,
      name: r.name,
      cityId: r.city_id,
    })),
  };
}

function isIanaTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Returns every problem found. An empty list means the data is safe to write.
export function validateReferenceData(data: ReferenceData): string[] {
  const errors: string[] = [];
  const requireFields = (
    label: string,
    rows: object[],
    fields: string[],
  ): void => {
    const seen = new Set<string>();
    rows.forEach((row, i) => {
      const r = row as Record<string, string>;
      for (const f of fields) {
        if (!r[f]) errors.push(`${label} row ${i + 2}: "${f}" is empty`);
      }
      if (r._id && seen.has(r._id)) {
        errors.push(`${label}: duplicate id "${r._id}"`);
      }
      seen.add(r._id);
    });
  };

  requireFields('countries.csv', data.countries, ['_id', 'name', 'currency']);
  requireFields('cities.csv', data.cities, ['_id', 'name', 'countryCode']);
  requireFields('airports.csv', data.airports, [
    '_id',
    'name',
    'cityId',
    'countryCode',
    'timeZone',
  ]);
  requireFields('attractions.csv', data.attractions, ['_id', 'name', 'cityId']);

  const countryIds = new Set(data.countries.map((c) => c._id));
  const cityCountry = new Map(data.cities.map((c) => [c._id, c.countryCode]));

  for (const c of data.cities) {
    if (c.countryCode && !countryIds.has(c.countryCode)) {
      errors.push(`city "${c._id}": unknown country "${c.countryCode}"`);
    }
  }
  for (const a of data.airports) {
    if (a.cityId && !cityCountry.has(a.cityId)) {
      errors.push(`airport "${a._id}": unknown city "${a.cityId}"`);
    } else if (a.cityId && cityCountry.get(a.cityId) !== a.countryCode) {
      errors.push(
        `airport "${a._id}": country "${a.countryCode}" does not match city "${a.cityId}"`,
      );
    }
    if (a.timeZone && !isIanaTimeZone(a.timeZone)) {
      errors.push(
        `airport "${a._id}": "${a.timeZone}" is not an IANA time zone`,
      );
    }
  }
  for (const a of data.attractions) {
    if (a.cityId && !cityCountry.has(a.cityId)) {
      errors.push(`attraction "${a._id}": unknown city "${a.cityId}"`);
    }
  }
  return errors;
}
