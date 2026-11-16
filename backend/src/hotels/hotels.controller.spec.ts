import { ForbiddenException } from '@nestjs/common';
import { Role } from '../common/enums/role.enum';
import { AuthUser } from '../common/types/auth-user.type';
import { HotelsController } from './hotels.controller';
import { RoomsController } from './rooms.controller';

// Only the hotel's own moderator edits it (HTL-01, HTL-03, HTL-04, HTL-09,
// HTL-10). The hotel id comes from the route.
describe('hotel controllers: ownership', () => {
  const MINE = '6735a1f4c1a2b3c4d5e6f801';
  const OTHER = '6735a1f4c1a2b3c4d5e6f802';
  const ROOM = '6735a1f4c1a2b3c4d5e6f901';
  const moderator: AuthUser = {
    id: 'u1',
    role: Role.HOTEL_MODERATOR,
    assignedProviderId: MINE,
  };
  const room = {
    name: '101',
    type: 'Double',
    beds: 2,
    maxOccupancy: 2,
    pricePerNight: 100,
  };
  const range = { from: '2026-12-01', to: '2027-01-01' };
  const policies = {
    checkInTime: '14:00',
    checkOutTime: '12:00',
    cancellationTiers: [],
  };

  function setup() {
    const hotels = {
      update: jest.fn(async () => ({})),
      setPolicies: jest.fn(async () => ({})),
    };
    const rooms = {
      create: jest.fn(async () => ({})),
      addAvailability: jest.fn(async () => ({})),
    };
    return {
      hotels,
      rooms,
      hotelsController: new HotelsController(hotels as any),
      roomsController: new RoomsController(rooms as any),
    };
  }

  it("lets the hotel's moderator use every route of their hotel", async () => {
    const { hotelsController, roomsController, hotels, rooms } = setup();
    await hotelsController.update(moderator, MINE, { name: 'TEST New' });
    await hotelsController.setPolicies(moderator, MINE, policies);
    await roomsController.create(moderator, MINE, room);
    await roomsController.addAvailability(moderator, MINE, ROOM, range);
    expect(hotels.update).toHaveBeenCalledWith(MINE, { name: 'TEST New' });
    expect(hotels.setPolicies).toHaveBeenCalledWith(MINE, policies);
    expect(rooms.create).toHaveBeenCalledWith(MINE, room);
    expect(rooms.addAvailability).toHaveBeenCalledWith(MINE, ROOM, range);
  });

  it("refuses another hotel's moderator with 403, before any work", () => {
    const { hotelsController, roomsController, hotels, rooms } = setup();
    const calls = [
      () => hotelsController.update(moderator, OTHER, { name: 'X' }),
      () => hotelsController.setPolicies(moderator, OTHER, policies),
      () => roomsController.create(moderator, OTHER, room),
      () => roomsController.addAvailability(moderator, OTHER, ROOM, range),
    ];
    for (const call of calls) expect(call).toThrow(ForbiddenException);
    expect(hotels.update).not.toHaveBeenCalled();
    expect(hotels.setPolicies).not.toHaveBeenCalled();
    expect(rooms.create).not.toHaveBeenCalled();
    expect(rooms.addAvailability).not.toHaveBeenCalled();
  });

  it('refuses an airline moderator and an admin with 403', () => {
    const { roomsController } = setup();
    for (const role of [Role.AIRLINE_MODERATOR, Role.ADMIN]) {
      const user = { ...moderator, role };
      expect(() => roomsController.create(user, MINE, room)).toThrow(
        ForbiddenException,
      );
    }
  });
});
