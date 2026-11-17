import { ConflictException } from '@nestjs/common';
import { randomInt } from 'crypto';

// GEN-11: the lifecycle of flight bookings and hotel reservations.
//
//   PendingPayment ──► Confirmed ──► Completed
//         │                 │
//         ▼                 ▼
//      Expired          Cancelled
//
// PendingPayment is the 10-minute hold (with expiresAt). Expired: the hold
// ran out before payment. Cancelled: by the user or the provider.
// Completed: after the last flight lands or after check-out.
export enum BookingStatus {
  PENDING_PAYMENT = 'PendingPayment',
  CONFIRMED = 'Confirmed',
  COMPLETED = 'Completed',
  EXPIRED = 'Expired',
  CANCELLED = 'Cancelled',
}

// The only allowed changes. Completed, Expired and Cancelled are final.
export const BOOKING_TRANSITIONS: Readonly<
  Record<BookingStatus, readonly BookingStatus[]>
> = {
  [BookingStatus.PENDING_PAYMENT]: [
    BookingStatus.CONFIRMED,
    BookingStatus.EXPIRED,
  ],
  [BookingStatus.CONFIRMED]: [BookingStatus.COMPLETED, BookingStatus.CANCELLED],
  [BookingStatus.COMPLETED]: [],
  [BookingStatus.EXPIRED]: [],
  [BookingStatus.CANCELLED]: [],
};

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return BOOKING_TRANSITIONS[from]?.includes(to) ?? false;
}

// Throws 409 for any other change, e.g. cancelling an Expired booking.
//
// Check it before the update, and also put the old status in the update
// filter, so two requests at the same moment cannot both change it (for
// example two Stripe webhook deliveries):
//   assertTransition(booking.status, BookingStatus.CONFIRMED);
//   const res = await this.bookings.updateOne(
//     { _id: booking._id, status: BookingStatus.PENDING_PAYMENT },
//     { $set: { status: BookingStatus.CONFIRMED } });
//   if (res.modifiedCount === 0) { /* someone else changed it first */ }
export function assertTransition(from: BookingStatus, to: BookingStatus): void {
  if (!canTransition(from, to)) {
    throw new ConflictException(
      `A booking cannot change from ${from} to ${to}`,
    );
  }
}

export type BookingReferencePrefix = 'FL' | 'HT';

// FL- for flights, HT- for hotels, then 8 uppercase letters or digits:
// FL-7K2M9QX4 (conventions.md). 36^8 ≈ 2.8 trillion combinations, so a clash
// is very unlikely; the unique index on `reference` catches the rare one
// (409), and the caller may simply generate a new one and retry.
export const BOOKING_REFERENCE = /^(FL|HT)-[A-Z0-9]{8}$/;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export function generateBookingReference(
  prefix: BookingReferencePrefix,
): string {
  let code = '';
  for (let i = 0; i < 8; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return `${prefix}-${code}`;
}
