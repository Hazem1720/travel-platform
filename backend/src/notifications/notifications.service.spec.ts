import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { NotificationsService } from './notifications.service';
import { NotificationType } from './schemas/notification.schema';

// GEN-01 with a mocked model. The queries are checked for the owner filter,
// so another user's notifications can never be read or changed.
describe('NotificationsService (GEN-01)', () => {
  const USER = '6735a1f4c1a2b3c4d5e6f701';
  const OTHER = '6735a1f4c1a2b3c4d5e6f702';
  const NOTE = '6736b2f4c1a2b3c4d5e6f801';
  const page = { page: 1, limit: 10 };

  function setup(opts: { found?: unknown; total?: number } = {}) {
    const query = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn(async () => [{ _id: NOTE }]),
    };
    const model = {
      create: jest.fn(async (doc: object) => ({
        toObject: () => ({ _id: NOTE, readAt: null, ...doc }),
      })),
      find: jest.fn(() => query),
      countDocuments: jest.fn(async () => opts.total ?? 1),
      updateOne: jest.fn(async () => ({ modifiedCount: 1 })),
      updateMany: jest.fn(async () => ({ modifiedCount: 3 })),
      findOne: jest.fn(() => ({
        lean: async () => ('found' in opts ? opts.found : { _id: NOTE }),
      })),
    };
    return {
      service: new NotificationsService(model as any),
      model,
      query,
    };
  }

  it('creates an unread notification for the user', async () => {
    const { service, model } = setup();
    const created = await service.create(
      USER,
      NotificationType.BOOKING_CONFIRMED,
      'Your flight booking FL-7K2M9QX4 is confirmed',
      { reference: 'FL-7K2M9QX4' },
    );
    expect(model.create).toHaveBeenCalledWith({
      userId: new Types.ObjectId(USER),
      type: NotificationType.BOOKING_CONFIRMED,
      message: 'Your flight booking FL-7K2M9QX4 is confirmed',
      data: { reference: 'FL-7K2M9QX4' },
    });
    expect(created).toMatchObject({ readAt: null });
  });

  it('stores data as null when it is not given', async () => {
    const { service, model } = setup();
    await service.create(USER, NotificationType.REFUND_ISSUED, 'Refunded');
    expect((model.create.mock.calls as any[])[0][0]).toMatchObject({
      data: null,
    });
  });

  it('refuses an invalid user id (a bug in the caller)', async () => {
    const { service } = setup();
    await expect(
      service.create('nope', NotificationType.REFUND_ISSUED, 'x'),
    ).rejects.toThrow('invalid userId');
  });

  it("lists only the user's notifications, newest first", async () => {
    const { service, model, query } = setup();
    await service.list(USER, page);
    expect(model.find).toHaveBeenCalledWith({
      userId: new Types.ObjectId(USER),
    });
    expect(query.sort).toHaveBeenCalledWith({ createdAt: -1 });
  });

  it('has 2 pages with 11 notifications', async () => {
    const { service, query } = setup({ total: 11 });
    const res = await service.list(USER, { page: 2, limit: 10 });
    expect(query.skip).toHaveBeenCalledWith(10);
    expect(res.meta).toEqual({ page: 2, limit: 10, total: 11, totalPages: 2 });
  });

  it('allows sorting by createdAt only', async () => {
    const { service } = setup();
    await expect(
      service.list(USER, { ...page, sort: 'message:asc' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('counts only unread notifications of the user', async () => {
    const { service, model } = setup({ total: 1 });
    await expect(service.unreadCount(USER)).resolves.toEqual({ count: 1 });
    expect(model.countDocuments).toHaveBeenCalledWith({
      userId: new Types.ObjectId(USER),
      readAt: null,
    });
  });

  it('marks one of my notifications as read, keeping the first readAt', async () => {
    const { service, model } = setup();
    await service.markRead(USER, NOTE);
    const [filter, update] = model.updateOne.mock.calls[0] as any[];
    expect(filter).toEqual({
      _id: NOTE,
      userId: new Types.ObjectId(USER),
      readAt: null,
    });
    expect(update.$set.readAt).toBeInstanceOf(Date);
  });

  it("answers 404 for another user's notification", async () => {
    const { service, model } = setup({ found: null });
    await expect(service.markRead(OTHER, NOTE)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(model.findOne).toHaveBeenCalledWith({
      _id: NOTE,
      userId: new Types.ObjectId(OTHER),
    });
  });

  it('marks all my unread notifications as read', async () => {
    const { service, model } = setup();
    await expect(service.markAllRead(USER)).resolves.toEqual({ updated: 3 });
    expect((model.updateMany.mock.calls as any[])[0][0]).toEqual({
      userId: new Types.ObjectId(USER),
      readAt: null,
    });
  });
});
