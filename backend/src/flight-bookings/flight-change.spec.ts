import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { Role } from '../common/enums/role.enum';
import { PaymentBookingType } from '../payments/payment-handler';
import { FLIGHT_FULL, FlightChangeService } from './flight-change.service';

const userId = new Types.ObjectId();
const user: any = { id: String(userId), role: Role.USER };
const oldFlight = new Types.ObjectId();
const newFlight = new Types.ObjectId();
const cabin = new Types.ObjectId();
const DEP = new Date('2026-12-20T08:00:00Z');
const NOW = new Date('2026-11-19T10:00:00Z');

function seg(flightId: Types.ObjectId, subtotal: number, dep = DEP) {
  return {
    flightId,
    airlineId: new Types.ObjectId(),
    flightNumber: 'MS777',
    from: 'CAI',
    to: 'LHR',
    departureAt: dep,
    arrivalAt: new Date(dep.getTime() + 5 * 3600_000),
    cabinId: cabin,
    cabin: 'Economy',
    seats: 1,
    cabinFare: subtotal,
    fares: subtotal,
    baggageFees: 0,
    subtotal,
  };
}

function setup(newPrice: number, opts: { full?: boolean; to?: string } = {}) {
  const booking: any = {
    _id: new Types.ObjectId(),
    userId,
    reference: 'FL-AAAA1111',
    status: BookingStatus.CONFIRMED,
    segments: [seg(oldFlight, 50000)],
    passengers: [
      {
        type: 'Adult',
        fullName: 'A B',
        dateOfBirth: '1990-01-01',
        passportNumber: 'A12345',
        extraBags: [],
      },
    ],
    totalAmount: 50000,
    currency: 'USD',
  };
  const changes: any[] = [];
  const q = (v: any) => ({ lean: async () => v });
  const bookingsModel: any = {
    findById: jest.fn(() => q(booking)),
    updateOne: jest.fn(async (_f: any, u: any) => {
      Object.assign(booking, u.$set);
      return { modifiedCount: 1 };
    }),
  };
  const changesModel: any = {
    findOne: jest.fn(() => q(null)),
    create: jest.fn(async (d: any) => {
      const doc = {
        _id: new Types.ObjectId(),
        createdAt: NOW,
        appliedAt: null,
        ...d,
      };
      changes.push(doc);
      return { toObject: () => ({ ...doc }) };
    }),
    findById: jest.fn((id: any) =>
      q(changes.find((c) => String(c._id) === String(id)) ?? null),
    ),
    updateOne: jest.fn(async (f: any, u: any) => {
      const c = changes.find(
        (x) =>
          String(x._id) === String(f._id) &&
          (!f.status || x.status === f.status),
      );
      if (c) Object.assign(c, u.$set);
      return { modifiedCount: c ? 1 : 0 };
    }),
    findOneAndUpdate: jest.fn((f: any, u: any) => {
      const c = changes.find(
        (x) => String(x._id) === String(f._id) && x.status === f.status,
      );
      if (c) Object.assign(c, u.$set);
      return q(c ?? null);
    }),
  };
  const flights: any = {
    updateOne: jest.fn(async () => ({ modifiedCount: 1 })),
  };
  const seats: any = { deleteMany: jest.fn(async () => ({})) };
  const quotes: any = {
    quote: jest.fn(async () => ({
      segments: [
        {
          flightId: String(newFlight),
          flightNumber: 'MS779',
          airline: { _id: String(new Types.ObjectId()) },
          from: { code: 'CAI' },
          to: { code: opts.to ?? 'LHR' },
          departure: { utc: '2026-12-21T08:00:00.000Z' },
          arrival: { utc: '2026-12-21T13:00:00.000Z' },
          cabinId: String(cabin),
          cabin: 'Economy',
          cabinFare: newPrice,
        },
      ],
      seats: 1,
      price: {
        segments: [{ fares: newPrice, baggageFees: 0, subtotal: newPrice }],
        total: newPrice,
      },
    })),
  };
  const holds: any = {
    reserve: jest.fn(async () => !opts.full),
    unreserve: jest.fn(async () => undefined),
  };
  const payments: any = {
    refund: jest.fn(async (_t: any, _id: any, amount: number) => ({
      refundId: 'r1',
      amount,
      currency: 'USD',
      status: 'Pending',
    })),
    releaseInventory: jest.fn(async () => undefined),
  };
  const notifications: any = { create: jest.fn(async () => ({})) };
  const service = new FlightChangeService(
    bookingsModel,
    changesModel,
    flights,
    seats,
    quotes,
    holds,
    payments,
    notifications,
  );
  return {
    service,
    booking,
    changes,
    bookingsModel,
    flights,
    seats,
    holds,
    payments,
    notifications,
  };
}

