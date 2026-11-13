import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { AuthUser } from '../types/auth-user.type';

// ACC-11: only the owner may read or change their bookings and private
// itineraries. Anyone else gets 404, the same answer as for a resource that
// does not exist, so its existence is not revealed (conventions.md,
// "Ownership").
//
// There is no admin or moderator exception here on purpose: admins and
// moderators read bookings only through the routes made for that (ACC-17,
// FLT-29, HTL-22), never through the owner's routes.
//
// Call it on every read and write, after loading the resource:
//   const booking = await this.bookings.findById(id).lean();
//   if (!booking) throw new NotFoundException('Booking not found');
//   assertOwner(booking.userId, user, 'Booking not found');
export function assertOwner(
  resourceUserId: Types.ObjectId | string | null | undefined,
  user: AuthUser,
  notFoundMessage = 'Resource not found',
): void {
  if (!isOwner(resourceUserId, user)) {
    throw new NotFoundException(notFoundMessage);
  }
}

// True when the user owns the resource. Use it to build a query filter or to
// decide what to show, where throwing is not wanted.
export function isOwner(
  resourceUserId: Types.ObjectId | string | null | undefined,
  user: AuthUser,
): boolean {
  return (
    !!resourceUserId &&
    !!user?.id &&
    String(resourceUserId) === String(user.id)
  );
}
