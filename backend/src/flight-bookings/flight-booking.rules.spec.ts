import { BadRequestException } from '@nestjs/common';
import {
  ageOn,
  assertExtraBags,
  assertPassengerMix,
  assertPassengers,
  assertSearchCriteria,
  fareFor,
  parseFlightSort,
  PassengerType,
  passengerTypeForAge,
  priceBooking,
  priceInRange,
  SegmentPricing,
  seatsNeeded,
} from './flight-booking.rules';

const { ADULT, CHILD, INFANT } = PassengerType;

// The error's field details, for checking which input is blamed.
function detailsOf(fn: () => unknown): Record<string, string[]> {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    return (e as BadRequestException).getResponse()['details'];
  }
  throw new Error('expected a 400');
}

describe('passenger types (FLT-12)', () => {
  it('counts whole years on the departure date', () => {
    expect(ageOn('2014-12-02', '2026-12-02')).toBe(12);
    expect(ageOn('2014-12-03', '2026-12-02')).toBe(11);
    expect(ageOn('2024-12-03', '2026-12-02')).toBe(1);
  });

  it('treats a 29 February birthday as 1 March in other years', () => {
    expect(ageOn('2012-02-29', '2024-02-28')).toBe(11);
    expect(ageOn('2012-02-29', '2025-03-01')).toBe(13);
    expect(ageOn('2012-02-29', '2025-02-28')).toBe(12);
  });

  it('adult 12+, child 2-11, infant under 2', () => {
    expect(passengerTypeForAge(12)).toBe(ADULT);
    expect(passengerTypeForAge(11)).toBe(CHILD);
    expect(passengerTypeForAge(2)).toBe(CHILD);
    expect(passengerTypeForAge(1)).toBe(INFANT);
    expect(passengerTypeForAge(0)).toBe(INFANT);
  });

  it('infants take no seat', () => {
    expect(seatsNeeded({ adults: 2, children: 1, infants: 2 })).toBe(3);
  });

  it('needs at least one adult and no more infants than adults', () => {
    expect(() =>
      assertPassengerMix({ adults: 0, children: 2, infants: 0 }),
    ).toThrow(BadRequestException);
    expect(
      detailsOf(() =>
        assertPassengerMix({ adults: 1, children: 0, infants: 2 }),
      ),
    ).toHaveProperty('infants');
    expect(() =>
      assertPassengerMix({ adults: 2, children: 0, infants: 2 }),
    ).not.toThrow();
  });
});

describe('passenger details (FLT-19)', () => {
  const departure = '2026-12-02';

  it('accepts matching types and returns the counts', () => {
    expect(
      assertPassengers(
        [
          { type: ADULT, dateOfBirth: '1990-01-01' },
          { type: CHILD, dateOfBirth: '2018-06-01' },
          { type: INFANT, dateOfBirth: '2026-01-15' },
        ],
        departure,
      ),
    ).toEqual({ adults: 1, children: 1, infants: 1 });
  });

  it('rejects a "child" who is 13 on the departure date', () => {
    const details = detailsOf(() =>
      assertPassengers(
        [
          { type: ADULT, dateOfBirth: '1990-01-01' },
          { type: CHILD, dateOfBirth: '2013-11-01' },
        ],
        departure,
      ),
    );
    expect(details['passengers.1.dateOfBirth'][0]).toContain('an adult');
  });

  it('rejects a date of birth after the departure', () => {
    expect(
      detailsOf(() =>
        assertPassengers(
          [
            { type: ADULT, dateOfBirth: '1990-01-01' },
            { type: INFANT, dateOfBirth: '2026-12-03' },
          ],
          departure,
        ),
      ),
    ).toHaveProperty(['passengers.1.dateOfBirth']);
  });

  it('applies the mix rules to the passenger list', () => {
    expect(() =>
      assertPassengers([{ type: CHILD, dateOfBirth: '2018-06-01' }], departure),
    ).toThrow('Validation failed');
  });
});

