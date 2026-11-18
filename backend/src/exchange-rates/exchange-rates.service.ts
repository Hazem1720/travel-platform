import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model } from 'mongoose';
import { SUPPORTED_CURRENCIES } from '../common/constants/currencies';
import {
  ExchangeRate,
  ExchangeRateDocument,
} from './schemas/exchange-rate.schema';

export const FXRATES_URL = 'https://api.fxratesapi.com/latest';
export const RATES_BASE = 'USD';
export const NO_RATES =
  'Exchange rates are unavailable right now and none are cached yet, please try again later';
// After a failed call, wait this long before calling the API again, so a
// broken key or an outage does not slow every budget request.
export const RETRY_AFTER_MS = 10 * 60 * 1000;

export interface Rates {
  date: string;
  base: string;
  rates: Record<string, number>;
  // true when today's rates could not be fetched and older ones are used.
  stale: boolean;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ITN-18: exchange rates from FXRatesAPI (key FXRATES_API_KEY in backend/.env,
// never sent to the frontend), fetched once a day (cron, and on first need)
// and cached in the database. If the API is unavailable the latest cached
// rates are used; if there are none at all, 503. Booking prices are never
// converted (PAY-04): only itinerary budgets use this.
@Injectable()
export class ExchangeRatesService {
  private readonly logger = new Logger(ExchangeRatesService.name);
  private lastFailureAt = 0;

  constructor(
    @InjectModel(ExchangeRate.name)
    private readonly rates: Model<ExchangeRateDocument>,
    private readonly config: ConfigService,
  ) {}

  // Today's rates, or the latest cached ones if today's cannot be fetched.
  async getRates(): Promise<Rates> {
    const cached = await this.rates.findOne({ date: today() }).lean();
    if (cached) return this.toRates(cached, false);

    if (Date.now() - this.lastFailureAt >= RETRY_AFTER_MS) {
      const fresh = await this.refresh();
      if (fresh) return this.toRates(fresh, false);
    }
    const latest = await this.rates.findOne().sort({ date: -1 }).lean();
    if (!latest) throw new ServiceUnavailableException(NO_RATES);
    return this.toRates(latest, latest.date !== today());
  }

  // Once a day, shortly after midnight UTC.
  @Cron(CronExpression.EVERY_DAY_AT_1AM, { timeZone: 'UTC' })
  async dailyRefresh() {
    await this.refresh();
  }

  // Fetches the rates for the supported currencies and caches them. Returns
  // null (and logs why) if the API cannot be used; never throws.
  async refresh(): Promise<{
    date: string;
    base: string;
    rates: unknown;
  } | null> {
    const key = this.config.get<string>('FXRATES_API_KEY');
    if (!key) {
      this.lastFailureAt = Date.now();
      this.logger.warn('FXRATES_API_KEY is not set; using cached rates');
      return null;
    }
    try {
      const url = new URL(FXRATES_URL);
      url.searchParams.set('base', RATES_BASE);
      url.searchParams.set('currencies', SUPPORTED_CURRENCIES.join(','));
      url.searchParams.set('api_key', key);
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const body = (await res.json().catch(() => null)) as {
        success?: boolean;
        date?: string;
        rates?: Record<string, number>;
      } | null;
      const rates = this.pickSupported(body?.rates);
      if (!res.ok || body?.success === false || !rates) {
        throw new Error(`FXRatesAPI answered ${res.status}`);
      }
      const date = today();
      const saved = await this.rates
        .findOneAndUpdate(
          { date },
          { date, base: RATES_BASE, rates, fetchedAt: new Date() },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        )
        .lean();
      this.lastFailureAt = 0;
      return saved;
    } catch (err) {
      this.lastFailureAt = Date.now();
      this.logger.warn(
        `Could not fetch exchange rates: ${(err as Error).message}`,
      );
      return null;
    }
  }

  // amount in `from` to `to`, through the base currency.
  convert(amount: number, from: string, to: string, rates: Rates): number {
    if (from === to) return amount;
    const fromRate = rates.rates[from];
    const toRate = rates.rates[to];
    if (!fromRate || !toRate) {
      throw new BadRequestException(
        `No exchange rate for ${!fromRate ? from : to}`,
      );
    }
    return (amount / fromRate) * toRate;
  }

  // Only the supported currencies, all positive numbers, with the base at 1.
  private pickSupported(raw: unknown): Record<string, number> | null {
    if (!raw || typeof raw !== 'object') return null;
    const out: Record<string, number> = { [RATES_BASE]: 1 };
    for (const code of SUPPORTED_CURRENCIES) {
      const value = (raw as Record<string, unknown>)[code];
      if (code === RATES_BASE) continue;
      if (typeof value !== 'number' || !(value > 0)) return null;
      out[code] = value;
    }
    return out;
  }

  private toRates(
    doc: { date: string; base: string; rates: unknown },
    stale: boolean,
  ): Rates {
    const rates =
      doc.rates instanceof Map
        ? Object.fromEntries(doc.rates)
        : (doc.rates as Record<string, number>);
    return { date: doc.date, base: doc.base, rates, stale };
  }
}
