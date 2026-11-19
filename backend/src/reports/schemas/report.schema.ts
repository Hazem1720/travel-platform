import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export enum ReportTargetType {
  POST = 'post',
  COMMENT = 'comment',
  REVIEW = 'review',
  ITINERARY = 'itinerary',
}

export enum ReportStatus {
  OPEN = 'open',
  DISMISSED = 'dismissed',
  RESOLVED = 'resolved',
}

@Schema({ timestamps: true, collection: 'reports' })
export class Report {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  reporterId: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(ReportTargetType), required: true })
  targetType: ReportTargetType;

  @Prop({ type: String, required: true })
  targetId: string;

  @Prop({ type: String, required: true, trim: true })
  reason: string;

  @Prop({
    type: String,
    enum: Object.values(ReportStatus),
    default: ReportStatus.OPEN,
    index: true,
  })
  status: ReportStatus;

  // GEN-10: how the report was closed (dismissed, hidden or deleted), by
  // which admin and when.
  @Prop({ type: String, enum: ['dismissed', 'hidden', 'deleted'] })
  resolution?: 'dismissed' | 'hidden' | 'deleted';

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  resolvedBy?: Types.ObjectId;

  @Prop({ type: Date })
  resolvedAt?: Date;

  createdAt?: Date;
  updatedAt?: Date;
}

export type ReportDocument = HydratedDocument<Report>;
export const ReportSchema = SchemaFactory.createForClass(Report);
ReportSchema.index(
  { reporterId: 1, targetType: 1, targetId: 1 },
  { unique: true },
);
ReportSchema.index({ status: 1, createdAt: -1 });
ReportSchema.index({ targetType: 1, targetId: 1, status: 1 });
