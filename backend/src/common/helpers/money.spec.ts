import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { model, Schema } from 'mongoose';
import {
  DEFAULT_PLATFORM_CURRENCY,
  IsCents,
  isCents,
  isPlatformCurrency,
  platformCurrency,
  platformCurrencyProp,
  stripeCurrency,
} from './money';

// PAY-04: a single platform currency, amounts in whole cents.
describe('money (PAY-04)', () => {
  const saved = process.env.PLATFORM_CURRENCY;
  afterEach(() => {
    if (saved === undefined) delete process.env.PLATFORM_CURRENCY;
    else process.env.PLATFORM_CURRENCY = saved;
  });

  describe('platformCurrency', () => {
    it('is USD when PLATFORM_CURRENCY is not set or empty', () => {
      delete process.env.PLATFORM_CURRENCY;
      expect(DEFAULT_PLATFORM_CURRENCY).toBe('USD');
      expect(platformCurrency()).toBe('USD');
      process.env.PLATFORM_CURRENCY = '';
      expect(platformCurrency()).toBe('USD');
    });

    it('follows PLATFORM_CURRENCY when it is a supported currency', () => {
      process.env.PLATFORM_CURRENCY = 'EUR';
      expect(platformCurrency()).toBe('EUR');
      expect(stripeCurrency()).toBe('eur');
    });

    it('never returns an unsupported value', () => {
      process.env.PLATFORM_CURRENCY = 'ABC';
      expect(platformCurrency()).toBe('USD');
    });
  });

  describe('isPlatformCurrency', () => {
    it('accepts the platform currency in any case, as Stripe sends it', () => {
      delete process.env.PLATFORM_CURRENCY;
      expect(isPlatformCurrency('USD')).toBe(true);
      expect(isPlatformCurrency('usd')).toBe(true);
      expect(stripeCurrency()).toBe('usd');
    });

    it('refuses any other currency or a non-string', () => {
      delete process.env.PLATFORM_CURRENCY;
      expect(isPlatformCurrency('EGP')).toBe(false);
      expect(isPlatformCurrency('')).toBe(false);
      expect(isPlatformCurrency(undefined)).toBe(false);
      expect(isPlatformCurrency(840)).toBe(false);
    });
  });

  describe('isCents', () => {
    it.each([0, 1, 12000])('accepts %p', (n) => {
      expect(isCents(n)).toBe(true);
    });

    it.each([-1, 12.5, NaN, Infinity, '100', null])('refuses %p', (n) => {
      expect(isCents(n)).toBe(false);
    });
  });

  describe('IsCents (DTO fields)', () => {
    class PriceDto {
      @IsCents(1)
      price: number;

      @IsCents()
      fee: number;
    }
    const check = (body: object) =>
      validateSync(plainToInstance(PriceDto, body)).map((e) => e.constraints);

    it('accepts whole cents', () => {
      expect(check({ price: 12000, fee: 0 })).toEqual([]);
    });

    it('refuses a decimal amount and an amount under the minimum', () => {
      const [price, fee] = check({ price: 120.5, fee: -1 });
      expect(price).toMatchObject({
        isInt: 'price must be a whole number of cents',
      });
      expect(fee).toMatchObject({ min: 'fee must be at least 0 cents' });
      expect(check({ price: 0, fee: 0 })[0]).toMatchObject({
        min: 'price must be at least 1 cents',
      });
    });
  });

  describe('platformCurrencyProp (stored records)', () => {
    const Payment = model(
      'MoneySpecPayment',
      new Schema({
        amount: Number,
        currency: platformCurrencyProp(),
      }),
    );

    it('stores the platform currency by default', async () => {
      delete process.env.PLATFORM_CURRENCY;
      const doc = new Payment({ amount: 12000 });
      expect(doc.currency).toBe('USD');
      await expect(doc.validate()).resolves.toBeUndefined();
    });

    it('refuses a record in another currency', async () => {
      delete process.env.PLATFORM_CURRENCY;
      const doc = new Payment({ amount: 12000, currency: 'EGP' });
      await expect(doc.validate()).rejects.toThrow(
        'currency must be the platform currency USD, got EGP',
      );
    });
  });
});
