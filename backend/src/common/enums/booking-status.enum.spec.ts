import { ConflictException } from '@nestjs/common';
import {
  assertTransition,
  BOOKING_REFERENCE,
  BookingStatus,
  canTransition,
  generateBookingReference,
} from './booking-status.enum';

const {
  PENDING_PAYMENT: PENDING,
  CONFIRMED,
  COMPLETED,
  EXPIRED,
  CANCELLED,
} = BookingStatus;

// GEN-11: PendingPayment -> Confirmed -> Completed, plus
// PendingPayment -> Expired and Confirmed -> Cancelled. Nothing else.
describe('booking lifecycle (GEN-11)', () => {
  const allowed: [BookingStatus, BookingStatus][] = [
    [PENDING, CONFIRMED],
    [PENDING, EXPIRED],
    [CONFIRMED, COMPLETED],
    [CONFIRMED, CANCELLED],
  ];

  it.each(allowed)('allows %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  const all = Object.values(BookingStatus);
  const forbidden = all
    .flatMap((from) =>
      all.map((to) => [from, to] as [BookingStatus, BookingStatus]),
    )
    .filter(([f, t]) => !allowed.some(([a, b]) => a === f && b === t));

  it('forbids every other change (21 of the 25 pairs)', () => {
    expect(forbidden).toHaveLength(21);
  });

  it.each(forbidden)('forbids %s -> %s with 409', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertTransition(from, to)).toThrow(ConflictException);
  });

  it('explains the refused change', () => {
    expect(() => assertTransition(CANCELLED, CONFIRMED)).toThrow(
      'A booking cannot change from Cancelled to Confirmed',
    );
  });

  it('stores the statuses with the names from conventions.md', () => {
    expect(all).toEqual([
      'PendingPayment',
      'Confirmed',
      'Completed',
      'Expired',
      'Cancelled',
    ]);
  });
});

describe('generateBookingReference (GEN-11, FLT-23, HTL-17)', () => {
  it('makes FL- and HT- references with 8 uppercase letters or digits', () => {
    expect(generateBookingReference('FL')).toMatch(/^FL-[A-Z0-9]{8}$/);
    expect(generateBookingReference('HT')).toMatch(/^HT-[A-Z0-9]{8}$/);
    expect(BOOKING_REFERENCE.test(generateBookingReference('FL'))).toBe(true);
  });

  it('does not repeat in 10,000 references', () => {
    const refs = new Set(
      Array.from({ length: 10_000 }, () => generateBookingReference('FL')),
    );
    expect(refs.size).toBe(10_000);
  });
});
