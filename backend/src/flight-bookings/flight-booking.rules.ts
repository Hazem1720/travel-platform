import { BadRequestException } from '@nestjs/common';
import { CabinCategory } from '../flights/schemas/flight.schema';

// Business rules for flight search and booking (FLT-11, FLT-12, FLT-15,
// FLT-19, FLT-21). Pure functions: no database, so they are unit tested on
// their own and the search, the quote and the hold all use the same code.
// Money is in integer USD cents (PAY-04).

// The cabin set is Hazem's (FLT-04), re-exported so this module's DTOs and
// callers import everything flight-booking related from one place.
export { CabinCategory };

// FLT-12: adult 12 and over, child 2 to 11, infant under 2.
export enum PassengerType {
  ADULT = 'adult',
  CHILD = 'child',
  INFANT = 'infant',
}

export interface PassengerCounts {
  adults: number;
  children: number;
  infants: number;
}

// 400 in the shared validation format: { message, details: { field: [..] } }.
function fieldError(field: string, message: string): BadRequestException {
  return new BadRequestException({
    error: 'Bad Request',
    message: 'Validation failed',
    details: { [field]: [message] },
  });
}

// ---------------------------------------------------------------- passengers

// Whole years between two calendar dates (YYYY-MM-DD). Someone born on
// 29 February has their birthday on 1 March in other years.
export function ageOn(dateOfBirth: string, onDate: string): number {
  const [by, bm, bd] = dateOfBirth.split('-').map(Number);
  const [y, m, d] = onDate.split('-').map(Number);
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age--;
  return age;
}

export function passengerTypeForAge(age: number): PassengerType {
  if (age >= 12) return PassengerType.ADULT;
  if (age >= 2) return PassengerType.CHILD;
  return PassengerType.INFANT;
}

// FLT-11 asks for "number of passengers" and FLT-12 for adults, children and
// infants. ?passengers=3 means 3 adults; it cannot be mixed with the others.
export function passengerCounts(q: {
  passengers?: number;
  adults?: number;
  children?: number;
  infants?: number;
}): PassengerCounts {
  const typed =
    q.adults !== undefined ||
    q.children !== undefined ||
    q.infants !== undefined;
  if (q.passengers !== undefined) {
    if (typed) {
      throw fieldError(
        'passengers',
        'Use either passengers or adults, children and infants',
      );
    }
    return { adults: q.passengers, children: 0, infants: 0 };
  }
  return {
    adults: q.adults ?? 1,
    children: q.children ?? 0,
    infants: q.infants ?? 0,
  };
}

// Adults and children take a seat; infants sit on an adult's lap.
export function seatsNeeded(c: PassengerCounts): number {
  return c.adults + c.children;
}

// FLT-12: at least one adult, and no more infants than adults.
export function assertPassengerMix(c: PassengerCounts, field = 'adults'): void {
  if (c.adults < 1) {
    throw fieldError(field, 'Each booking needs at least one adult');
  }
  if (c.infants > c.adults) {
    throw fieldError(
      'infants',
      'There cannot be more infants than adults (one infant per adult)',
    );
  }
}

export interface PassengerIdentity {
  type: PassengerType;
  dateOfBirth: string;
}

// FLT-19: the date of birth must match the chosen type on the departure date
// (the local date at the departure airport). For a round trip, use the
// outbound departure date. Then the FLT-12 mix rules.
export function assertPassengers(
  passengers: PassengerIdentity[],
  departureDate: string,
): PassengerCounts {
  const counts: PassengerCounts = { adults: 0, children: 0, infants: 0 };
  passengers.forEach((p, i) => {
    const field = `passengers.${i}.dateOfBirth`;
    if (p.dateOfBirth > departureDate) {
      throw fieldError(field, 'Date of birth is after the departure date');
    }
    const actual = passengerTypeForAge(ageOn(p.dateOfBirth, departureDate));
    if (actual !== p.type) {
      throw fieldError(
        field,
        `This date of birth makes the passenger ${article(actual)} ${actual} ` +
          `on the departure date, not ${article(p.type)} ${p.type}`,
      );
    }
    if (p.type === PassengerType.ADULT) counts.adults++;
    else if (p.type === PassengerType.CHILD) counts.children++;
    else counts.infants++;
  });
  assertPassengerMix(counts, 'passengers');
  return counts;
}

const article = (t: PassengerType) => (t === PassengerType.ADULT ? 'an' : 'a');

// -------------------------------------------------------------------- search

export interface SearchCriteria extends PassengerCounts {
  from: string;
  to: string;
  date: string;
  returnDate?: string;
  minPrice?: number;
  maxPrice?: number;
}

// FLT-11, FLT-12, FLT-15: the checks that involve more than one field.
export function assertSearchCriteria(q: SearchCriteria): void {
  if (q.from === q.to) {
    throw fieldError('to', 'Departure and arrival airports must differ');
  }
  if (q.returnDate && q.returnDate < q.date) {
    throw fieldError('returnDate', 'Return date cannot be before the date');
  }
  assertPassengerMix(q);
  if (
    q.minPrice !== undefined &&
    q.maxPrice !== undefined &&
    q.minPrice > q.maxPrice
  ) {
    throw fieldError('minPrice', 'minPrice cannot be greater than maxPrice');
  }
}