const dto = { outboundFlightId: String(newFlight) };

describe('FLT-27: change a confirmed flight booking', () => {
  it('a cheaper flight is applied at once, the difference refunded, seats moved', async () => {
    const t = setup(40000);
    const res: any = await t.service.request(
      user,
      String(t.booking._id),
      dto,
      NOW,
    );
    expect(res.status).toBe(BookingStatus.CONFIRMED);
    expect(res.difference).toBe(-10000);
    expect(t.booking.totalAmount).toBe(40000);
    expect(String(t.booking.segments[0].flightId)).toBe(String(newFlight));
    expect(t.payments.refund).toHaveBeenCalledWith(
      PaymentBookingType.FLIGHT,
      String(t.booking._id),
      10000,
    );
    // held -> booked on the new flight, booked freed on the old one
    expect(t.flights.updateOne).toHaveBeenCalledTimes(2);
    expect(t.seats.deleteMany).toHaveBeenCalledWith({
      bookingId: t.booking._id,
      segment: 0,
    });
    expect(t.notifications.create).toHaveBeenCalled();
  });

  it('a dearer flight waits for the difference; the Stripe confirmation applies it', async () => {
    const t = setup(65000);
    const res: any = await t.service.request(
      user,
      String(t.booking._id),
      dto,
      NOW,
    );
    expect(res).toMatchObject({
      status: BookingStatus.PENDING_PAYMENT,
      amountDue: 15000,
    });
    expect(res.payWith.body).toEqual({
      bookingType: 'flight-change',
      bookingId: res.changeId,
    });
    expect(t.bookingsModel.updateOne).not.toHaveBeenCalled();

    const payable = await t.service.getPayable(res.changeId);
    expect(payable).toMatchObject({
      amount: 15000,
      status: BookingStatus.PENDING_PAYMENT,
      parentBookingId: String(t.booking._id),
    });

    await t.service.confirm(res.changeId);
    expect(t.booking.totalAmount).toBe(65000);
    await t.service.confirm(res.changeId); // Stripe repeating the event
    expect(t.bookingsModel.updateOne).toHaveBeenCalledTimes(1);
  });

  it('a full flight is a 409 and the booking stays as it was', async () => {
    const t = setup(40000, { full: true });
    await expect(
      t.service.request(user, String(t.booking._id), dto, NOW),
    ).rejects.toThrow(FLIGHT_FULL);
    expect(t.changes).toHaveLength(0);
    expect(t.booking.totalAmount).toBe(50000);
    expect(t.bookingsModel.updateOne).not.toHaveBeenCalled();
  });

  it('refuses another route, the same flight, and a booking that is not Confirmed', async () => {
    const t = setup(40000, { to: 'JFK' });
    await expect(
      t.service.request(user, String(t.booking._id), dto, NOW),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(t.holds.reserve).not.toHaveBeenCalled();
    await expect(
      t.service.request(
        user,
        String(t.booking._id),
        { outboundFlightId: String(oldFlight) },
        NOW,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    t.booking.status = BookingStatus.CANCELLED;
    await expect(
      t.service.request(user, String(t.booking._id), dto, NOW),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('an unpaid change expires once and gives the held seats back', async () => {
    const t = setup(65000);
    const res: any = await t.service.request(
      user,
      String(t.booking._id),
      dto,
      NOW,
    );
    await t.service.expire(res.changeId);
    await t.service.expire(res.changeId);
    expect(t.holds.unreserve).toHaveBeenCalledTimes(1);
    await expect(t.service.confirm(res.changeId)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(t.booking.totalAmount).toBe(50000);
  });
});
