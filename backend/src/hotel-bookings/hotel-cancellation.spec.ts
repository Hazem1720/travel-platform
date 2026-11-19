import { ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { Role } from '../common/enums/role.enum';
import { AuthUser } from '../common/types/auth-user.type';
import { NotificationType } from '../notifications/schemas/notification.schema';
import { PaymentBookingType, RefundStatus } from '../payments/payment-handler';
import {
  CHECK_IN_REACHED,
  daysBetween,
  HotelCancellationService,
  NOT_CONFIRMED,
  REFUND_CHANGED,
} from './hotel-cancellation.service';

// HTL-21: a user cancels their own Confirmed reservation before check-in.
describe('Cancel my hotel reservation (HTL-21)', () => {
  const USER = '6735a1f4c1a2b3c4d5e6f003';
  const user: AuthUser = {
    id: USER,
    role: Role.USER,
    assignedProviderId: null,
  };
  const BOOKING = new Types.ObjectId('6736f0a1c1a2b3c4d5e6fb20');
  const HOTEL = new Types.ObjectId('6735a1f4c1a2b3c4d5e6f801');
  const NOW = new Date('2026-11-25T10:00:00Z');
  const booking = {
    _id: BOOKING,
    userId: new Types.ObjectId(USER),
    hotelId: HOTEL,
    hotelName: 'Nile View',
    reference: 'HT-7K2M9QX4',
    status: BookingStatus.CONFIRMED,
    checkIn: '2026-12-05',
    checkOut: '2026-12-08',
    totalAmount: 45001,
    currency: 'USD',
  };
  // Tiers stored in any order.
  const hotel = {
    cityId: 'cairo',
    cancellationTiers: [
      { daysBefore: 2, refundPercent: 50 },
      { daysBefore: 14, refundPercent: 100 },
      { daysBefore: 0, refundPercent: 0 },
    ],
  };

  function setup(
    b: object | null = booking,
    opts: {
      today?: string;
      modified?: number;
      refund?: jest.Mock;
    } = {},
  ) {
    const bookings = {
      findById: jest.fn(() => ({ lean: async () => b })),
      updateOne: jest.fn(async () => ({ modifiedCount: opts.modified ?? 1 })),
    };
    const hotels = { findById: jest.fn(() => ({ lean: async () => hotel })) };
    const search = { today: jest.fn(async () => opts.today ?? '2026-11-25') };
    const availability = { releaseBooking: jest.fn(async () => 9) };
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
    const service = new HotelCancellationService(
      bookings as any,
      hotels as any,
      search as any,
      availability as any,
      payments as any,
      notifications as any,
    );
    return { service, bookings, search, availability, payments, notifications };
  }

  it('counts whole days between two dates', () => {
    expect(daysBetween('2026-11-25', '2026-12-05')).toBe(10);
    expect(daysBetween('2026-12-05', '2026-12-05')).toBe(0);
    // Across the end of March (a DST change in many places).
    expect(daysBetween('2026-03-28', '2026-04-02')).toBe(5);
  });

  describe('GET /hotel-bookings/:id/cancellation', () => {
    it("shows the hotel's tier for the days left, on the full total, in the hotel's local date", async () => {
      const { service, search, bookings } = setup();
      const quote = await service.preview(user, String(BOOKING), NOW);
      expect(search.today).toHaveBeenCalledWith({ cityId: 'cairo' }, NOW);
      expect(quote).toMatchObject({
        reference: 'HT-7K2M9QX4',
        daysBeforeCheckIn: 10,
        refundPercent: 50,
        // 45001 * 50% = 22500.5 -> nearest cent.
        refundAmount: 22501,
        totalAmount: 45001,
      });
      expect(quote.cancellationTiers.map((t) => t.daysBefore)).toEqual([
        14, 2, 0,
      ]);
      expect(bookings.updateOne).not.toHaveBeenCalled();
    });

    it('14 or more days before: 100%; the day before check-in: 0%', async () => {
      let q = await setup(booking, { today: '2026-11-21' }).service.preview(
        user,
        String(BOOKING),
        NOW,
      );
      expect([q.refundPercent, q.refundAmount]).toEqual([100, 45001]);
      q = await setup(booking, { today: '2026-12-04' }).service.preview(
        user,
        String(BOOKING),
        NOW,
      );
      expect([q.refundPercent, q.refundAmount]).toEqual([0, 0]);
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

    it('not Confirmed, or on/after the check-in date, is 409', async () => {
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
      for (const today of ['2026-12-05', '2026-12-06']) {
        await expect(
          setup(booking, { today }).service.preview(user, String(BOOKING), NOW),
        ).rejects.toThrow(CHECK_IN_REACHED);
      }
    });
  });

  describe('POST /hotel-bookings/:id/cancel', () => {
    it('cancels, frees every room night, refunds and notifies', async () => {
      const { service, bookings, availability, payments, notifications } =
        setup();
      const result = await service.cancel(user, String(BOOKING), 22501, NOW);
      expect(bookings.updateOne).toHaveBeenCalledWith(
        { _id: BOOKING, status: BookingStatus.CONFIRMED },
        { $set: { status: BookingStatus.CANCELLED, cancelledAt: NOW } },
      );
      expect(availability.releaseBooking).toHaveBeenCalledWith(String(BOOKING));
      expect(payments.refund).toHaveBeenCalledWith(
        PaymentBookingType.HOTEL,
        String(BOOKING),
        22501,
      );
      expect(notifications.create).toHaveBeenCalledWith(
        booking.userId,
        NotificationType.BOOKING_CANCELLED,
        expect.stringContaining('$225.01 (50%)'),
        expect.objectContaining({ refundAmount: 22501 }),
      );
      expect(result).toMatchObject({
        status: BookingStatus.CANCELLED,
        refundPercent: 50,
        refundAmount: 22501,
        refund: { refundId: 'r1', status: RefundStatus.PENDING },
      });
    });

    it('a 0% cancellation still cancels and frees the rooms, with no refund', async () => {
      const { service, availability, notifications } = setup(booking, {
        today: '2026-12-04',
      });
      const result = await service.cancel(user, String(BOOKING), 0, NOW);
      expect(availability.releaseBooking).toHaveBeenCalled();
      expect(result.refund).toBeNull();
      expect(notifications.create).toHaveBeenCalledWith(
        expect.anything(),
        NotificationType.BOOKING_CANCELLED,
        expect.stringContaining('No refund applies'),
        expect.anything(),
      );
    });

    it('a refund amount other than the current one changes nothing (409)', async () => {
      const { service, bookings, payments } = setup();
      await expect(
        service.cancel(user, String(BOOKING), 45001, NOW),
      ).rejects.toThrow(REFUND_CHANGED);
      expect(bookings.updateOne).not.toHaveBeenCalled();
      expect(payments.refund).not.toHaveBeenCalled();
    });

    it('losing the race to another cancel is 409, with no second refund', async () => {
      const { service, availability, payments } = setup(booking, {
        modified: 0,
      });
      await expect(
        service.cancel(user, String(BOOKING), 22501, NOW),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(availability.releaseBooking).not.toHaveBeenCalled();
      expect(payments.refund).not.toHaveBeenCalled();
    });

    it('a refund error never undoes the cancellation', async () => {
      const { service, notifications } = setup(booking, {
        refund: jest.fn(async () => {
          throw new ConflictException('nothing to refund');
        }),
      });
      const result = await service.cancel(user, String(BOOKING), 22501, NOW);
      expect(result.status).toBe(BookingStatus.CANCELLED);
      expect(result.refund).toBeNull();
      expect(notifications.create).toHaveBeenCalled();
    });
  });
});
