import {
  loadReferenceData,
  parseCsv,
  ReferenceData,
  validateReferenceData,
} from './reference-data';

describe('reference seed data (GEN-12)', () => {
  const data = loadReferenceData();

  it('contains every record of the official datasets', () => {
    expect(data.countries).toHaveLength(8);
    expect(data.cities).toHaveLength(8);
    expect(data.airports).toHaveLength(8);
    expect(data.attractions).toHaveLength(8);
    expect(data.airports.map((a) => a._id)).toEqual(
      expect.arrayContaining([
        'CAI',
        'DXB',
        'LHR',
        'JFK',
        'CDG',
        'HND',
        'RUH',
        'FRA',
      ]),
    );
    expect(data.cities.map((c) => c._id)).toContain('frankfurt');
    expect(data.attractions.map((a) => a._id)).toContain('att-8');
  });

  it('gives every airport its official IANA time zone (FLT-02)', () => {
    const fra = data.airports.find((a) => a._id === 'FRA');
    expect(fra).toEqual({
      _id: 'FRA',
      name: 'Frankfurt Airport',
      cityId: 'frankfurt',
      countryCode: 'DE',
      timeZone: 'Europe/Berlin',
    });
    expect(data.airports.every((a) => a.timeZone)).toBe(true);
  });

  it('passes validation', () => {
    expect(validateReferenceData(data)).toEqual([]);
  });

  describe('validateReferenceData', () => {
    const clone = (): ReferenceData => JSON.parse(JSON.stringify(data));

    it('rejects an airport without a time zone', () => {
      const d = clone();
      d.airports[0].timeZone = '';
      expect(validateReferenceData(d)).toContain(
        'airports.csv row 2: "timeZone" is empty',
      );
    });

    it('rejects a time zone that is not IANA', () => {
      const d = clone();
      d.airports[0].timeZone = 'Cairo time';
      expect(validateReferenceData(d).join()).toMatch(/not an IANA time zone/);
    });

    it('rejects unknown cities and countries', () => {
      const d = clone();
      d.attractions[0].cityId = 'atlantis';
      d.cities[0].countryCode = 'XX';
      const errors = validateReferenceData(d).join('\n');
      expect(errors).toMatch(/attraction "att-1": unknown city "atlantis"/);
      expect(errors).toMatch(/unknown country "XX"/);
    });

    it('rejects duplicate ids', () => {
      const d = clone();
      d.countries.push({ ...d.countries[0] });
      expect(validateReferenceData(d).join()).toMatch(/duplicate id "EG"/);
    });
  });

  describe('parseCsv', () => {
    it('handles quotes, escaped quotes, CRLF, BOM and a missing final newline', () => {
      const text = '﻿id,name\r\n1,"Paris, ""City of Light"""\r\n2, Rome ';
      expect(parseCsv(text)).toEqual([
        { id: '1', name: 'Paris, "City of Light"' },
        { id: '2', name: 'Rome' },
      ]);
    });
  });
});
