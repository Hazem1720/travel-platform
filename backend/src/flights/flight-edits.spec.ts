import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { Role } from '../common/enums/role.enum';
import { AuthUser } from '../common/types/auth-user.type';
import { NotificationType } from '../notifications/schemas/notification.schema';
import { FlightsService } from './flights.service';
import { CabinCategory, FlightStatus } from './schemas/flight.schema';

// FLT-05: edits of Scheduled flights and their cabins.
const AIRLINE = new Types.ObjectId().toHexString();
const CABIN = new Types.ObjectId();
const AIRPORTS: Record<string, any> = {
  CAI: { _id: 'CAI', name: 'Cairo', cityId: 'cairo', timeZone: 'Africa/Cairo' },
  DXB: { _id: 'DXB', name: 'Dubai', cityId: 'dubai', timeZone: 'Asia/Dubai' },
  FRA: {
    _id: 'FRA',
    name: 'Frankfurt',
    cityId: 'frankfurt',
    timeZone: 'Europe/Berlin',
  },
};
const moderator: AuthUser = {
  id: new Types.ObjectId().toHexString(),
  role: Role.AIRLINE_MODERATOR,
  assignedProviderId: AIRLINE,
};
const YEAR = new Date().getUTCFullYear() + 1;

const flight = (over: any = {}, seats = { booked: 0, held: 0 }) => ({
  _id: new Types.ObjectId(),
  airlineId: new Types.ObjectId(AIRLINE),
  flightNumber: 'NP101',
  from: 'CAI',
  to: 'DXB',
  departureAt: new Date(`${YEAR}-12-01T12:30:00Z`),
  arrivalAt: new Date(`${YEAR}-12-01T14:45:00Z`),
  departureDate: `${YEAR}-12-01`,
  status: FlightStatus.SCHEDULED,
  cabins: [
    {
      _id: CABIN,
      category: CabinCategory.ECONOMY,
      totalSeats: 20,
      bookedSeats: seats.booked,
      heldSeats: seats.held,
      price: 25000,
      freeBags: 1,
      maxKgPerBag: 23,
    },
  ],
  ...over,
});

function setup(stored: any, reader?: any, updated: any = 'same') {
  const result = updated === 'same' ? stored : updated;
  const flights = {
    findById: jest.fn(() => ({ lean: async () => stored })),
    findOneAndUpdate: jest.fn<any, [any, any, any]>(() => ({
      lean: async () => result,
    })),
  };
  const airportModel = {
    find: jest.fn((q: any) => ({
      lean: async () => q._id.$in.map((c: string) => AIRPORTS[c]),
    })),
  };
  const airports = {
    assertAirportExists: jest.fn(async (code: string) => AIRPORTS[code]),
  };
  const notifications = { create: jest.fn(async () => ({})) };
  const service = new FlightsService(
    flights as any,
    airportModel as any,
    airports as any,
    {} as any,
    notifications as any,
    reader,
  );
  return { service, flights, notifications };
}

