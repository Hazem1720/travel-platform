import { ForbiddenException } from '@nestjs/common';
import { Role } from '../enums/role.enum';
import { AuthUser } from '../types/auth-user.type';

// Moderators may manage only their own airline or hotel.
// expectedRole: Role.AIRLINE_MODERATOR for airline routes, Role.HOTEL_MODERATOR for hotel routes.
export function assertOwnsProvider(
  user: AuthUser,
  expectedRole: Role.AIRLINE_MODERATOR | Role.HOTEL_MODERATOR,
  providerId: string,
): void {
  if (
    user.role !== expectedRole ||
    !user.assignedProviderId ||
    user.assignedProviderId !== String(providerId)
  ) {
    throw new ForbiddenException('You can only manage your assigned provider');
  }
}