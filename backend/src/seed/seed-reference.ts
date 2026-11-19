import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ReferenceSeedService } from '../reference/reference-seed.service';

// GEN-12: seeds countries, cities, airports, attractions and the supported
// currencies from backend/seed-data, which holds the official datasets
// unchanged. The server also does this when it starts.
//
//   npm run seed:reference            insert or update every record (safe to repeat)
//   npm run seed:reference -- --prune also delete records that are no longer in the CSVs

async function run() {
  const prune = process.argv.includes('--prune');
  // The service's own start-up seed is skipped here; this run reports instead.
  process.env.SEED_REFERENCE_ON_START = 'false';
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const c = await app.get(ReferenceSeedService).seed(prune);
    console.log('countries   :', c.countries, 'upserted');
    console.log('cities      :', c.cities, 'upserted');
    console.log('airports    :', c.airports, 'upserted');
    console.log('attractions :', c.attractions, 'upserted');
    console.log('currencies  :', c.currencies, 'upserted');
    if (prune) console.log('removed     :', c.removed);
  } finally {
    await app.close();
  }
}

run().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
