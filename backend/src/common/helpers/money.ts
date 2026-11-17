import { applyDecorators } from '@nestjs/common';
import { IsInt, Min } from 'class-validator';
import {
  SUPPORTED_CURRENCIES,
  SupportedCurrency,
} from '../constants/currencies';

// PAY-04: every flight price, hotel price, payment and refund uses one
// platform currency (conventions.md, "Money"). It is the backend setting
// PLATFORM_CURRENCY, USD unless set, checked at startup by env.validation.ts.
// Amounts are always integers in the currency's smallest unit (cents for
// USD), which is also the unit Stripe expects.
export const DEFAULT_PLATFORM_CURRENCY: SupportedCurrency = 'USD';

// Read when called, not at import, so it sees the value ConfigModule loaded
// from backend/.env. Booking prices are never converted (ITN-18 converts only
// itinerary budgets).
export function platformCurrency(): SupportedCurrency {
  const value = process.env.PLATFORM_CURRENCY;
  return value && (SUPPORTED_CURRENCIES as readonly string[]).includes(value)
    ? (value as SupportedCurrency)
    : DEFAULT_PLATFORM_CURRENCY;
}

// True for the platform currency in any letter case (Stripe sends "usd").
// PAY-01 uses it to check the currency of a verified Stripe payment.
export function isPlatformCurrency(code: unknown): boolean {
  return typeof code === 'string' && code.toUpperCase() === platformCurrency();
}

// The currency code in the lowercase form Stripe PaymentIntents use.
export function stripeCurrency(): string {
  return platformCurrency().toLowerCase();
}

// True for a whole, non-negative number of the smallest unit (cents).
export function isCents(amount: unknown): amount is number {
  return Number.isSafeInteger(amount) && (amount as number) >= 0;
}

// For the currency field of every stored price snapshot, Payment and Refund
// record: @Prop(platformCurrencyProp()). New documents get the platform
// currency, and any other value is refused when the document is saved.
export function platformCurrencyProp() {
  return {
    type: String,
    required: true,
    default: platformCurrency,
    validate: {
      validator: isPlatformCurrency,
      message: (props: { value: unknown }) =>
        `currency must be the platform currency ${platformCurrency()}, got ${String(props.value)}`,
    },
  };
}

// For DTO amount fields: a whole number of cents, at least `min` (default 0;
// use 1 for prices that must be greater than 0).
export const IsCents = (min = 0) =>
  applyDecorators(
    IsInt({ message: '$property must be a whole number of cents' }),
    Min(min, { message: `$property must be at least ${min} cents` }),
  );
