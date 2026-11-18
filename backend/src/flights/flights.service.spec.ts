import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { Role } from '../common/enums/role.enum';
import { AuthUser } from '../common/types/auth-user.type';
import { CreateFlightDto } from './dto/create-flight.dto';
import { FlightsService } from './flights.service';
import { CabinCategory, FlightStatus } from './schemas/flight.schema';

// FLT-03, FLT-04, GEN-06 with mocked models (no database).
const AIRLINE = new Types.ObjectId().toHexString();
const OTHER_AIRLINE = new Types.ObjectId().toHexString();
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

// A date about a year ahead, so "in the past" never triggers by accident.
const YEAR = new Date().getUTCFullYear() + 1;
const body = (over: Partial<CreateFlightDto> = {}): CreateFlightDto => ({
  flightNumber: 'NP101',
  from: 'CAI',
  to: 'DXB',
  departureLocal: `${YEAR}-12-01T14:30`,
  arrivalLocal: `${YEAR}-12-01T18:45`,
  ...over,
});

function setup(stored: any = null) {
  const flights = {
    // Like Mongoose, fill the schema defaults (status Scheduled, no cabins).
    create: jest.fn(async (doc: any) => ({
      toObject: () => ({
        _id: new Types.ObjectId(),
        status: FlightStatus.SCHEDULED,
        cabins: [],
        ...doc,
      }),
    })),
    findById: jest.fn(() => ({ lean: async () => stored })),
    findOneAndUpdate: jest.fn<any, [any, any, any]>(() => ({
      lean: async () =>
        stored && {
          ...stored,
          cabins: [
            {
              _id: new Types.ObjectId(),
              category: CabinCategory.ECONOMY,
              totalSeats: 150,
              bookedSeats: 0,
              heldSeats: 0,
              price: 25000,
              freeBags: 1,
              maxKgPerBag: 23,
            },
          ],
        },
    })),
  };
  const airportModel = {
    find: jest.fn((q: any) => ({
      lean: async () => q._id.$in.map((c: string) => AIRPORTS[c]),
    })),
  };
  const airports = {
    assertAirportExists: jest.fn(async (code: string) => {
      if (!AIRPORTS[code]) throw new BadRequestException('Unknown airport');
      return AIRPORTS[code];
    }),
  };
  const airlines = { get: jest.fn(async () => ({ _id: AIRLINE })) };
  const service = new FlightsService(
    flights as any,
    airportModel as any,
    airports as any,
    airlines as any,
  );
  return { service, flights };
}

