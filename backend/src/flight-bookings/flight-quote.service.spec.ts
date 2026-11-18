import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { FlightsService } from '../flights/flights.service';
import { CabinCategory, FlightStatus } from '../flights/schemas/flight.schema';
import { FlightQuoteDto, PassengerDto } from './dto/flight-quote.dto';
import { PassengerType } from './flight-booking.rules';
import { FlightQuoteService } from './flight-quote.service';

// FLT-19 and FLT-21 with mocked models; toViews() is Hazem's real one.
describe('FlightQuoteService (FLT-19, FLT-21)', () => {
  const AIRLINE = new Types.ObjectId();
  const OUT = new Types.ObjectId();
  const BACK = new Types.ObjectId();

  function flight(id: Types.ObjectId, extra: object = {}) {
    const outbound = id === OUT;
    return {
      _id: id,
      airlineId: AIRLINE,
      flightNumber: outbound ? 'NP101' : 'NP102',
      from: outbound ? 'CAI' : 'DXB',
      to: outbound ? 'DXB' : 'CAI',
      departureAt: new Date(
        outbound ? '2099-12-01T22:30:00Z' : '2099-12-09T10:00:00Z',
      ),
      arrivalAt: new Date(
        outbound ? '2099-12-02T02:30:00Z' : '2099-12-09T14:00:00Z',
      ),
      departureDate: outbound ? '2099-12-02' : '2099-12-09',
      status: FlightStatus.SCHEDULED,
      cabins: [
        {
          _id: new Types.ObjectId(),
          category: CabinCategory.ECONOMY,
          totalSeats: 10,
          bookedSeats: 5,
          heldSeats: 2,
          price: outbound ? 20000 : 30000,
          freeBags: 1,
          maxKgPerBag: 23,
        },
      ],
      ...extra,
    };
  }
  const airline = {
    _id: AIRLINE,
    name: 'Nile Air',
    code: 'NP',
    logo: null,
    isActive: true,
    extraBagPrice: 5000,
    maxExtraBags: 2,
  };

  function setup(
    flights: Record<string, object | null> = {
      [String(OUT)]: flight(OUT),
      [String(BACK)]: flight(BACK),
    },
    airlineDoc: object = airline,
  ) {
    const flightModel = {
      findById: jest.fn((id: string) => ({
        lean: async () => flights[String(id)] ?? null,
      })),
    };
    const airlineModel = { find: () => ({ lean: async () => [airlineDoc] }) };
    const airportModel = {
      find: () => ({
        lean: async () => [
          {
            _id: 'CAI',
            name: 'Cairo',
            cityId: 'cairo',
            timeZone: 'Africa/Cairo',
          },
          {
            _id: 'DXB',
            name: 'Dubai',
            cityId: 'dubai',
            timeZone: 'Asia/Dubai',
          },
        ],
      }),
    };
    const views = new FlightsService(
      {} as any,
      airportModel as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return new FlightQuoteService(
      flightModel as any,
      airlineModel as any,
      views,
    );
  }

  const adult = (extra: Partial<PassengerDto> = {}): PassengerDto => ({
    type: PassengerType.ADULT,
    fullName: 'Sara Ali',
    dateOfBirth: '1990-01-01',
    passportNumber: 'A1234567',
    ...extra,
  });
  const infant: PassengerDto = {
    type: PassengerType.INFANT,
    fullName: 'Baby Ali',
    dateOfBirth: '2099-01-15',
    passportNumber: 'B1234567',
  };
  const body = (extra: Partial<FlightQuoteDto> = {}): FlightQuoteDto => ({
    outboundFlightId: String(OUT),
    cabin: CabinCategory.ECONOMY,
    passengers: [adult(), adult(), infant],
    ...extra,
  });

  it('summarises 2 adults + 1 infant in a 200 USD cabin: 420 USD', async () => {
    const q = await setup().quote(body());
    expect(q.seats).toBe(2);
    expect(q.counts).toEqual({ adults: 2, children: 0, infants: 1 });
    expect(q.price).toMatchObject({
      fares: 42000,
      baggageFees: 0,
      total: 42000,
      currency: 'USD',
    });
    expect(q.price.segments[0].passengers.map((p) => p.fare)).toEqual([
      20000, 20000, 2000,
    ]);
    expect(q.segments[0]).toMatchObject({
      flightNumber: 'NP101',
      airline: { name: 'Nile Air', code: 'NP' },
      cabin: CabinCategory.ECONOMY,
      cabinFare: 20000,
      freeBags: 1,
      departure: { local: '2099-12-02T00:30', timeZone: 'Africa/Cairo' },
    });
  });

  it('adds the baggage fee: 1 extra bag x 50 USD', async () => {
    const q = await setup().quote(
      body({ passengers: [adult({ extraBags: [{ weightKg: 20 }] })] }),
    );
    expect(q.price).toMatchObject({
      fares: 20000,
      baggageFees: 5000,
      total: 25000,
    });
  });

  it('prices a round trip on both flights, bags on each', async () => {
    const q = await setup().quote(
      body({
        returnFlightId: String(BACK),
        passengers: [adult({ extraBags: [{ weightKg: 20 }] })],
      }),
    );
    expect(q.segments.map((s) => s.flightNumber)).toEqual(['NP101', 'NP102']);
    expect(q.price.segments.map((s) => s.subtotal)).toEqual([25000, 35000]);
    expect(q.price.total).toBe(60000);
  });

  it('rejects a "child" whose date of birth makes them 13', async () => {
    const err = await setup()
      .quote(
        body({
          passengers: [
            adult(),
            {
              ...adult(),
              type: PassengerType.CHILD,
              dateOfBirth: '2086-06-01',
            },
          ],
        }),
      )
      .catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse().details).toHaveProperty([
      'passengers.1.dateOfBirth',
    ]);
  });

  it('rejects more extra bags than allowed and a bag over maxKgPerBag', async () => {
    const service = setup();
    await expect(
      service.quote(
        body({
          passengers: [
            adult({
              extraBags: [{ weightKg: 5 }, { weightKg: 5 }, { weightKg: 5 }],
            }),
          ],
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.quote(
        body({ passengers: [adult({ extraBags: [{ weightKg: 24 }] })] }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects extra bags when the airline sells none', async () => {
    await expect(
      setup(undefined, {
        ...airline,
        extraBagPrice: null,
        maxExtraBags: 0,
      }).quote(
        body({ passengers: [adult({ extraBags: [{ weightKg: 10 }] })] }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a cabin the flight does not have (400)', async () => {
    const err = await setup()
      .quote(body({ cabin: CabinCategory.FIRST }))
      .catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.getResponse().details).toHaveProperty('cabin');
  });

  it('answers 409 when the cabin has fewer free seats than needed', async () => {
    // 10 - 5 booked - 2 held = 3 free; 4 adults need 4.
    await expect(
      setup().quote(body({ passengers: [adult(), adult(), adult(), adult()] })),
    ).rejects.toThrow('Only 3 Economy seats left on flight NP101');
  });

  it('answers 404 for unknown and Cancelled flights and inactive airlines', async () => {
    await expect(
      setup().quote(body({ outboundFlightId: String(new Types.ObjectId()) })),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      setup({
        [String(OUT)]: flight(OUT, { status: FlightStatus.CANCELLED }),
      }).quote(body()),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      setup(undefined, { ...airline, isActive: false }).quote(body()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('answers 409 for a flight that has departed', async () => {
    await expect(
      setup({
        [String(OUT)]: flight(OUT, {
          departureAt: new Date('2020-01-01T08:00:00Z'),
          arrivalAt: new Date('2020-01-01T12:00:00Z'),
          departureDate: '2020-01-01',
        }),
      }).quote(body()),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a return flight on the wrong route or before landing', async () => {
    const wrongRoute = setup({
      [String(OUT)]: flight(OUT),
      [String(BACK)]: flight(BACK, { from: 'DXB', to: 'JED' }),
    });
    await expect(
      wrongRoute.quote(body({ returnFlightId: String(BACK) })),
    ).rejects.toThrow('Validation failed');
    const tooEarly = setup({
      [String(OUT)]: flight(OUT),
      [String(BACK)]: flight(BACK, {
        departureAt: new Date('2099-12-02T01:00:00Z'),
        arrivalAt: new Date('2099-12-02T05:00:00Z'),
      }),
    });
    await expect(
      tooEarly.quote(body({ returnFlightId: String(BACK) })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