// FLT-15: sort=price|duration|departure, optionally :asc or :desc.
export type FlightSortField = 'price' | 'duration' | 'departure';
export interface FlightSort {
  field: FlightSortField;
  direction: 1 | -1;
}
const SORT_FIELDS: FlightSortField[] = ['price', 'duration', 'departure'];

export function parseFlightSort(sort?: string): FlightSort {
  const [field, dir = 'asc'] = (sort || 'departure:asc').split(':');
  if (!SORT_FIELDS.includes(field as FlightSortField)) {
    throw fieldError('sort', `sort must be one of: ${SORT_FIELDS.join(', ')}`);
  }
  if (dir !== 'asc' && dir !== 'desc') {
    throw fieldError('sort', 'Sort direction must be asc or desc');
  }
  return { field: field as FlightSortField, direction: dir === 'asc' ? 1 : -1 };
}

// FLT-15: inclusive range on a price in cents.
export function priceInRange(
  price: number,
  minPrice?: number,
  maxPrice?: number,
): boolean {
  return (
    (minPrice === undefined || price >= minPrice) &&
    (maxPrice === undefined || price <= maxPrice)
  );
}

// --------------------------------------------------------------------- price

// FLT-12: infants pay 10% of the cabin fare, rounded to whole cents.
export function fareFor(type: PassengerType, cabinFare: number): number {
  return type === PassengerType.INFANT ? Math.round(cabinFare / 10) : cabinFare;
}

// FLT-12: what the passengers pay for one cabin on one flight, before extra
// bags: adults and children the full fare, infants 10%. 2 adults and 1 infant
// in a 200 USD cabin: 200 + 200 + 20 = 420 USD.
export function faresTotal(c: PassengerCounts, cabinFare: number): number {
  return (
    (c.adults + c.children) * cabinFare +
    c.infants * fareFor(PassengerType.INFANT, cabinFare)
  );
}

// What one segment (one flight) needs for pricing: the chosen cabin's fare
// and maxKgPerBag, and the airline's extra-bag policy (FLT-08).
export interface SegmentPricing {
  cabinFare: number;
  maxKgPerBag: number;
  extraBagPrice: number | null;
  maxExtraBags: number;
}

export interface PassengerForPricing {
  type: PassengerType;
  extraBags?: { weightKg: number }[];
}

export interface PassengerPrice {
  type: PassengerType;
  fare: number;
  extraBags: number;
  baggageFee: number;
}

export interface SegmentPrice {
  passengers: PassengerPrice[];
  fares: number;
  baggageFees: number;
  subtotal: number;
}

export interface PriceBreakdown {
  currency: 'USD';
  segments: SegmentPrice[];
  fares: number;
  baggageFees: number;
  total: number;
}

// FLT-19: extra bags per passenger, up to the airline's maxExtraBags, each up
// to the cabin's maxKgPerBag. The bags travel on every segment, so they are
// checked against each one.
export function assertExtraBags(
  passengers: PassengerForPricing[],
  segment: SegmentPricing,
): void {
  passengers.forEach((p, i) => {
    const bags = p.extraBags ?? [];
    const field = `passengers.${i}.extraBags`;
    if (bags.length === 0) return;
    if (segment.extraBagPrice === null) {
      throw fieldError(field, 'This airline does not sell extra bags');
    }
    if (bags.length > segment.maxExtraBags) {
      throw fieldError(
        field,
        `At most ${segment.maxExtraBags} extra bag(s) per passenger`,
      );
    }
    bags.forEach((bag, j) => {
      if (bag.weightKg > segment.maxKgPerBag) {
        throw fieldError(
          `${field}.${j}.weightKg`,
          `Each bag can weigh at most ${segment.maxKgPerBag} kg`,
        );
      }
    });
  });
}

// FLT-12, FLT-19, FLT-21: the one price calculation. The summary (FLT-21),
// the hold's price snapshot (FLT-22) and the Stripe amount all come from
// here, so they can never differ. Baggage fee = extra bags x extraBagPrice,
// per segment.
export function priceBooking(
  segments: SegmentPricing[],
  passengers: PassengerForPricing[],
): PriceBreakdown {
  const priced = segments.map((segment): SegmentPrice => {
    assertExtraBags(passengers, segment);
    const rows = passengers.map((p): PassengerPrice => {
      const extraBags = p.extraBags?.length ?? 0;
      return {
        type: p.type,
        fare: fareFor(p.type, segment.cabinFare),
        extraBags,
        baggageFee: extraBags * (segment.extraBagPrice ?? 0),
      };
    });
    const fares = sum(rows.map((r) => r.fare));
    const baggageFees = sum(rows.map((r) => r.baggageFee));
    return {
      passengers: rows,
      fares,
      baggageFees,
      subtotal: fares + baggageFees,
    };
  });
  const fares = sum(priced.map((s) => s.fares));
  const baggageFees = sum(priced.map((s) => s.baggageFees));
  return {
    currency: 'USD',
    segments: priced,
    fares,
    baggageFees,
    total: fares + baggageFees,
  };
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
