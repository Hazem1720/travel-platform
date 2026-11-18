import { Types } from 'mongoose';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { FlightPaymentHandler } from './flight-payment.handler';

// PAY-01 contract for flights: what Memo's PaymentsService reads and calls.
describe('FlightPaymentHandler (PAY-01, FLT-22)', () => {
  const booking = {
    _id: new Types.ObjectId(),
    userId: new Types.ObjectId(),
    status: BookingStatus.PENDING_PAYMENT,
    totalAmount: 47000,
    currency: 'USD',
    expiresAt: new Date('2099-12-01T10:10:00Z'),
    policiesAcceptedAt: null,
    segments: [
      { flightNumber: 'NP101', from: 'CAI', to: 'DXB' },
      { flightNumber: 'NP102', from: 'DXB', to: 'CAI' },
    ],
  };

  function setup(found: object | null = booking) {
    const bookings = { findById: jest.fn(() => ({ lean: async () => found })) };
    const holds = { expire: jest.fn(async () => undefined) };
    return {
      handler: new FlightPaymentHandler(bookings as any, holds as any),
      bookings,
      holds,
    };
  }

  it('describes the booking for Payments: owner, status, amount, hold, policies', async () => {
    const { handler } = setup();
    await expect(handler.getPayable(String(booking._id))).resolves.toEqual({
      bookingId: String(booking._id),
      userId: String(booking.userId),
      status: BookingStatus.PENDING_PAYMENT,
      amount: 47000,
      currency: 'USD',
      expiresAt: booking.expiresAt,
      policiesAcceptedAt: null,
      description: 'Flight NP101 CAI-DXB, NP102 DXB-CAI',
    });
  });

  it('returns null for unknown or invalid ids', async () => {
    const { handler, bookings } = setup(null);
    await expect(
      handler.getPayable(String(new Types.ObjectId())),
    ).resolves.toBeNull();
    await expect(handler.getPayable('nope')).resolves.toBeNull();
    expect(bookings.findById).toHaveBeenCalledTimes(1);
  });

  it('expire() releases the hold', async () => {
    const { handler, holds } = setup();
    await handler.expire('abc');
    expect(holds.expire).toHaveBeenCalledWith('abc');
  });
});
