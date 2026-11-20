import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { Role } from '../common/enums/role.enum';
import { CabinCategory } from '../flights/schemas/flight.schema';
import { SeatAssignmentSchema } from './schemas/seat-assignment.schema';
import { normalizeSeat, seatLabels } from './seat-map';
import { SeatSelectionService } from './seat-selection.service';

const owner = {
  id: new Types.ObjectId().toHexString(),
  role: Role.USER,
  assignedProviderId: null,
};
const stranger = { ...owner, id: new Types.ObjectId().toHexString() };
const flightId = new Types.ObjectId();
const cabinId = new Types.ObjectId();
const bookingId = new Types.ObjectId();
const lean = (v: unknown) => ({ lean: async () => v });

function booking(extra: Record<string, unknown> = {}) {
  return {
    _id: bookingId,
    userId: new Types.ObjectId(owner.id),
    status: BookingStatus.CONFIRMED,
    expiresAt: null,
    segments: [
      {
        flightId,
        cabinId,
        cabin: CabinCategory.ECONOMY,
        flightNumber: 'NP101',
        from: 'CAI',
        to: 'DXB',
        departureAt: new Date(Date.now() + 86_400_000),
      },
    ],
    passengers: [
      { type: 'adult', fullName: 'Sara Ali' },
      { type: 'infant', fullName: 'Baby Ali' },
    ],
    ...extra,
  };
}

function setup(b: any = booking(), opts: { other?: any; holder?: any } = {}) {
  const bookings = {
    findById: jest.fn<any, any[]>((id: unknown) =>
      lean(String(id) === String(bookingId) ? b : (opts.other ?? null)),
    ),
    find: jest.fn<any, any[]>(() => lean(opts.other ? [opts.other] : [])),
  };
  const flights = {
    findById: jest.fn<any, any[]>(() =>
      lean({ cabins: [{ _id: cabinId, totalSeats: 20 }] }),
    ),
  };
  const assignments = {
    findOne: jest.fn<any, any[]>((q: any) =>
      lean(q.seat ? (opts.holder ?? null) : null),
    ),
    find: jest.fn<any, any[]>(() => lean([])),
    create: jest.fn<any, any[]>(async (d: unknown) => d),
    updateOne: jest.fn<any, any[]>(async () => ({})),
    deleteOne: jest.fn<any, any[]>(async () => ({})),
  };
  const service = new SeatSelectionService(
    bookings as any,
    flights as any,
    assignments as any,
  );
  return { service, assignments, bookings };
}
const pick = { segment: 0, passengerIndex: 0, seat: '3c' };
const dup = Object.assign(new Error('E11000'), { code: 11000 });

describe('FLT-28: seat map', () => {
  it('has 6 seats a row in Economy and 4 in Business', () => {
    expect(seatLabels(CabinCategory.ECONOMY, 8)).toEqual([
      '1A',
      '1B',
      '1C',
      '1D',
      '1E',
      '1F',
      '2A',
      '2B',
    ]);
    expect(seatLabels(CabinCategory.BUSINESS, 5)).toEqual([
      '1A',
      '1C',
      '1D',
      '1F',
      '2A',
    ]);
  });

  it('accepts only seats that exist in the cabin', () => {
    expect(normalizeSeat(CabinCategory.ECONOMY, 20, ' 3c ')).toBe('3C');
    expect(normalizeSeat(CabinCategory.ECONOMY, 20, '4C')).toBeNull();
    expect(normalizeSeat(CabinCategory.BUSINESS, 8, '1B')).toBeNull();
  });

  it('makes a seat unique per flight cabin, and one seat per passenger', () => {
    expect(SeatAssignmentSchema.indexes()).toEqual(
      expect.arrayContaining([
        [
          { flightId: 1, cabinId: 1, seat: 1 },
          expect.objectContaining({ unique: true }),
        ],
        [
          { bookingId: 1, segment: 1, passengerIndex: 1 },
          expect.objectContaining({ unique: true }),
        ],
      ]),
    );
  });
});

