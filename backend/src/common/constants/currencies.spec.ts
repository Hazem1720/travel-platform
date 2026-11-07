import { readFileSync } from 'fs';
import { join } from 'path';
import { SUPPORTED_CURRENCIES } from './currencies';

describe('SUPPORTED_CURRENCIES (GEN-12)', () => {
  it('matches the currencies in the official countries dataset', () => {
    const csv = readFileSync(
      join(__dirname, '..', '..', '..', 'seed-data', 'countries.csv'),
      'utf8',
    );
    const [header, ...rows] = csv.split(/\r?\n/).filter((l) => l.trim());
    const col = header.split(',').indexOf('currency');
    const fromData = [...new Set(rows.map((r) => r.split(',')[col].trim()))].sort();

    expect([...SUPPORTED_CURRENCIES].sort()).toEqual(fromData);
  });
});
