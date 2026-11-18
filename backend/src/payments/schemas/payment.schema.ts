import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { PaymentBookingType, PaymentStatus } from '../payment-handler';

// PAY-01: one Stripe PaymentIntent for one booking. Only the Stripe payment
// id, amount, currency and status are kept (conventions.md, "Payments and
// refunds"), plus which booking and user it belongs to. Card details never
// reach the backend: the frontend sends them straight to Stripe Elements.
@Schema({ timestamps: true, collection: 'payments' })
export class Payment {
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

  // pi_... from Stripe.
  @Prop({ type: String, required: true })
  stripePaymentIntentId: string;

  // Cents of the platform currency (PAY-04): the booking's price snapshot.
  @Prop({ type: Number, required: true, min: 1 })
  amount: number;

  @Prop({ type: String, required: true })
  currency: string;

  @Prop({
    type: String,
    enum: Object.values(PaymentStatus),
    default: PaymentStatus.PENDING,
  })
  status: PaymentStatus;

  createdAt?: Date;
  updatedAt?: Date;
}

export type PaymentDocument = HydratedDocument<Payment>;
export type LeanPayment = Payment & { _id: Types.ObjectId };
export const PaymentSchema = SchemaFactory.createForClass(Payment);

// The webhook finds the payment by its PaymentIntent; two requests at the
// same moment can never store it twice.
PaymentSchema.index({ stripePaymentIntentId: 1 }, { unique: true });
// Hold expiry cancels the open PaymentIntents of one booking.
PaymentSchema.index({ bookingType: 1, bookingId: 1, status: 1 });
