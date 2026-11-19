import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Types } from 'mongoose';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { BookingStatus } from '../common/enums/booking-status.enum';
import { Role } from '../common/enums/role.enum';
import { BookingPoliciesController } from './booking-policies.controller';
import { AcceptPoliciesDto } from './dto/booking-policies.dto';
import {
  BookingPolicies,
  PaymentBookingType,
  PaymentHandler,
} from './payment-handler';
import {
  BOOKING_NOT_FOUND,
  HOLD_EXPIRED,
  NOT_PENDING_PAYMENT,
  POLICIES_NOT_ACCEPTED,
  PaymentsService,
} from './payments.service';

// PAY-02 in PaymentsService with a fake booking handler.
describe('Booking policies before payment (PAY-02)', () => {
  const OWNER = new Types.ObjectId().toHexString();
  const STRANGER = new Types.ObjectId().toHexString();
  const ID = new Types.ObjectId().toHexString();

  function setup(over: Partial<BookingPolicies> = {}, withPolicies = true) {
    const state: BookingPolicies = {
      bookingId: ID,
      userId: OWNER,
      status: BookingStatus.PENDING_PAYMENT,
      expiresAt: new Date(Date.now() + 5 * 60_000),
      policiesAcceptedAt: null,
      provider: { id: 'h1', name: 'TEST Nile View' },
      cancellationTiers: [
        { daysBefore: 7, refundPercent: 100 },
        { daysBefore: 2, refundPercent: 50 },
      ],
      checkInTime: '14:00',
      checkOutTime: '12:00',
      ...over,
    };
    const handler: PaymentHandler = {
      getPayable: jest.fn(async () => ({
        bookingId: ID,
        userId: state.userId,
        status: state.status,
        amount: 75000,
        currency: 'USD',
        expiresAt: state.expiresAt,
        policiesAcceptedAt: state.policiesAcceptedAt,
      })),
      confirm: jest.fn(),
      expire: jest.fn(),
      ...(withPolicies
        ? {
            getPolicies: jest.fn(async (id: string) =>
              id === ID ? { ...state } : null,
            ),
            acceptPolicies: jest.fn(async (_id: string, at: Date) => {
              state.policiesAcceptedAt = at;
              return true;
            }),
          }
        : {}),
    };
    const payments = new PaymentsService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    payments.registerHandler(PaymentBookingType.HOTEL, handler);
    return { payments, handler, state };
  }

  it('own PendingPayment booking shows its policies, not yet accepted', async () => {
    const { payments } = setup();
    expect(
      await payments.getPolicies(PaymentBookingType.HOTEL, ID, OWNER),
    ).toEqual({
      type: 'hotel',
      bookingId: ID,
      status: BookingStatus.PENDING_PAYMENT,
      provider: { id: 'h1', name: 'TEST Nile View' },
      cancellationTiers: [
        { daysBefore: 7, refundPercent: 100 },
        { daysBefore: 2, refundPercent: 50 },
      ],
      checkInTime: '14:00',
      checkOutTime: '12:00',
      accepted: false,
      policiesAcceptedAt: null,
      expiresAt: expect.any(Date),
    });
  });

  it("another user's booking or an unknown id: 404", async () => {
    const { payments } = setup();
    await expect(
      payments.getPolicies(PaymentBookingType.HOTEL, ID, STRANGER),
    ).rejects.toThrow(new NotFoundException(BOOKING_NOT_FOUND));
    await expect(
      payments.getPolicies(PaymentBookingType.HOTEL, 'other', OWNER),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      payments.acceptPolicies(PaymentBookingType.HOTEL, ID, STRANGER),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('paying before accepting: 400; accepting saves a timestamp and payment is then allowed', async () => {
    const { payments, handler } = setup();
    await expect(
      payments.getPayableFor(PaymentBookingType.HOTEL, ID, OWNER),
    ).rejects.toThrow(new BadRequestException(POLICIES_NOT_ACCEPTED));

    const before = Date.now();
    const res = await payments.acceptPolicies(
      PaymentBookingType.HOTEL,
      ID,
      OWNER,
    );
    expect(res).toMatchObject({ type: 'hotel', bookingId: ID, accepted: true });
    expect(res.policiesAcceptedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(handler.acceptPolicies).toHaveBeenCalledWith(
      ID,
      res.policiesAcceptedAt,
    );

    await expect(
      payments.getPayableFor(PaymentBookingType.HOTEL, ID, OWNER),
    ).resolves.toMatchObject({ bookingId: ID, amount: 75000 });
    const shown = await payments.getPolicies(
      PaymentBookingType.HOTEL,
      ID,
      OWNER,
    );
    expect(shown).toMatchObject({
      accepted: true,
      policiesAcceptedAt: res.policiesAcceptedAt,
    });
  });

  it('accepting again keeps the first timestamp', async () => {
    const first = new Date('2026-11-18T10:01:00Z');
    const { payments, handler } = setup({ policiesAcceptedAt: first });
    const res = await payments.acceptPolicies(
      PaymentBookingType.HOTEL,
      ID,
      OWNER,
    );
    expect(res.policiesAcceptedAt).toEqual(first);
    expect(handler.acceptPolicies).not.toHaveBeenCalled();
  });

  it('a booking that is no longer PendingPayment, or whose hold expired: 409', async () => {
    const confirmed = setup({ status: BookingStatus.CONFIRMED });
    await expect(
      confirmed.payments.acceptPolicies(PaymentBookingType.HOTEL, ID, OWNER),
    ).rejects.toThrow(new ConflictException(NOT_PENDING_PAYMENT));
    const expired = setup({ expiresAt: new Date(Date.now() - 1000) });
    await expect(
      expired.payments.acceptPolicies(PaymentBookingType.HOTEL, ID, OWNER),
    ).rejects.toThrow(new ConflictException(HOLD_EXPIRED));
    // The policies can still be read, e.g. on a confirmation page.
    await expect(
      confirmed.payments.getPolicies(PaymentBookingType.HOTEL, ID, OWNER),
    ).resolves.toMatchObject({ status: BookingStatus.CONFIRMED });
  });

  it('the hold expires between reading and saving: 409', async () => {
    const { payments, handler } = setup();
    (handler.acceptPolicies as jest.Mock).mockResolvedValueOnce(false);
    await expect(
      payments.acceptPolicies(PaymentBookingType.HOTEL, ID, OWNER),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('a booking type whose module has no policies yet: 501', async () => {
    const { payments } = setup({}, false);
    await expect(
      payments.getPolicies(PaymentBookingType.HOTEL, ID, OWNER),
    ).rejects.toBeInstanceOf(NotImplementedException);
    await expect(
      payments.acceptPolicies(PaymentBookingType.HOTEL, ID, OWNER),
    ).rejects.toBeInstanceOf(NotImplementedException);
  });

  it('a booking type with no handler registered (flights before #175): 501, not 500', async () => {
    const { payments } = setup();
    await expect(
      payments.getPolicies(PaymentBookingType.FLIGHT, ID, OWNER),
    ).rejects.toBeInstanceOf(NotImplementedException);
  });

  it('the checkbox must be ticked: accepted must be true', async () => {
    const failed = async (body: object) =>
      (await validate(plainToInstance(AcceptPoliciesDto, body))).map(
        (e) => e.property,
      );
    expect(await failed({ accepted: true })).toEqual([]);
    expect(await failed({ accepted: false })).toEqual(['accepted']);
    expect(await failed({ accepted: 'yes' })).toEqual(['accepted']);
    expect(await failed({})).toEqual(['accepted']);
  });

  it('the routes are for registered users', () => {
    expect(
      new Reflector().get<Role[]>(ROLES_KEY, BookingPoliciesController),
    ).toEqual([Role.USER]);
  });
});
