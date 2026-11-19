import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { PaymentBookingType, RefundStatus } from '../payment-handler';

// PAY-03: one refund through the Stripe Refunds API (conventions.md,
// "Payments and refunds"). Created only for a positive amount; the status
// is Pending until Stripe says it went through (Refunded) or failed.
@Schema({ timestamps: true, collection: 'refunds' })
export class Refund {
  @Prop({
    type: String,
    enum: Object.values(PaymentBookingType),
    required: true,
  })
  bookingType: PaymentBookingType;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  bookingId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  // The Payment it gives money back from.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Payment', required: true })
  paymentId: Types.ObjectId;

  // re_... from Stripe; null if Stripe could not be reached (Failed).
  @Prop({ type: String, default: null })
  stripeRefundId: string | null;

  // Cents of the platform currency (PAY-04).
  @Prop({ type: Number, required: true, min: 1 })
  amount: number;

  @Prop({ type: String, required: true })
  currency: string;

  @Prop({
    type: String,
    enum: Object.values(RefundStatus),
    default: RefundStatus.PENDING,
  })
  status: RefundStatus;

  createdAt?: Date;
  updatedAt?: Date;
}

export type RefundDocument = HydratedDocument<Refund>;
export type LeanRefund = Refund & { _id: Types.ObjectId };
export const RefundSchema = SchemaFactory.createForClass(Refund);

// The webhook finds a refund by its Stripe id.
RefundSchema.index(
  { stripeRefundId: 1 },
  {
    unique: true,
    partialFilterExpression: { stripeRefundId: { $type: 'string' } },
  },
);
// The refunds of one booking (booking details) and of one payment (the
// amount still refundable).
RefundSchema.index({ bookingType: 1, bookingId: 1, createdAt: 1 });
RefundSchema.index({ paymentId: 1 });
