import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

// GEN-07: admin actions that are logged. Need another one? Ask Aabsy to add
// it here, so the filter in GET /admin/audit-logs stays consistent.
export enum AuditAction {
  MODERATOR_CREATED = 'MODERATOR_CREATED',
  ACCOUNT_SUSPENDED = 'ACCOUNT_SUSPENDED',
  ACCOUNT_REACTIVATED = 'ACCOUNT_REACTIVATED',
  PASSWORD_RESET = 'PASSWORD_RESET',
  PROVIDER_DEACTIVATED = 'PROVIDER_DEACTIVATED',
  PROVIDER_REACTIVATED = 'PROVIDER_REACTIVATED',
  REPORT_DISMISSED = 'REPORT_DISMISSED',
  CONTENT_HIDDEN = 'CONTENT_HIDDEN',
  CONTENT_DELETED = 'CONTENT_DELETED',
}

export enum AuditTargetType {
  USER = 'user',
  AIRLINE = 'airline',
  HOTEL = 'hotel',
  POST = 'post',
  COMMENT = 'comment',
  REVIEW = 'review',
  ITINERARY = 'itinerary',
  REPORT = 'report',
}

// Append-only: rows are only ever inserted and read.
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class AuditLog {
  @Prop({ type: Types.ObjectId, required: true })
  adminId: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(AuditAction), required: true })
  action: AuditAction;

  @Prop({ type: String, enum: Object.values(AuditTargetType), required: true })
  targetType: AuditTargetType;

  @Prop({ type: String, required: true })
  targetId: string;

  // Anything useful to read later, e.g. { reason: 'spam', email: '...' }.
  @Prop({ type: Object, default: null })
  details: Record<string, unknown> | null;

  createdAt?: Date;
}

export type AuditLogDocument = HydratedDocument<AuditLog>;
export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);

AuditLogSchema.index({ createdAt: -1 });
AuditLogSchema.index({ action: 1, createdAt: -1 });
AuditLogSchema.index({ adminId: 1, createdAt: -1 });

// Append-only, even for code that gets the model directly: every update or
// delete through Mongoose fails.
export const AUDIT_APPEND_ONLY = 'The audit log is append-only';
const blocked = [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'findOneAndReplace',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
] as const;
for (const op of blocked) {
  AuditLogSchema.pre(op, function () {
    throw new Error(AUDIT_APPEND_ONLY);
  });
}
