import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { Role } from '../common/enums/role.enum';
import { AuthUser } from '../common/types/auth-user.type';
import { FlightStatus } from '../flights/schemas/flight.schema';
import { NotificationType } from '../notifications/schemas/notification.schema';
import { PaymentBookingType } from '../payments/payment-handler';
import {
  FLIGHT_NOT_SCHEDULED,
  FlightCancellationService,
} from './flight-cancellation.service';

const lean = (v: unknown) => ({ lean: async () => v });

// FLT-06: an airline moderator cancels a Scheduled flight.
describe('Cancel a flight (FLT-06)', () => {
  const moderator: AuthUser = {
    id: '6735a1f4c1a2b3c4d5e6f002',
    role: Role.AIRLINE_MODERATOR,
    assignedProviderId: '6735a1f4c1a2b3c4d5e6f601',
  };
  const NOW = new Date('2026-12-01T10:00:00.000Z');
  const F = new Types.ObjectId('6735a1f4c1a2b3c4d5e6f701');
  const OTHER = new Types.ObjectId('6735a1f4c1a2b3c4d5e6f702');
  const ECO = new Types.ObjectId();
  const flight = {
    _id: F,
    flightNumber: 'MS777',
    from: 'CAI',
    to: 'CDG',
    departureAt: new Date('2026-12-05T08:00:00.000Z'),
    status: FlightStatus.SCHEDULED,
  };
  const oneWay = {
    _id: new Types.ObjectId(),
    userId: new Types.ObjectId(),
    reference: 'FL-ONEWAY01',
    totalAmount: 30000,
    segments: [{ flightId: F, cabinId: ECO, seats: 2 }],
  };
  const roundTrip = {
    _id: new Types.ObjectId(),
    userId: new Types.ObjectId(),
    reference: 'FL-ROUND001',
    totalAmount: 52000,
    segments: [
      { flightId: OTHER, cabinId: new Types.ObjectId(), seats: 1 },
      { flightId: F, cabinId: ECO, seats: 1 },
    ],
  };
  const hold = { _id: new Types.ObjectId() };

  function setup(
    o: {
      flight?: object;
      claimed?: number;
      bookingWon?: (id: Types.ObjectId) => number;
      refund?: jest.Mock;
      getOwned?: jest.Mock;
    } = {},
  ) {
    const f = { ...flight, ...(o.flight ?? {}) };
    const flights = {
      updateOne: jest.fn(async (filter: any) =>
        filter.status === FlightStatus.SCHEDULED
          ? { modifiedCount: o.claimed ?? 1 }
          : { modifiedCount: 1 },
      ),
    };
    const bookings = {
      find: jest.fn((filter: any) =>
        lean(
          filter.status === BookingStatus.PENDING_PAYMENT
            ? [hold]
            : [oneWay, roundTrip],
        ),
      ),
      updateOne: jest.fn(async (filter: any) => ({
        modifiedCount: o.bookingWon ? o.bookingWon(filter._id) : 1,
      })),
    };
    const flightsService = {
      getOwned: o.getOwned ?? jest.fn(async () => f),
      toViews: jest.fn(async (list: any[]) => list),
    };
    const payments = {
      releaseInventory: jest.fn(async () => undefined),
      refund: o.refund ?? jest.fn(async () => ({ status: 'Refunded' })),
    };
    const notifications = { create: jest.fn(async () => ({})) };
    const service = new FlightCancellationService(
      flights as any,
      bookings as any,
      flightsService as any,
      payments as any,
      notifications as any,
    );
    return {
      service,
      flights,
      bookings,
      flightsService,
      payments,
      notifications,
    };
  }

  it('cancels the flight, releases holds, cancels and fully refunds every Confirmed booking, and notifies', async () => {
    const s = setup();
    const result = await s.service.cancel(moderator, String(F), NOW);

    expect(s.flightsService.getOwned).toHaveBeenCalledWith(
      moderator,
      String(F),
    );
    // The flight: one conditional update, Scheduled and not departed.
    expect(s.flights.updateOne.mock.calls[0]).toEqual([
      { _id: F, status: FlightStatus.SCHEDULED, departureAt: { $gt: NOW } },
      { $set: { status: FlightStatus.CANCELLED } },
    ]);
    // Holds go through Memo's releaseInventory (cancels the PaymentIntent).
    expect(s.payments.releaseInventory).toHaveBeenCalledWith(
      PaymentBookingType.FLIGHT,
      String(hold._id),
    );
    // Each Confirmed booking: Confirmed -> Cancelled only if still Confirmed.
    expect(s.bookings.updateOne).toHaveBeenCalledWith(
      { _id: oneWay._id, status: BookingStatus.CONFIRMED },
      { $set: { status: BookingStatus.CANCELLED, cancelledAt: NOW } },
    );
    // 100% refunds.
    expect(s.payments.refund.mock.calls).toEqual([
      [PaymentBookingType.FLIGHT, String(oneWay._id), 30000],
      [PaymentBookingType.FLIGHT, String(roundTrip._id), 52000],
    ]);
    // Notifications to each booking's user.
    expect(s.notifications.create).toHaveBeenCalledTimes(2);
    expect(s.notifications.create.mock.calls[0]).toEqual(
      expect.arrayContaining([
        oneWay.userId,
        NotificationType.BOOKING_CANCELLED,
        expect.stringContaining('MS777 CAI-CDG on 2026-12-05'),
      ]),
    );
    expect(result).toMatchObject({
      flight: { status: FlightStatus.CANCELLED },
      cancelledBookings: 2,
      refundedAmount: 82000,
      releasedHolds: 1,
      problems: [],
    });
  });

  it('a round trip gives its seats back on both flights', async () => {
    const s = setup();
    await s.service.cancel(moderator, String(F), NOW);
    const seatUpdates = s.flights.updateOne.mock.calls
      .slice(1)
      .map(([filter, update, opts]: any[]) => [
        String(filter._id),
        update.$inc['cabins.$[c].bookedSeats'],
        opts.arrayFilters[0]['c.bookedSeats'],
      ]);
    expect(seatUpdates).toEqual(
      expect.arrayContaining([
        [String(F), -2, { $gte: 2 }],
        [String(OTHER), -1, { $gte: 1 }],
        [String(F), -1, { $gte: 1 }],
      ]),
    );
  });

  it.each([
    ['already Cancelled', { status: FlightStatus.CANCELLED }],
    ['already departed', { departureAt: new Date('2026-11-30T08:00:00.000Z') }],
  ])('%s: 409 and nothing changes', async (_l, change) => {
    const s = setup({ flight: change });
    const err = await s.service
      .cancel(moderator, String(F), NOW)
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.message).toBe(FLIGHT_NOT_SCHEDULED);
    expect(s.flights.updateOne).not.toHaveBeenCalled();
    expect(s.payments.refund).not.toHaveBeenCalled();
  });

  it('two cancels at once: the second loses the conditional update (409)', async () => {
    const s = setup({ claimed: 0 });
    await expect(
      s.service.cancel(moderator, String(F), NOW),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(s.bookings.find).not.toHaveBeenCalled();
  });

  it("another airline's flight: 403 from getOwned, nothing changes", async () => {
    const s = setup({
      getOwned: jest.fn(async () =>
        Promise.reject(new ForbiddenException('nope')),
      ),
    });
    await expect(
      s.service.cancel(moderator, String(F), NOW),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(s.flights.updateOne).not.toHaveBeenCalled();
  });

  it('a refund error does not undo the cancellation; it is reported and the passenger still notified', async () => {
    const refund = jest.fn(async (_t: string, id: string) => {
      if (id === String(oneWay._id)) throw new Error('Stripe down');
      return { status: 'Refunded' };
    });
    const s = setup({ refund });
    const result = await s.service.cancel(moderator, String(F), NOW);
    expect(result.cancelledBookings).toBe(2);
    expect(result.refundedAmount).toBe(52000);
    expect(result.problems).toEqual(['FL-ONEWAY01 refund: Stripe down']);
    expect(s.notifications.create).toHaveBeenCalledTimes(2);
  });

  it('a refund Stripe recorded as Failed is not counted as refunded, and is reported', async () => {
    const refund = jest.fn(async () => ({ status: 'Failed' }));
    const s = setup({ refund });
    const result = await s.service.cancel(moderator, String(F), NOW);
    expect(result.cancelledBookings).toBe(2);
    expect(result.refundedAmount).toBe(0);
    expect(result.problems).toEqual([
      'FL-ONEWAY01 refund: recorded as Failed',
      'FL-ROUND001 refund: recorded as Failed',
    ]);
  });

  it('a booking that changed meanwhile is skipped: no seats, refund or notification', async () => {
    const s = setup({
      bookingWon: (id) => (String(id) === String(oneWay._id) ? 0 : 1),
    });
    const result = await s.service.cancel(moderator, String(F), NOW);
    expect(result.cancelledBookings).toBe(1);
    expect(s.payments.refund.mock.calls.map((c: any[]) => c[1])).toEqual([
      String(roundTrip._id),
    ]);
    expect(s.notifications.create).toHaveBeenCalledTimes(1);
  });
});
