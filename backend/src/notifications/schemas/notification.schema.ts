import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

// GEN-01: the events that create an in-app notification.
export enum NotificationType {
  BOOKING_CONFIRMED = 'BOOKING_CONFIRMED',
  BOOKING_CANCELLED = 'BOOKING_CANCELLED',
  REFUND_ISSUED = 'REFUND_ISSUED',
  FLIGHT_SCHEDULE_CHANGED = 'FLIGHT_SCHEDULE_CHANGED',
  ACCOUNT_SUSPENDED = 'ACCOUNT_SUSPENDED',
  PROVIDER_SUSPENDED = 'PROVIDER_SUSPENDED',
  // HTL-26 (bonus): the hotel replied to your review.
  REVIEW_REPLIED = 'REVIEW_REPLIED',
  // FLT-27 (bonus): your flight booking was changed.
  BOOKING_CHANGED = 'BOOKING_CHANGED',
}

// Only createdAt: a notification never changes except readAt.
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class Notification {
  @Prop({ type: Types.ObjectId, required: true })
  userId: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(NotificationType), required: true })
  type: NotificationType;

  @Prop({ type: String, required: true, trim: true, maxlength: 500 })
  message: string;

  // Optional details for the frontend, e.g. { bookingId, reference }.
  @Prop({ type: Object, default: null })
  data: Record<string, unknown> | null;

  // null means unread.
  @Prop({ type: Date, default: null })
  readAt: Date | null;

  createdAt?: Date;
}

export type NotificationDocument = HydratedDocument<Notification>;
export const NotificationSchema = SchemaFactory.createForClass(Notification);

// "My notifications, newest first" and "my unread count".
NotificationSchema.index({ userId: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, readAt: 1 });