describe('FLT-28: choose a seat', () => {
  it('gives a free seat to a passenger of my Confirmed booking', async () => {
    const { service, assignments } = setup();
    await expect(
      service.selectSeat(owner, String(bookingId), pick),
    ).resolves.toMatchObject({
      seat: '3C',
      flightNumber: 'NP101',
    });
    expect(assignments.create).toHaveBeenCalledWith({
      flightId,
      cabinId,
      bookingId,
      segment: 0,
      passengerIndex: 0,
      seat: '3C',
    });
  });

  it('is 409 when another active booking holds the seat (the race loser)', async () => {
    const other = {
      _id: new Types.ObjectId(),
      status: BookingStatus.CONFIRMED,
    };
    const { service, assignments } = setup(booking(), {
      other,
      holder: { _id: new Types.ObjectId(), bookingId: other._id, seat: '3C' },
    });
    assignments.create.mockRejectedValue(dup);
    await expect(
      service.selectSeat(owner, String(bookingId), pick),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(assignments.deleteOne).not.toHaveBeenCalled();
  });

  it('frees a seat left by an Expired booking and takes it', async () => {
    const other = { _id: new Types.ObjectId(), status: BookingStatus.EXPIRED };
    const holderId = new Types.ObjectId();
    const { service, assignments } = setup(booking(), {
      other,
      holder: { _id: holderId, bookingId: other._id, seat: '3C' },
    });
    assignments.create.mockRejectedValueOnce(dup);
    await expect(
      service.selectSeat(owner, String(bookingId), pick),
    ).resolves.toMatchObject({
      seat: '3C',
    });
    expect(assignments.deleteOne).toHaveBeenCalledWith({ _id: holderId });
    expect(assignments.create).toHaveBeenCalledTimes(2);
  });

  it('changes the seat of a passenger who already has one', async () => {
    const { service, assignments } = setup();
    const existing = { _id: new Types.ObjectId(), seat: '1A' };
    assignments.findOne.mockImplementation((q: any) =>
      lean(q.seat ? null : existing),
    );
    await service.selectSeat(owner, String(bookingId), pick);
    expect(assignments.updateOne).toHaveBeenCalledWith(
      { _id: existing._id },
      { $set: { seat: '3C' } },
    );
    expect(assignments.create).not.toHaveBeenCalled();
  });

  it('refuses infants, unknown seats, passengers and flights (400)', async () => {
    const { service } = setup();
    for (const dto of [
      { ...pick, passengerIndex: 1 },
      { ...pick, passengerIndex: 5 },
      { ...pick, segment: 1 },
      { ...pick, seat: '40A' },
    ]) {
      await expect(
        service.selectSeat(owner, String(bookingId), dto),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('refuses expired, cancelled or departed bookings (400)', async () => {
    for (const b of [
      booking({
        status: BookingStatus.PENDING_PAYMENT,
        expiresAt: new Date(Date.now() - 1000),
      }),
      booking({ status: BookingStatus.CANCELLED }),
    ]) {
      await expect(
        setup(b).service.selectSeat(owner, String(bookingId), pick),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    const departed = booking();
    departed.segments[0].departureAt = new Date(Date.now() - 1000);
    await expect(
      setup(departed).service.selectSeat(owner, String(bookingId), pick),
    ).rejects.toThrow('already departed');
  });

  it("is 404 for someone else's booking", async () => {
    await expect(
      setup().service.selectSeat(stranger, String(bookingId), pick),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      setup().service.seatsFor(stranger, String(bookingId)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('shows the seat map with taken and my seats', async () => {
    const other = {
      _id: new Types.ObjectId(),
      status: BookingStatus.CONFIRMED,
    };
    const { service, assignments, bookings } = setup();
    assignments.find
      .mockReturnValueOnce(
        lean([{ segment: 0, passengerIndex: 0, seat: '1B' }]),
      )
      .mockReturnValueOnce(
        lean([
          { seat: '1A', bookingId: other._id },
          { seat: '1B', bookingId },
        ]),
      );
    bookings.find.mockReturnValue(lean([other, booking()]));
    const [map] = await service.seatsFor(owner, String(bookingId));
    expect(map.seats).toHaveLength(20);
    expect(map.seats.slice(0, 3)).toEqual([
      { seat: '1A', taken: true, passengerIndex: null },
      { seat: '1B', taken: false, passengerIndex: 0 },
      { seat: '1C', taken: false, passengerIndex: null },
    ]);
    expect(map.passengers).toEqual([
      { index: 0, fullName: 'Sara Ali', seat: '1B' },
      { index: 1, fullName: 'Baby Ali', seat: null },
    ]);
  });
});
