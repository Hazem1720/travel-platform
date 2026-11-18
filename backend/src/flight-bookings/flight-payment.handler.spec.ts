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

  function setup(
    found: object | null = booking,
    airline: object | null = null,
    flightDocs: object[] = [],
  ) {
    const bookings = {
      findById: jest.fn(() => ({ lean: async () => found })),
      updateOne: jest.fn(async () => ({ modifiedCount: 1 })),
    };
    const holds = { expire: jest.fn(async () => undefined) };
    const confirmations = { confirm: jest.fn(async () => undefined) };
    const flights = { find: jest.fn(() => ({ lean: async () => flightDocs })) };
    const airlines = {
      findById: jest.fn(() => ({ lean: async () => airline })),
    };
    return {
      handler: new FlightPaymentHandler(
        bookings as any,
        holds as any,
        confirmations as any,
        flights as any,
        airlines as any,
      ),
      bookings,
      holds,
      confirmations,
      airlines,
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

  it('confirm() hands over to the confirmation (FLT-23)', async () => {
    const { handler, confirmations } = setup();
    await handler.confirm('abc');
    expect(confirmations.confirm).toHaveBeenCalledWith('abc');
  });

  describe('PAY-02 policies (added by Memo)', () => {
    const outAirline = new Types.ObjectId();
    const retAirline = new Types.ObjectId();
    const [f1, f2, c1, c2] = [1, 2, 3, 4].map(() => new Types.ObjectId());
    const roundTrip = {
      ...booking,
      segments: [
        {
          flightId: f1,
          airlineId: outAirline,
          cabinId: c1,
          cabin: 'Economy',
          flightNumber: 'NP101',
          from: 'CAI',
          to: 'DXB',
        },
        {
          flightId: f2,
          airlineId: retAirline,
          cabinId: c2,
          cabin: 'Economy',
          flightNumber: 'GX202',
          from: 'DXB',
          to: 'CAI',
        },
      ],
    };
    const airline = {
      _id: outAirline,
      name: 'TEST Nile Air',
      cancellationTiers: [
        { daysBefore: 2, refundPercent: 50 },
        { daysBefore: 14, refundPercent: 100 },
      ],
      extraBagPrice: 5000,
      maxExtraBags: 2,
    };
    const flightDocs = [
      { _id: f1, cabins: [{ _id: c1, freeBags: 1, maxKgPerBag: 23 }] },
      { _id: f2, cabins: [{ _id: c2, freeBags: 2, maxKgPerBag: 32 }] },
    ];

    it("shows the outbound airline's tiers (most days first) and each cabin's bags", async () => {
      const { handler, airlines } = setup(roundTrip, airline, flightDocs);
      await expect(handler.getPolicies(String(booking._id))).resolves.toEqual({
        bookingId: String(booking._id),
        userId: String(booking.userId),
        status: BookingStatus.PENDING_PAYMENT,
        expiresAt: booking.expiresAt,
        policiesAcceptedAt: null,
        provider: { id: String(outAirline), name: 'TEST Nile Air' },
        cancellationTiers: [
          { daysBefore: 14, refundPercent: 100 },
          { daysBefore: 2, refundPercent: 50 },
        ],
        baggage: {
          extraBagPrice: 5000,
          maxExtraBags: 2,
          cabins: [
            {
              flightNumber: 'NP101',
              cabin: 'Economy',
              freeBags: 1,
              maxKgPerBag: 23,
            },
            {
              flightNumber: 'GX202',
              cabin: 'Economy',
              freeBags: 2,
              maxKgPerBag: 32,
            },
          ],
        },
      });
      // FLT-12a: the outbound segment's airline decides the tiers.
      expect(airlines.findById).toHaveBeenCalledWith(
        outAirline,
        expect.anything(),
      );
    });

    it('returns null for unknown or invalid ids', async () => {
      const { handler } = setup(null);
      await expect(
        handler.getPolicies(String(new Types.ObjectId())),
      ).resolves.toBeNull();
      await expect(handler.getPolicies('nope')).resolves.toBeNull();
    });

    it('acceptPolicies stores the time once, only while PendingPayment within the hold', async () => {
      const { handler, bookings } = setup();
      const at = new Date('2026-11-19T10:00:00Z');
      await expect(
        handler.acceptPolicies(String(booking._id), at),
      ).resolves.toBe(true);
      expect(bookings.updateOne).toHaveBeenCalledWith(
        {
          _id: String(booking._id),
          status: BookingStatus.PENDING_PAYMENT,
          expiresAt: { $gt: at },
          policiesAcceptedAt: null,
        },
        { $set: { policiesAcceptedAt: at } },
      );
      bookings.updateOne.mockResolvedValueOnce({ modifiedCount: 0 });
      await expect(
        handler.acceptPolicies(String(booking._id), at),
      ).resolves.toBe(false);
      await expect(handler.acceptPolicies('nope', at)).resolves.toBe(false);
    });
  });
});