describe('search criteria (FLT-11, FLT-12, FLT-15)', () => {
  const base = {
    from: 'CAI',
    to: 'DXB',
    date: '2026-12-02',
    adults: 1,
    children: 0,
    infants: 0,
  };

  it('accepts a normal search', () => {
    expect(() => assertSearchCriteria(base)).not.toThrow();
    expect(() =>
      assertSearchCriteria({ ...base, returnDate: '2026-12-02' }),
    ).not.toThrow();
  });

  it('rejects the same airport twice', () => {
    expect(
      detailsOf(() => assertSearchCriteria({ ...base, to: 'CAI' })),
    ).toHaveProperty('to');
  });

  it('rejects a return date before the departure date', () => {
    expect(
      detailsOf(() =>
        assertSearchCriteria({ ...base, returnDate: '2026-12-01' }),
      ),
    ).toHaveProperty('returnDate');
  });

  it('rejects adults=0 and 2 infants with 1 adult', () => {
    expect(() =>
      assertSearchCriteria({ ...base, adults: 0, children: 1 }),
    ).toThrow(BadRequestException);
    expect(() => assertSearchCriteria({ ...base, infants: 2 })).toThrow(
      BadRequestException,
    );
  });

  it('rejects minPrice above maxPrice', () => {
    expect(
      detailsOf(() =>
        assertSearchCriteria({ ...base, minPrice: 30000, maxPrice: 10000 }),
      ),
    ).toHaveProperty('minPrice');
  });

  it('filters prices inclusively: 100, 200, 300 with 200-300 keeps 2', () => {
    const kept = [10000, 20000, 30000].filter((p) =>
      priceInRange(p, 20000, 30000),
    );
    expect(kept).toEqual([20000, 30000]);
    expect(priceInRange(5, undefined, undefined)).toBe(true);
  });

  it('sorts by price, duration or departure', () => {
    expect(parseFlightSort()).toEqual({ field: 'departure', direction: 1 });
    expect(parseFlightSort('price:desc')).toEqual({
      field: 'price',
      direction: -1,
    });
    expect(parseFlightSort('duration')).toEqual({
      field: 'duration',
      direction: 1,
    });
    expect(() => parseFlightSort('airline')).toThrow(BadRequestException);
    expect(() => parseFlightSort('price:up')).toThrow(BadRequestException);
  });
});

describe('price (FLT-12, FLT-19, FLT-21)', () => {
  const economy: SegmentPricing = {
    cabinFare: 20000,
    maxKgPerBag: 23,
    extraBagPrice: 5000,
    maxExtraBags: 2,
  };

  it('infants pay 10% of the fare, rounded to whole cents', () => {
    expect(fareFor(INFANT, 20000)).toBe(2000);
    expect(fareFor(INFANT, 12345)).toBe(1235);
    expect(fareFor(CHILD, 20000)).toBe(20000);
  });

  it('2 adults and 1 infant in a 200 USD cabin cost 420 USD per segment', () => {
    const price = priceBooking(
      [economy],
      [{ type: ADULT }, { type: ADULT }, { type: INFANT }],
    );
    expect(price.segments[0].fares).toBe(42000);
    expect(price.total).toBe(42000);
    expect(price.currency).toBe('USD');
  });

  it('a round trip prices both segments', () => {
    const price = priceBooking(
      [economy, { ...economy, cabinFare: 30000 }],
      [{ type: ADULT }, { type: INFANT }],
    );
    expect(price.segments.map((s) => s.subtotal)).toEqual([22000, 33000]);
    expect(price.total).toBe(55000);
  });

  it('adds extra bags x extraBagPrice on every segment', () => {
    const price = priceBooking(
      [economy, economy],
      [{ type: ADULT, extraBags: [{ weightKg: 23 }, { weightKg: 10 }] }],
    );
    expect(price.segments[0]).toMatchObject({
      fares: 20000,
      baggageFees: 10000,
      subtotal: 30000,
    });
    expect(price).toMatchObject({
      fares: 40000,
      baggageFees: 20000,
      total: 60000,
    });
  });

  it('rejects more extra bags than the airline allows', () => {
    expect(
      detailsOf(() =>
        assertExtraBags(
          [
            {
              type: ADULT,
              extraBags: [{ weightKg: 5 }, { weightKg: 5 }, { weightKg: 5 }],
            },
          ],
          economy,
        ),
      ),
    ).toHaveProperty(['passengers.0.extraBags']);
  });

  it('rejects a bag heavier than maxKgPerBag', () => {
    expect(
      detailsOf(() =>
        assertExtraBags(
          [{ type: ADULT }, { type: ADULT, extraBags: [{ weightKg: 24 }] }],
          economy,
        ),
      ),
    ).toHaveProperty(['passengers.1.extraBags.0.weightKg']);
  });

  it('rejects extra bags when the airline has no extra-bag price', () => {
    expect(() =>
      priceBooking(
        [{ ...economy, extraBagPrice: null }],
        [{ type: ADULT, extraBags: [{ weightKg: 10 }] }],
      ),
    ).toThrow(BadRequestException);
    expect(
      priceBooking([{ ...economy, extraBagPrice: null }], [{ type: ADULT }])
        .total,
    ).toBe(20000);
  });
});