describe('FlightsService.create (FLT-03, GEN-06)', () => {
  it('stores UTC times and shows each in its airport time zone', async () => {
    const { service, flights } = setup();
    const view = await service.create(moderator, body());

    const saved = flights.create.mock.calls[0][0];
    // Cairo is UTC+2 and Dubai UTC+4 in December.
    expect(saved.departureAt.toISOString()).toBe(`${YEAR}-12-01T12:30:00.000Z`);
    expect(saved.arrivalAt.toISOString()).toBe(`${YEAR}-12-01T14:45:00.000Z`);
    expect(saved.departureDate).toBe(`${YEAR}-12-01`);
    expect(String(saved.airlineId)).toBe(AIRLINE);

    expect(view.departure).toEqual({
      utc: `${YEAR}-12-01T12:30:00.000Z`,
      local: `${YEAR}-12-01T14:30`,
      utcOffset: '+02:00',
      timeZone: 'Africa/Cairo',
    });
    expect(view.arrival.local).toBe(`${YEAR}-12-01T18:45`);
    expect(view.arrival.timeZone).toBe('Asia/Dubai');
    expect(view.durationMinutes).toBe(135);
    expect(view.status).toBe(FlightStatus.SCHEDULED);
    expect(view.bookable).toBe(true);
  });

  it('shows a CAI to FRA flight in Cairo and Berlin time', async () => {
    const { service } = setup();
    const view = await service.create(
      moderator,
      body({
        to: 'FRA',
        departureLocal: `${YEAR}-07-01T08:00`,
        arrivalLocal: `${YEAR}-07-01T11:30`,
      }),
    );
    expect(view.departure.timeZone).toBe('Africa/Cairo');
    expect(view.arrival.timeZone).toBe('Europe/Berlin');
    expect(view.arrival.local).toBe(`${YEAR}-07-01T11:30`);
  });

  it('takes the airline from the session, never from the body', async () => {
    const { service, flights } = setup();
    const sneaky = { ...body(), airlineId: OTHER_AIRLINE } as CreateFlightDto;
    await service.create(moderator, sneaky);
    expect(String(flights.create.mock.calls[0][0].airlineId)).toBe(AIRLINE);
  });

  it('rejects the same airport twice with 400', async () => {
    const { service } = setup();
    await expect(
      service.create(moderator, body({ to: 'CAI' })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an unknown airport with 400', async () => {
    const { service } = setup();
    await expect(
      service.create(moderator, body({ to: 'XXX' })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('compares arrival and departure in UTC, across time zones', async () => {
    const { service } = setup();
    // 15:00 in Cairo is 13:00 UTC; 16:30 in Dubai is 12:30 UTC: earlier.
    await expect(
      service.create(
        moderator,
        body({
          departureLocal: `${YEAR}-12-01T15:00`,
          arrivalLocal: `${YEAR}-12-01T16:30`,
        }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects a departure in the past with 400', async () => {
    const { service } = setup();
    await expect(
      service.create(
        moderator,
        body({
          departureLocal: '2020-01-01T10:00',
          arrivalLocal: '2020-01-01T14:00',
        }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('answers 409 for the same number on the same day', async () => {
    const { service, flights } = setup();
    flights.create.mockRejectedValueOnce(
      Object.assign(new Error('dup'), { code: 11000 }),
    );
    await expect(service.create(moderator, body())).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('refuses a user without an assigned airline', async () => {
    const { service } = setup();
    const noAirline = { ...moderator, assignedProviderId: null };
    await expect(service.create(noAirline, body())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('FlightsService.addCabin (FLT-04)', () => {
  const flight = () => ({
    _id: new Types.ObjectId(),
    airlineId: new Types.ObjectId(AIRLINE),
    flightNumber: 'NP101',
    from: 'CAI',
    to: 'DXB',
    departureAt: new Date(Date.now() + 86_400_000),
    arrivalAt: new Date(Date.now() + 90_000_000),
    departureDate: '2030-01-01',
    status: FlightStatus.SCHEDULED,
    cabins: [],
  });
  const economy = {
    category: CabinCategory.ECONOMY,
    totalSeats: 150,
    price: 25000,
    freeBags: 1,
    maxKgPerBag: 23,
  };

  it('adds a cabin with 0 booked and 0 held seats', async () => {
    const { service, flights } = setup(flight());
    const view = await service.addCabin(moderator, 'id', economy);
    const [filter, update] = flights.findOneAndUpdate.mock.calls[0];
    expect(filter['cabins.category']).toEqual({ $ne: CabinCategory.ECONOMY });
    expect(update.$push.cabins).toMatchObject({ bookedSeats: 0, heldSeats: 0 });
    expect(view.cabins[0].availableSeats).toBe(150);
  });

  it('answers 409 when the category already exists', async () => {
    const { service, flights } = setup(flight());
    flights.findOneAndUpdate.mockReturnValueOnce({ lean: async () => null });
    await expect(
      service.addCabin(moderator, 'id', economy),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("answers 403 to another airline's moderator", async () => {
    const { service, flights } = setup(flight());
    const other = { ...moderator, assignedProviderId: OTHER_AIRLINE };
    await expect(service.addCabin(other, 'id', economy)).rejects.toThrow(
      ForbiddenException,
    );
    expect(flights.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown flight', async () => {
    const { service } = setup(null);
    await expect(
      service.addCabin(moderator, 'id', economy),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses to change a Cancelled or departed flight', async () => {
    const cancelled = { ...flight(), status: FlightStatus.CANCELLED };
    const { service } = setup(cancelled);
    await expect(
      service.addCabin(moderator, 'id', economy),
    ).rejects.toBeInstanceOf(BadRequestException);

    const gone = { ...flight(), departureAt: new Date(Date.now() - 60_000) };
    const s2 = setup(gone);
    await expect(
      s2.service.addCabin(moderator, 'id', economy),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
