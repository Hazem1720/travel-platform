import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { FlightsService } from '../flights/flights.service';
import { CabinCategory, FlightStatus } from '../flights/schemas/flight.schema';
import { FlightDetailsService } from './flight-details.service';

// FLT-17. toViews() is Hazem's real one (local times and seats), with the
// airport lookup mocked.
describe('FlightDetailsService (FLT-17)', () => {
  const AIRLINE = new Types.ObjectId();
  const FLIGHT = new Types.ObjectId();

  const baseFlight = {
    _id: FLIGHT,
    airlineId: AIRLINE,
    flightNumber: 'NP101',
    from: 'CAI',
    to: 'DXB',
    departureAt: new Date('2099-12-01T22:30:00Z'),
    arrivalAt: new Date('2099-12-02T02:30:00Z'),
    departureDate: '2099-12-02',
    status: FlightStatus.SCHEDULED,
    cabins: [
      {
        _id: new Types.ObjectId(),
        category: CabinCategory.ECONOMY,
        totalSeats: 150,
        bookedSeats: 40,
        heldSeats: 5,
        price: 20000,
        freeBags: 1,
        maxKgPerBag: 23,
      },
      {
        _id: new Types.ObjectId(),
        category: CabinCategory.BUSINESS,
        totalSeats: 8,
        bookedSeats: 8,
        heldSeats: 0,
        price: 90000,
        freeBags: 2,
        maxKgPerBag: 32,
      },
    ],
  };
  const baseAirline = {
    _id: AIRLINE,
    name: 'Nile Air',
    code: 'NP',
    logo: '/api/uploads/x.png',
    isActive: true,
    extraBagPrice: 5000,
    maxExtraBags: 2,
    cancellationTiers: [
      { daysBefore: 0, refundPercent: 0 },
      { daysBefore: 7, refundPercent: 100 },
      { daysBefore: 2, refundPercent: 50 },
    ],
  };

  function setup(
    flight: object | null = baseFlight,
    airline: object | null = baseAirline,
  ) {
    const flights = { findById: jest.fn(() => ({ lean: async () => flight })) };
    const airlines = {
      findById: jest.fn(() => ({ lean: async () => airline })),
    };
    const airportModel = {
      find: () => ({
        lean: async () => [
          {
            _id: 'CAI',
            name: 'Cairo International',
            cityId: 'cairo',
            timeZone: 'Africa/Cairo',
          },
          {
            _id: 'DXB',
            name: 'Dubai International',
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
    return {
      service: new FlightDetailsService(flights as any, airlines as any, views),
      flights,
    };
  }

  it('shows local times, duration, every cabin and the airline policies', async () => {
    const { service } = setup();
    const d = await service.details(String(FLIGHT));
    expect(d.departure).toMatchObject({
      local: '2099-12-02T00:30',
      timeZone: 'Africa/Cairo',
    });
    expect(d.arrival).toMatchObject({
      local: '2099-12-02T06:30',
      timeZone: 'Asia/Dubai',
    });
    expect(d.durationMinutes).toBe(240);
    expect(d.airline).toEqual({
      _id: String(AIRLINE),
      name: 'Nile Air',
      code: 'NP',
      logo: '/api/uploads/x.png',
      extraBagPrice: 5000,
      maxExtraBags: 2,
    });
    expect(d.cancellationTiers.map((t) => t.daysBefore)).toEqual([7, 2, 0]);
  });

  it('shows seats remaining = total - booked - held, even when 0', async () => {
    const { service } = setup();
    const d = await service.details(String(FLIGHT));
    expect(
      d.cabins.map((c) => [
        c.category,
        c.availableSeats,
        c.freeBags,
        c.maxKgPerBag,
      ]),
    ).toEqual([
      [CabinCategory.ECONOMY, 105, 1, 23],
      [CabinCategory.BUSINESS, 0, 2, 32],
    ]);
  });

  it('does not show guests the booked and held seat counts', async () => {
    const { service } = setup();
    const d = await service.details(String(FLIGHT));
    for (const c of d.cabins) {
      expect(c).not.toHaveProperty('bookedSeats');
      expect(c).not.toHaveProperty('heldSeats');
    }
  });

  it('answers 404 for an unknown or invalid id', async () => {
    const { service, flights } = setup(null);
    await expect(
      service.details(String(new Types.ObjectId())),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.details('not-an-id')).rejects.toThrow(
      'Flight not found',
    );
    expect(flights.findById).toHaveBeenCalledTimes(1);
  });

  it('answers 404 to the public for a Cancelled flight', async () => {
    const { service } = setup({
      ...baseFlight,
      status: FlightStatus.CANCELLED,
    });
    await expect(service.details(String(FLIGHT))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("answers 404 for an inactive airline's flight", async () => {
    const { service } = setup(baseFlight, { ...baseAirline, isActive: false });
    await expect(service.details(String(FLIGHT))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('still shows a departed flight, not bookable', async () => {
    const { service } = setup({
      ...baseFlight,
      departureAt: new Date('2020-01-01T08:00:00Z'),
      arrivalAt: new Date('2020-01-01T12:00:00Z'),
    });
    const d = await service.details(String(FLIGHT));
    expect(d).toMatchObject({ status: FlightStatus.DEPARTED, bookable: false });
  });
});
