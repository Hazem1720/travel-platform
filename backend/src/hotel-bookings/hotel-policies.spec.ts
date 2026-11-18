import { Types } from 'mongoose';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { HotelPaymentHandler } from './hotel-payment.handler';

// PAY-02, hotel side: the 'hotel' handler's policies and acceptance.
describe('Hotel policies for PAY-02', () => {
  const ID = new Types.ObjectId();
  const USER = new Types.ObjectId();
  const HOTEL = new Types.ObjectId();
  const expiresAt = new Date(Date.now() + 5 * 60_000);
  const booking = {
    _id: ID,
    userId: USER,
    hotelId: HOTEL,
    hotelName: 'TEST Nile View (at booking)',
    status: BookingStatus.PENDING_PAYMENT,
    expiresAt,
    policiesAcceptedAt: null,
  };

  function setup(found: unknown, hotel: unknown) {
    const bookings = {
      findById: jest.fn(() => ({ lean: async () => found })),
      updateOne: jest.fn(async () => ({ modifiedCount: 1 })),
    };
    const hotels = { findById: jest.fn(() => ({ lean: async () => hotel })) };
    const handler = new HotelPaymentHandler(
      bookings as any,
      hotels as any,
      {} as any,
    );
    return { handler, bookings, hotels };
  }

  it("shows the hotel's cancellation tiers (most days first) and check-in/out times", async () => {
    const { handler, hotels } = setup(booking, {
      name: 'TEST Nile View',
      checkInTime: '14:00',
      checkOutTime: '12:00',
      cancellationTiers: [
        { daysBefore: 2, refundPercent: 50, _id: 'x' },
        { daysBefore: 7, refundPercent: 100, _id: 'y' },
      ],
    });
    expect(await handler.getPolicies(String(ID))).toEqual({
      bookingId: String(ID),
      userId: String(USER),
      status: BookingStatus.PENDING_PAYMENT,
      expiresAt,
      policiesAcceptedAt: null,
      provider: { id: String(HOTEL), name: 'TEST Nile View' },
      cancellationTiers: [
        { daysBefore: 7, refundPercent: 100 },
        { daysBefore: 2, refundPercent: 50 },
      ],
      checkInTime: '14:00',
      checkOutTime: '12:00',
    });
    expect((hotels.findById.mock.calls as any[])[0][0]).toEqual(HOTEL);
  });

  it('no tiers means an empty list (no refund); null for unknown or malformed ids', async () => {
    const { handler } = setup(booking, {
      name: 'TEST',
      checkInTime: '15:00',
      checkOutTime: '11:00',
      cancellationTiers: [],
    });
    expect((await handler.getPolicies(String(ID)))?.cancellationTiers).toEqual(
      [],
    );
    expect(await setup(null, null).handler.getPolicies(String(ID))).toBeNull();
    expect(await setup(null, null).handler.getPolicies('abc')).toBeNull();
  });

  it('acceptPolicies saves the time once, only while PendingPayment and held', async () => {
    const { handler, bookings } = setup(booking, null);
    const at = new Date();
    expect(await handler.acceptPolicies(String(ID), at)).toBe(true);
    expect(bookings.updateOne).toHaveBeenCalledWith(
      {
        _id: String(ID),
        status: BookingStatus.PENDING_PAYMENT,
        expiresAt: { $gt: at },
        policiesAcceptedAt: null,
      },
      { $set: { policiesAcceptedAt: at } },
    );
    bookings.updateOne.mockResolvedValueOnce({ modifiedCount: 0 });
    expect(await handler.acceptPolicies(String(ID), at)).toBe(false);
  });
});
