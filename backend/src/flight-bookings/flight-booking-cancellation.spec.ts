import { ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { Role } from '../common/enums/role.enum';
import { AuthUser } from '../common/types/auth-user.type';
import { NotificationType } from '../notifications/schemas/notification.schema';
import { PaymentBookingType, RefundStatus } from '../payments/payment-handler';
import {
  ALREADY_DEPARTED,
  FlightBookingCancellationService,
  NOT_CONFIRMED,
  REFUND_CHANGED,
} from './flight-booking-cancellation.service';

// FLT-26: a user cancels their own Confirmed flight booking before departure.
describe('Cancel my flight booking (FLT-26)', () => {
  const USER = '6735a1f4c1a2b3c4d5e6f003';
  const user: AuthUser = {
    id: USER,
    role: Role.USER,
    assignedProviderId: null,
  };
  const BOOKING = new Types.ObjectId('6736f0a1c1a2b3c4d5e6fb10');
  const AIRLINE = new Types.ObjectId('6735a1f4c1a2b3c4d5e6f601');
  const OUT = new Types.ObjectId('6735a1f4c1a2b3c4d5e6f701');
  const BACK = new Types.ObjectId('6735a1f4c1a2b3c4d5e6f702');
  const CABIN_OUT = new Types.ObjectId('6735a1f4c1a2b3c4d5e6f711');
  const CABIN_BACK = new Types.ObjectId('6735a1f4c1a2b3c4d5e6f712');
  // 10:00 UTC on 25 Nov = 12:00 in Cairo.
  const NOW = new Date('2026-11-25T10:00:00Z');
  const segment = (
    flightId: Types.ObjectId,
    cabinId: Types.ObjectId,
    from: string,
    to: string,
    departureAt: string,
  ) => ({
    flightId,
    airlineId: AIRLINE,
    flightNumber: 'MS777',
    from,
    to,
    departureAt: new Date(departureAt),
    arrivalAt: new Date(departureAt),
    cabinId,
    cabin: 'Economy',
    seats: 2,
  });
  // A round trip: out on 5 Dec at 23:30 UTC, which is already 6 Dec in
  // Cairo (UTC+2), so 11 local days, not 10.
  const booking = {
    _id: BOOKING,
    userId: new Types.ObjectId(USER),
    reference: 'FL-7K2M9QX4',
    status: BookingStatus.CONFIRMED,
    segments: [
      segment(OUT, CABIN_OUT, 'CAI', 'CDG', '2026-12-05T23:30:00Z'),
      segment(BACK, CABIN_BACK, 'CDG', 'CAI', '2026-12-12T09:00:00Z'),
    ],
    totalAmount: 62401,
    currency: 'USD',
  };
  const airline = {
    cancellationTiers: [
      { daysBefore: 3, refundPercent: 50 },
      { daysBefore: 30, refundPercent: 100 },
      { daysBefore: 11, refundPercent: 75 },
      { daysBefore: 0, refundPercent: 0 },
    ],
  };

  function setup(
    b: object | null = booking,
    opts: { modified?: number; refund?: jest.Mock; timeZone?: string } = {},
  ) {
    const bookings = {
      findById: jest.fn(() => ({ lean: async () => b })),
      updateOne: jest.fn(async () => ({ modifiedCount: opts.modified ?? 1 })),
    };
    const flights = { updateOne: jest.fn(async () => ({ modifiedCount: 1 })) };
    const airlines = {
      findById: jest.fn(() => ({ lean: async () => airline })),
    };
    const airports = {
      findById: jest.fn(() => ({
        lean: async () => ({ timeZone: opts.timeZone ?? 'Africa/Cairo' }),
      })),
    };
    const seats = { deleteMany: jest.fn(async () => ({ deletedCount: 2 })) };
    const payments = {
      refund:
        opts.refund ??
        jest.fn(async (_t: string, _id: string, amount: number) =>
          amount === 0
            ? null
            : {
                refundId: 'r1',
                amount,
                currency: 'USD',
                status: RefundStatus.PENDING,
              },
        ),
    };
    const notifications = { create: jest.fn(async () => ({})) };
    const service = new FlightBookingCancellationService(
      bookings as any,
      flights as any,
      airlines as any,
      airports as any,
      seats as any,
      payments as any,
      notifications as any,
    );
    return {
      service,
      bookings,
      flights,
      airports,
      seats,
      payments,
      notifications,
    };
  }

  describe('GET /flight-bookings/:id/cancellation', () => {
    it("uses the outbound flight's airline tier, in the departure airport's local date", async () => {
      const { service, airports, bookings } = setup();
      const q = await service.preview(user, String(BOOKING), NOW);
      expect(airports.findById).toHaveBeenCalledWith('CAI', { timeZone: 1 });
      expect(q).toMatchObject({
        reference: 'FL-7K2M9QX4',
        daysBeforeDeparture: 11,
        refundPercent: 75,
        // 62401 * 75% = 46800.75 -> 46801.
        refundAmount: 46801,
        totalAmount: 62401,
      });
      expect(q.segments.map((s) => s.from)).toEqual(['CAI', 'CDG']);
      expect(q.cancellationTiers.map((t) => t.daysBefore)).toEqual([
        30, 11, 3, 0,
      ]);
      expect(bookings.updateOne).not.toHaveBeenCalled();
    });

    it('counted in UTC instead, the same departure is 10 days: a lower tier', async () => {
      const q = await setup(booking, { timeZone: 'UTC' }).service.preview(
        user,
        String(BOOKING),
        NOW,
      );
      expect([q.daysBeforeDeparture, q.refundPercent]).toEqual([10, 50]);
    });

    it('a few hours before departure is still allowed, at the 0-day tier', async () => {
      const soon = {
        ...booking,
        segments: [
          segment(OUT, CABIN_OUT, 'CAI', 'CDG', '2026-11-25T15:00:00Z'),
        ],
      };
      const q = await setup(soon).service.preview(user, String(BOOKING), NOW);
      expect([q.daysBeforeDeparture, q.refundAmount]).toEqual([0, 0]);
    });

    it("another user's, an unknown or a malformed id is 404", async () => {
      const other: AuthUser = {
        id: '6735a1f4c1a2b3c4d5e6f004',
        role: Role.USER,
        assignedProviderId: null,
      };
      await expect(
        setup().service.preview(other, String(BOOKING), NOW),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        setup(null).service.preview(user, String(BOOKING), NOW),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        setup(null).service.preview(user, 'nope', NOW),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('not Confirmed, or after departure, is 409', async () => {
      for (const status of [
        BookingStatus.PENDING_PAYMENT,
        BookingStatus.CANCELLED,
        BookingStatus.COMPLETED,
        BookingStatus.EXPIRED,
      ]) {
        await expect(
          setup({ ...booking, status }).service.preview(
            user,
            String(BOOKING),
            NOW,
          ),
        ).rejects.toThrow(NOT_CONFIRMED);
      }
      // Outbound already flown, even with the return still ahead.
      const flown = {
        ...booking,
        segments: [
          segment(OUT, CABIN_OUT, 'CAI', 'CDG', '2026-11-25T09:59:00Z'),
          booking.segments[1],
        ],
      };
      await expect(
        setup(flown).service.preview(user, String(BOOKING), NOW),
      ).rejects.toThrow(ALREADY_DEPARTED);
    });
  });

  describe('POST /flight-bookings/:id/cancel', () => {
    it('cancels, returns seats on both flights, frees chosen seats, refunds and notifies', async () => {
      const { service, bookings, flights, seats, payments, notifications } =
        setup();
      const result = await service.cancel(user, String(BOOKING), 46801, NOW);
      expect(bookings.updateOne).toHaveBeenCalledWith(
        {
          _id: BOOKING,
          status: BookingStatus.CONFIRMED,
          'segments.0.departureAt': { $gt: NOW },
        },
        { $set: { status: BookingStatus.CANCELLED, cancelledAt: NOW } },
      );
      expect(flights.updateOne).toHaveBeenCalledTimes(2);
      expect(flights.updateOne).toHaveBeenCalledWith(
        { _id: BACK },
        { $inc: { 'cabins.$[c].bookedSeats': -2 } },
        {
          arrayFilters: [{ 'c._id': CABIN_BACK, 'c.bookedSeats': { $gte: 2 } }],
        },
      );
      expect(seats.deleteMany).toHaveBeenCalledWith({ bookingId: BOOKING });
      expect(payments.refund).toHaveBeenCalledWith(
        PaymentBookingType.FLIGHT,
        String(BOOKING),
        46801,
      );
      expect(notifications.create).toHaveBeenCalledWith(
        booking.userId,
        NotificationType.BOOKING_CANCELLED,
        expect.stringContaining('$468.01 (75%)'),
        expect.objectContaining({ refundAmount: 46801 }),
      );
      expect(result).toMatchObject({
        status: BookingStatus.CANCELLED,
        refundPercent: 75,
        refundAmount: 46801,
        refund: { refundId: 'r1', status: RefundStatus.PENDING },
      });
    });

    it('a refund amount other than the current one changes nothing (409)', async () => {
      const { service, bookings, payments } = setup();
      await expect(
        service.cancel(user, String(BOOKING), 62401, NOW),
      ).rejects.toThrow(REFUND_CHANGED);
      expect(bookings.updateOne).not.toHaveBeenCalled();
      expect(payments.refund).not.toHaveBeenCalled();
    });

    it('losing the race is 409, with no seats returned and no refund', async () => {
      const { service, flights, payments } = setup(booking, { modified: 0 });
      await expect(
        service.cancel(user, String(BOOKING), 46801, NOW),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(flights.updateOne).not.toHaveBeenCalled();
      expect(payments.refund).not.toHaveBeenCalled();
    });

    it('a refund error never undoes the cancellation', async () => {
      const { service, notifications } = setup(booking, {
        refund: jest.fn(async () => {
          throw new ConflictException('nothing to refund');
        }),
      });
      const result = await service.cancel(user, String(BOOKING), 46801, NOW);
      expect(result.status).toBe(BookingStatus.CANCELLED);
      expect(result.refund).toBeNull();
      expect(notifications.create).toHaveBeenCalled();
    });
  });
});
