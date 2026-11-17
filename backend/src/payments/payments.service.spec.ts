import {
  BadRequestException,
  ConflictException,
  Injectable,
  Module,
  NotFoundException,
  NotImplementedException,
  OnModuleInit,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { BookingStatus } from '../common/enums/booking-status.enum';
import {
  PayableBooking,
  PaymentBookingType,
  PaymentHandler,
} from './payment-handler';
import { PaymentsModule } from './payments.module';
import {
  HOLD_EXPIRED,
  NOT_PENDING_PAYMENT,
  PaymentsService,
  POLICIES_NOT_ACCEPTED,
} from './payments.service';

// PAY-01 and PAY-03 contract (stub): handler registry and payability rules.
describe('PaymentsService (PAY-01 contract)', () => {
  const BOOKING = '6735a1f4c1a2b3c4d5e6fa01';
  const USER = '6735a1f4c1a2b3c4d5e6fb01';
  const { FLIGHT, HOTEL } = PaymentBookingType;

  const payable = (over: Partial<PayableBooking> = {}): PayableBooking => ({
    bookingId: BOOKING,
    userId: USER,
    status: BookingStatus.PENDING_PAYMENT,
    amount: 24000,
    currency: 'USD',
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    policiesAcceptedAt: new Date(),
    ...over,
  });

  function setup(found: PayableBooking | null = payable()) {
    const handler = {
      getPayable: jest.fn(async () => found),
      confirm: jest.fn(async () => undefined),
      expire: jest.fn(async () => undefined),
    };
    const service = new PaymentsService();
    service.registerHandler(HOTEL, handler);
    return { service, handler };
  }

  describe('registerHandler', () => {
    it('refuses a second handler for the same type, and an unknown type', () => {
      const { service, handler } = setup();
      expect(() => service.registerHandler(HOTEL, handler)).toThrow(
        'already registered',
      );
      expect(() =>
        service.registerHandler('train' as PaymentBookingType, handler),
      ).toThrow('Unknown payment booking type');
    });

    it('fails loudly when a type has no handler', async () => {
      const { service } = setup();
      await expect(service.confirmBooking(FLIGHT, BOOKING)).rejects.toThrow(
        'No payment handler for "flight"',
      );
    });

    it('is one registry for the whole app, whichever module registers', async () => {
      const flight: PaymentHandler = {
        getPayable: jest.fn(),
        confirm: jest.fn(async () => undefined),
        expire: jest.fn(),
      };
      @Injectable()
      class Registrar implements OnModuleInit {
        constructor(private readonly payments: PaymentsService) {}
        onModuleInit() {
          this.payments.registerHandler(FLIGHT, flight);
        }
      }
      @Module({ imports: [PaymentsModule], providers: [Registrar] })
      class FakeFlightBookingsModule {}

      const app = await Test.createTestingModule({
        imports: [PaymentsModule, FakeFlightBookingsModule],
      }).compile();
      await app.init();
      await app.get(PaymentsService).confirmBooking(FLIGHT, BOOKING);
      expect(flight.confirm).toHaveBeenCalledWith(BOOKING);
      await app.close();
    });
  });

  describe('getPayableFor (PAY-01 rules)', () => {
    it("returns the user's PendingPayment booking within its hold", async () => {
      const { service, handler } = setup();
      await expect(
        service.getPayableFor(HOTEL, BOOKING, USER),
      ).resolves.toMatchObject({ amount: 24000, currency: 'USD' });
      expect(handler.getPayable).toHaveBeenCalledWith(BOOKING);
    });

    it("answers 404 for a missing booking and for another user's", async () => {
      await expect(
        setup(null).service.getPayableFor(HOTEL, BOOKING, USER),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        setup().service.getPayableFor(HOTEL, BOOKING, 'someone-else'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each([
      BookingStatus.CONFIRMED,
      BookingStatus.EXPIRED,
      BookingStatus.CANCELLED,
    ])('answers 409 for a %s booking', async (status) => {
      await expect(
        setup(payable({ status })).service.getPayableFor(HOTEL, BOOKING, USER),
      ).rejects.toThrow(new ConflictException(NOT_PENDING_PAYMENT));
    });

    it('answers 409 once the hold has run out', async () => {
      const expired = payable({ expiresAt: new Date(Date.now() - 1) });
      await expect(
        setup(expired).service.getPayableFor(HOTEL, BOOKING, USER),
      ).rejects.toThrow(new ConflictException(HOLD_EXPIRED));
    });

    it('answers 400 until the policies are accepted (PAY-02)', async () => {
      const notAccepted = payable({ policiesAcceptedAt: null });
      await expect(
        setup(notAccepted).service.getPayableFor(HOTEL, BOOKING, USER),
      ).rejects.toThrow(new BadRequestException(POLICIES_NOT_ACCEPTED));
    });

    it('refuses a broken amount or another currency from a handler (PAY-04)', async () => {
      await expect(
        setup(payable({ amount: 99.5 })).service.getPayableFor(
          HOTEL,
          BOOKING,
          USER,
        ),
      ).rejects.toThrow('invalid amount');
      await expect(
        setup(payable({ currency: 'EGP' })).service.getPayableFor(
          HOTEL,
          BOOKING,
          USER,
        ),
      ).rejects.toThrow('platform currency');
    });
  });

  describe('createPayment (stub)', () => {
    it('runs the real checks first, then answers 501', async () => {
      await expect(
        setup(null).service.createPayment(HOTEL, BOOKING, USER),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        setup().service.createPayment(HOTEL, BOOKING, USER),
      ).rejects.toBeInstanceOf(NotImplementedException);
    });
  });

  describe('confirmBooking and releaseInventory', () => {
    it("call the type's handler", async () => {
      const { service, handler } = setup();
      await service.confirmBooking(HOTEL, BOOKING);
      await service.releaseInventory(HOTEL, BOOKING);
      expect(handler.confirm).toHaveBeenCalledWith(BOOKING);
      expect(handler.expire).toHaveBeenCalledWith(BOOKING);
    });
  });

  describe('refund (PAY-03 stub)', () => {
    it('creates nothing for 0 cents', async () => {
      await expect(setup().service.refund(HOTEL, BOOKING, 0)).resolves.toBe(
        null,
      );
    });

    it('refuses an amount that is not whole cents', async () => {
      for (const amount of [-1, 10.5, NaN]) {
        await expect(
          setup().service.refund(HOTEL, BOOKING, amount),
        ).rejects.toThrow('whole cents');
      }
    });

    it('answers 501 for a positive amount until PAY-03', async () => {
      await expect(
        setup().service.refund(HOTEL, BOOKING, 12000),
      ).rejects.toBeInstanceOf(NotImplementedException);
    });

    it('fails loudly for a type with no handler', async () => {
      await expect(setup().service.refund(FLIGHT, BOOKING, 0)).rejects.toThrow(
        'No payment handler',
      );
    });
  });
});
