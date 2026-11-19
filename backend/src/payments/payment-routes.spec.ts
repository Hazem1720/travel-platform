import { ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { Role } from '../common/enums/role.enum';
import { PaymentBookingType, PaymentStatus } from './payment-handler';
import { PaymentsService } from './payments.service';

const user = {
  id: new Types.ObjectId().toHexString(),
  role: Role.USER,
  assignedProviderId: null,
};
const paymentId = new Types.ObjectId();
const bookingId = new Types.ObjectId();

function setup(status = PaymentStatus.FAILED) {
  const stored = {
    _id: paymentId,
    userId: new Types.ObjectId(user.id),
    bookingType: PaymentBookingType.FLIGHT,
    bookingId,
    stripePaymentIntentId: 'pi_secret_id',
    amount: 42000,
    currency: 'USD',
    status,
  };
  const payments = {
    findOne: jest.fn<any, any[]>((f: any) => ({
      lean: async () =>
        String(f._id) === String(paymentId) && String(f.userId) === user.id
          ? stored
          : null,
    })),
  };
  const service = new PaymentsService(
    payments as any,
    {} as any,
    {} as any,
    {} as any,
  );
  const create = jest
    .spyOn(service, 'createPayment')
    .mockResolvedValue({ paymentId: String(paymentId) } as any);
  return { service, create };
}

describe('PAY-01: /api/payments routes (project description 8.7)', () => {
  it('GET /payments/:id shows my payment without Stripe ids', async () => {
    const view = await setup().service.getPayment(user, String(paymentId));
    expect(view).toMatchObject({
      _id: String(paymentId),
      bookingType: 'flight',
      bookingId: String(bookingId),
      amount: 42000,
      status: 'Failed',
    });
    expect(JSON.stringify(view)).not.toContain('pi_');
  });

  it("is 404 for another user's or an unknown payment", async () => {
    const other = { ...user, id: new Types.ObjectId().toHexString() };
    await expect(
      setup().service.getPayment(other, String(paymentId)),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      setup().service.getPayment(user, 'nope'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('retry pays the same booking again', async () => {
    const { service, create } = setup();
    await service.retryPayment(user, String(paymentId));
    expect(create).toHaveBeenCalledWith('flight', String(bookingId), user.id);
  });

  it('retry of a payment that succeeded is 409', async () => {
    const { service, create } = setup(PaymentStatus.SUCCEEDED);
    await expect(
      service.retryPayment(user, String(paymentId)),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(create).not.toHaveBeenCalled();
  });
});
