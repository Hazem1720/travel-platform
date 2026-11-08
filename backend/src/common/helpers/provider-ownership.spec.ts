import { ForbiddenException } from '@nestjs/common';
import { Role } from '../enums/role.enum';
import { AuthUser } from '../types/auth-user.type';
import { assertOwnsProvider } from './provider-ownership';

// A moderator manages exactly one airline or hotel (ACC-13).
describe('assertOwnsProvider', () => {
  const airlineMod: AuthUser = {
    id: 'u1',
    role: Role.AIRLINE_MODERATOR,
    assignedProviderId: 'airline-1',
  };

  it('allows a moderator on their own provider', () => {
    expect(() =>
      assertOwnsProvider(airlineMod, Role.AIRLINE_MODERATOR, 'airline-1'),
    ).not.toThrow();
  });

  it('compares ids as strings (e.g. an ObjectId param)', () => {
    const objectIdLike = { toString: () => 'airline-1' } as unknown as string;
    expect(() =>
      assertOwnsProvider(airlineMod, Role.AIRLINE_MODERATOR, objectIdLike),
    ).not.toThrow();
  });

  it('rejects another provider', () => {
    expect(() =>
      assertOwnsProvider(airlineMod, Role.AIRLINE_MODERATOR, 'airline-2'),
    ).toThrow(ForbiddenException);
  });

  it('rejects the wrong kind of moderator', () => {
    const hotelMod = { ...airlineMod, role: Role.HOTEL_MODERATOR };
    expect(() => assertOwnsProvider(hotelMod, Role.AIRLINE_MODERATOR, 'airline-1')).toThrow(
      ForbiddenException,
    );
  });

  it('rejects a moderator with no assigned provider', () => {
    const unassigned = { ...airlineMod, assignedProviderId: null };
    expect(() =>
      assertOwnsProvider(unassigned, Role.AIRLINE_MODERATOR, 'airline-1'),
    ).toThrow(ForbiddenException);
  });

  it.each([Role.USER, Role.ADMIN])('rejects a %s', (role) => {
    expect(() =>
      assertOwnsProvider({ ...airlineMod, role }, Role.AIRLINE_MODERATOR, 'airline-1'),
    ).toThrow('You can only manage your assigned provider');
  });
});
