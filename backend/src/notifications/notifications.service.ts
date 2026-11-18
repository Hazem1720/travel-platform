import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto';
import {
  buildSort,
  paginated,
  PaginatedResult,
} from '../common/pagination/pagination.helper';
import {
  Notification,
  NotificationDocument,
  NotificationType,
} from './schemas/notification.schema';

export const NOTIFICATION_NOT_FOUND = 'Notification not found';

// GEN-01: in-app notifications. Other modules call create(); users read and
// mark only their own (another user's notification answers 404).
@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name)
    private readonly notifications: Model<NotificationDocument>,
  ) {}

  // For other modules, e.g. after a confirmed booking:
  //   await this.notifications.create(booking.userId,
  //     NotificationType.BOOKING_CONFIRMED,
  //     `Your flight booking ${booking.reference} is confirmed`,
  //     { bookingId: booking._id, reference: booking.reference });
  async create(
    userId: Types.ObjectId | string,
    type: NotificationType,
    message: string,
    data?: Record<string, unknown>,
  ): Promise<Notification> {
    if (!isValidObjectId(userId)) {
      throw new Error(`NotificationsService.create: invalid userId ${userId}`);
    }
    const doc = await this.notifications.create({
      userId: new Types.ObjectId(String(userId)),
      type,
      message,
      data: data ?? null,
    });
    return doc.toObject();
  }

  // Newest first, 10 per page.
  async list(
    userId: string,
    { page, limit, sort }: PaginationQueryDto,
  ): Promise<PaginatedResult<Notification>> {
    const filter = { userId: new Types.ObjectId(userId) };
    const [data, total] = await Promise.all([
      this.notifications
        .find(filter)
        .sort(buildSort(sort, [], 'createdAt:desc'))
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<Notification[]>(),
      this.notifications.countDocuments(filter),
    ]);
    return paginated(data, total, page, limit);
  }

  async unreadCount(userId: string): Promise<{ count: number }> {
    const count = await this.notifications.countDocuments({
      userId: new Types.ObjectId(userId),
      readAt: null,
    });
    return { count };
  }

  // Marks one notification as read. Reading it twice keeps the first readAt.
  async markRead(userId: string, id: string): Promise<Notification> {
    const owner = { _id: id, userId: new Types.ObjectId(userId) };
    await this.notifications.updateOne(
      { ...owner, readAt: null },
      { $set: { readAt: new Date() } },
    );
    const notification = await this.notifications
      .findOne(owner)
      .lean<Notification>();
    if (!notification) throw new NotFoundException(NOTIFICATION_NOT_FOUND);
    return notification;
  }

  async markAllRead(userId: string): Promise<{ updated: number }> {
    const res = await this.notifications.updateMany(
      { userId: new Types.ObjectId(userId), readAt: null },
      { $set: { readAt: new Date() } },
    );
    return { updated: res.modifiedCount };
  }
}
