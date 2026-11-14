import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { Role } from '../enums/role.enum';
import { AuthUser } from '../types/auth-user.type';
import { assertOwner, isOwner } from './ownership';

// ACC-11: bookings and private itineraries belong to one user; anyone else
// gets 404 so the resource's existence is not revealed.
describe('assertOwner', () => {
  const ownerId = new Types.ObjectId();
  const owner: AuthUser = {
    id: ownerId.toHexString(),
    role: Role.USER,
    assignedProviderId: null,
  };
  const other: AuthUser = {
    id: new Types.ObjectId().toHexString(),
    role: Role.USER,
    assignedProviderId: null,
  };

  it('lets the owner pass', () => {
    expect(() => assertOwner(ownerId.toHexString(), owner)).not.toThrow();
  });

  it('compares an ObjectId with the string id from the session', () => {
    expect(() => assertOwner(ownerId, owner)).not.toThrow();
    expect(() => assertOwner(new Types.ObjectId(ownerId), owner)).not.toThrow();
  });

  it('answers 404 to another user', () => {
    expect(() => assertOwner(ownerId, other)).toThrow(NotFoundException);
  });

  it('uses the message given, so the 404 looks like a missing resource', () => {
    expect(() => assertOwner(ownerId, other, 'Booking not found')).toThrow(
      'Booking not found',
    );
  });

  it.each([Role.ADMIN, Role.AIRLINE_MODERATOR, Role.HOTEL_MODERATOR])(
    'gives a %s no exception (they use their own routes)',
    (role) => {
      const staff: AuthUser = { ...other, role, assignedProviderId: null };
      expect(() => assertOwner(ownerId, staff)).toThrow(NotFoundException);
    },
  );

  it.each([null, undefined, ''])(
    'answers 404 when the resource has no owner (%p)',
    (missing) => {
      expect(() => assertOwner(missing, owner)).toThrow(NotFoundException);
    },
  );

  it('answers 404 when there is no user', () => {
    const nobody = undefined as unknown as AuthUser;
    expect(() => assertOwner(ownerId, nobody)).toThrow(NotFoundException);
  });
});

describe('isOwner', () => {
  const id = new Types.ObjectId();
  const user: AuthUser = {
    id: id.toHexString(),
    role: Role.USER,
    assignedProviderId: null,
  };

  it('is true for the owner and false for anyone else', () => {
    expect(isOwner(id, user)).toBe(true);
    expect(isOwner(new Types.ObjectId(), user)).toBe(false);
    expect(isOwner(null, user)).toBe(false);
  });
});
