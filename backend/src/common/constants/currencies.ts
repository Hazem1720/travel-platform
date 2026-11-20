import { applyDecorators } from '@nestjs/common';
import { IsIn } from 'class-validator';

// GEN-12, ITN-18: the supported currencies are the currencies of the official
// countries dataset (backend/seed-data/countries.csv). currencies.spec.ts
// fails if the two ever drift apart.
export const SUPPORTED_CURRENCIES = [
  'AED',
  'EGP',
  'EUR',
  'GBP',
  'JPY',
  'SAR',
  'USD',
] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

// Use on every DTO field that holds a currency code (ACC-09, ITN-14, ITN-16).
export const IsSupportedCurrency = () =>
  applyDecorators(
    IsIn(SUPPORTED_CURRENCIES, {
      message: `$property must be one of: ${SUPPORTED_CURRENCIES.join(', ')}`,
    }),
  );