describe('FlightsService.update (FLT-05)', () => {
  it('changes the times and notifies only Confirmed passengers', async () => {
    const userA = new Types.ObjectId();
    const reader = {
      hasBookings: jest.fn(async () => true),
      confirmedUserIds: jest.fn(async () => [userA, String(userA)]),
    };
    const f = flight();
    const moved = {
      ...f,
      departureAt: new Date(`${YEAR}-12-01T14:00:00Z`),
      arrivalAt: new Date(`${YEAR}-12-01T16:15:00Z`),
    };
    const { service, flights, notifications } = setup(f, reader, moved);
    await service.update(moderator, 'id', {
      departureLocal: `${YEAR}-12-01T16:00`,
      arrivalLocal: `${YEAR}-12-01T20:15`,
    });

    const [filter, update] = flights.findOneAndUpdate.mock.calls[0];
    expect(filter.status).toBe(FlightStatus.SCHEDULED);
    expect(update.$set.departureAt.toISOString()).toBe(
      `${YEAR}-12-01T14:00:00.000Z`,
    );
    // The same user twice gets one notification.
    expect(notifications.create).toHaveBeenCalledTimes(1);
    expect(notifications.create.mock.calls[0]).toEqual([
      String(userA),
      NotificationType.FLIGHT_SCHEDULE_CHANGED,
      expect.stringContaining('NP101'),
      expect.objectContaining({ flightNumber: 'NP101' }),
    ]);
  });

  it('sends nothing when only the airports change', async () => {
    const reader = {
      hasBookings: jest.fn(async () => false),
      confirmedUserIds: jest.fn(async () => [new Types.ObjectId()]),
    };
    const { service, notifications } = setup(flight(), reader);
    await service.update(moderator, 'id', { to: 'FRA' });
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('refuses to change airports once the flight has a booking', async () => {
    const reader = {
      hasBookings: jest.fn(async () => true),
      confirmedUserIds: jest.fn(async () => []),
    };
    const { service, flights } = setup(flight(), reader);
    await expect(
      service.update(moderator, 'id', { to: 'FRA' }),
    ).rejects.toThrow('Airports cannot be changed');
    expect(flights.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('falls back to held or booked seats to lock airports', async () => {
    const { service } = setup(flight({}, { booked: 0, held: 1 }));
    await expect(
      service.update(moderator, 'id', { to: 'FRA' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([FlightStatus.CANCELLED, FlightStatus.DEPARTED])(
    'refuses to edit a %s flight',
    async (status) => {
      const { service } = setup(flight({ status }));
      await expect(
        service.update(moderator, 'id', {
          departureLocal: `${YEAR}-12-01T16:00`,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('keeps the FLT-03 rules: arrival after departure', async () => {
    const { service } = setup(flight());
    await expect(
      service.update(moderator, 'id', { arrivalLocal: `${YEAR}-12-01T10:00` }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("refuses another airline's moderator with 403", async () => {
    const { service } = setup(flight());
    const other = {
      ...moderator,
      assignedProviderId: new Types.ObjectId().toHexString(),
    };
    await expect(
      service.update(other, 'id', { to: 'FRA' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('FlightsService.updateCabin (FLT-05)', () => {
  it('changes the price with no seat condition', async () => {
    const { service, flights } = setup(flight());
    const price = { price: 27000 };
    await service.updateCabin(moderator, 'id', String(CABIN), price);
    const [filter, update, options] = flights.findOneAndUpdate.mock.calls[0];
    expect(filter.$expr).toBeUndefined();
    expect(update).toEqual({ $set: { 'cabins.$[c].price': 27000 } });
    expect(options.arrayFilters).toEqual([{ 'c._id': CABIN }]);
  });

  it('checks booked + held seats inside the update itself', async () => {
    const { service, flights } = setup(flight({}, { booked: 5, held: 3 }));
    await service.updateCabin(moderator, 'id', String(CABIN), {
      totalSeats: 8,
    });
    const [filter] = flights.findOneAndUpdate.mock.calls[0];
    expect(JSON.stringify(filter.$expr)).toContain('"$lte"');
  });

  it('answers 409 when the seats would go below booked + held', async () => {
    const full = flight({}, { booked: 5, held: 3 });
    const { service } = setup(full, undefined, null);
    await expect(
      service.updateCabin(moderator, 'id', String(CABIN), { totalSeats: 7 }),
    ).rejects.toThrow(ConflictException);
    await expect(
      service.updateCabin(moderator, 'id', String(CABIN), { totalSeats: 7 }),
    ).rejects.toThrow('below the 8 already booked or held');
  });

  it('answers 404 for an unknown cabin', async () => {
    const { service } = setup(flight());
    await expect(
      service.updateCabin(moderator, 'id', String(new Types.ObjectId()), {
        price: 1,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses an empty change and a departed flight', async () => {
    const { service } = setup(flight());
    await expect(
      service.updateCabin(moderator, 'id', String(CABIN), {}),
    ).rejects.toBeInstanceOf(BadRequestException);

    const past = flight({ departureAt: new Date(Date.now() - 60_000) });
    const s2 = setup(past);
    await expect(
      s2.service.updateCabin(moderator, 'id', String(CABIN), { price: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
