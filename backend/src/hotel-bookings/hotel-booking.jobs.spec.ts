import { Types } from 'mongoose';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { PaymentBookingType } from '../payments/payment-handler';
import { PaymentsService } from '../payments/payments.service';
import { HotelBookingJobs } from './hotel-booking.jobs';
import { HotelPaymentHandler } from './hotel-payment.handler';

// HTL-18 expiry job and the PAY-01 'hotel' handler.
describe('Hotel hold expiry and payment handler (HTL-18, PAY-01)', () => {
  describe('HotelBookingJobs.expireHolds', () => {
    function setup(ids: string[], failOn?: string) {
      const holds = { findExpiredHolds: jest.fn(async () => ids) };
      const payments = {
        releaseInventory: jest.fn(async (_t: string, id: string) => {
          if (id === failOn) throw new Error('boom');
        }),
      };
      const jobs = new HotelBookingJobs(holds as any, payments as any);
      return { jobs, holds, payments };
    }

    it('expires every overdue reservation through PaymentsService', async () => {
      const { jobs, payments, holds } = setup(['a', 'b']);
      const now = new Date();
      expect(await jobs.expireHolds(now)).toBe(2);
      expect(holds.findExpiredHolds).toHaveBeenCalledWith(now);
      expect(payments.releaseInventory.mock.calls).toEqual([
        [PaymentBookingType.HOTEL, 'a'],
        [PaymentBookingType.HOTEL, 'b'],
      ]);
    });

    it('one failure does not stop the others, and a failed query is logged', async () => {
      const { jobs } = setup(['a', 'b', 'c'], 'b');
      expect(await jobs.expireHolds()).toBe(2);
      const broken = new HotelBookingJobs(
        {
          findExpiredHolds: async () => Promise.reject(new Error('db')),
        } as any,
        {} as any,
      );
      expect(await broken.expireHolds()).toBe(0);
    });
  });

  describe('HotelPaymentHandler', () => {
    const id = new Types.ObjectId();
    const userId = new Types.ObjectId();
    const expiresAt = new Date(Date.now() + 5 * 60_000);
    function setup(found: unknown) {
      const bookings = {
        findById: jest.fn(() => ({ lean: async () => found })),
      };
      const holds = { expire: jest.fn(async () => undefined) };
      const confirmations = { confirm: jest.fn(async () => undefined) };
      const handler = new HotelPaymentHandler(
        bookings as any,
        {} as any,
        holds as any,
        confirmations as any,
      );
      return { handler, holds, confirmations };
    }

    it('getPayable gives Payments the owner, status, total, hold and policies', async () => {
      const { handler } = setup({
        _id: id,
        userId,
        status: BookingStatus.PENDING_PAYMENT,
        totalAmount: 75000,
        currency: 'USD',
        expiresAt,
        policiesAcceptedAt: null,
        hotelName: 'TEST Nile View',
        checkIn: '2026-12-05',
        checkOut: '2026-12-08',
      });
      expect(await handler.getPayable(String(id))).toEqual({
        bookingId: String(id),
        userId: String(userId),
        status: BookingStatus.PENDING_PAYMENT,
        amount: 75000,
        currency: 'USD',
        expiresAt,
        policiesAcceptedAt: null,
        description: 'Hotel TEST Nile View, 2026-12-05 to 2026-12-08',
      });
    });

    it('getPayable: null for an unknown or malformed id', async () => {
      expect(await setup(null).handler.getPayable(String(id))).toBeNull();
      expect(await setup(null).handler.getPayable('abc')).toBeNull();
    });

    it('expire goes to HotelHoldService.expire; confirm to HTL-17', async () => {
      const { handler, holds, confirmations } = setup(null);
      await handler.expire(String(id));
      expect(holds.expire).toHaveBeenCalledWith(String(id));
      await handler.confirm(String(id));
      expect(confirmations.confirm).toHaveBeenCalledWith(String(id));
    });

    it('PaymentsService refuses to pay before the policies are accepted (PAY-02)', async () => {
      const { handler } = setup({
        _id: id,
        userId,
        status: BookingStatus.PENDING_PAYMENT,
        totalAmount: 75000,
        currency: 'USD',
        expiresAt,
        policiesAcceptedAt: null,
        hotelName: 'x',
        checkIn: '2026-12-05',
        checkOut: '2026-12-08',
      });
      const payments = new PaymentsService(
        {} as any,
        {} as any,
        {} as any,
        {} as any,
      );
      payments.registerHandler(PaymentBookingType.HOTEL, handler);
      await expect(
        payments.getPayableFor(
          PaymentBookingType.HOTEL,
          String(id),
          String(userId),
        ),
      ).rejects.toMatchObject({ status: 400 });
      // Another user's reservation: 404.
      await expect(
        payments.getPayableFor(
          PaymentBookingType.HOTEL,
          String(id),
          String(new Types.ObjectId()),
        ),
      ).rejects.toMatchObject({ status: 404 });
    });
  });
});
