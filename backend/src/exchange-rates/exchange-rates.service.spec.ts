import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ExchangeRatesService } from './exchange-rates.service';

// ITN-18: rates fetched once a day, cached, and the last cached rates used
// when the API is down.
describe('ExchangeRatesService (ITN-18)', () => {
  const TODAY = new Date().toISOString().slice(0, 10);
  const RATES = {
    USD: 1,
    AED: 3.67,
    EGP: 50,
    EUR: 0.9,
    GBP: 0.8,
    JPY: 150,
    SAR: 3.75,
  };
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  function setup(
    opts: { cachedToday?: boolean; older?: boolean; key?: string } = {},
  ) {
    const docs: any[] = [];
    if (opts.older) {
      docs.push({
        date: '2026-11-10',
        base: 'USD',
        rates: { ...RATES, EGP: 48 },
      });
    }
    if (opts.cachedToday) docs.push({ date: TODAY, base: 'USD', rates: RATES });
    const model = {
      findOne: jest.fn((q?: { date: string }) => {
        const query = {
          sort: () => ({
            lean: async () =>
              [...docs].sort((a, b) => b.date.localeCompare(a.date))[0] ?? null,
          }),
          lean: async () => docs.find((d) => d.date === q?.date) ?? null,
        };
        return query;
      }),
      findOneAndUpdate: jest.fn((_f: any, doc: any) => ({
        lean: async () => {
          docs.push(doc);
          return doc;
        },
      })),
    };
    const config = {
      get: jest.fn(() => ('key' in opts ? opts.key : 'test-key')),
    };
    return {
      service: new ExchangeRatesService(model as any, config as any),
      model,
    };
  }

  const apiAnswers = (status: number, body: unknown) => {
    global.fetch = jest.fn(async () => ({
      ok: status < 400,
      status,
      json: async () => body,
    })) as any;
  };

  it("uses today's cached rates without calling the API", async () => {
    global.fetch = jest.fn() as any;
    const { service } = setup({ cachedToday: true });
    const rates = await service.getRates();
    expect(rates).toMatchObject({ date: TODAY, stale: false });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fetches and caches the rates on first need', async () => {
    apiAnswers(200, { success: true, base: 'USD', rates: RATES });
    const { service, model } = setup();
    const rates = await service.getRates();
    expect(rates.rates.EGP).toBe(50);
    expect(model.findOneAndUpdate).toHaveBeenCalledTimes(1);
    const url = String((global.fetch as jest.Mock).mock.calls[0][0]);
    expect(url).toContain('base=USD');
    expect(url).toContain('api_key=test-key');
  });

  it('uses the last cached rates and their older date when the API is down (wrong key)', async () => {
    apiAnswers(401, { success: false, error: 'invalid_key' });
    const { service } = setup({ older: true });
    const rates = await service.getRates();
    expect(rates).toMatchObject({ date: '2026-11-10', stale: true });
    expect(rates.rates.EGP).toBe(48);
  });

  it('does not call the API again right after a failure', async () => {
    apiAnswers(500, {});
    const { service } = setup({ older: true });
    await service.getRates();
    await service.getRates();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('answers 503 when the API is down and nothing is cached', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('network down');
    }) as any;
    const { service } = setup();
    await expect(service.getRates()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('works from the cache with no API key set', async () => {
    global.fetch = jest.fn() as any;
    const { service } = setup({ older: true, key: '' });
    await expect(service.getRates()).resolves.toMatchObject({ stale: true });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('converts through USD', () => {
    const { service } = setup();
    const r = { date: TODAY, base: 'USD', rates: RATES, stale: false };
    expect(service.convert(10, 'USD', 'EGP', r)).toBe(500);
    expect(service.convert(500, 'EGP', 'EUR', r)).toBeCloseTo(9);
    expect(service.convert(7, 'EGP', 'EGP', r)).toBe(7);
    expect(() => service.convert(1, 'ABC', 'EGP', r)).toThrow(
      BadRequestException,
    );
  });
});
