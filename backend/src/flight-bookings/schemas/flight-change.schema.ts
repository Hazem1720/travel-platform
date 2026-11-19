import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { BookingSegment, BookingSegmentSchema } from './flight-booking.schema';

// FLT-27 (bonus): one change of a Confirmed flight booking. The new seats
// are held while it waits for the fare difference (PendingPayment, 10
// minutes like a booking hold); Confirmed once applied to the booking,
// Expired if not paid in time, Cancelled if the booking changed meanwhile.
@Schema({ timestamps: true, collection: 'flightchanges' })
export class FlightChange {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'FlightBooking',
    required: true,
  })
  bookingId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({
    type: String,
    enum: [
      BookingStatus.PENDING_PAYMENT,
      BookingStatus.CONFIRMED,
      BookingStatus.EXPIRED,
      BookingStatus.CANCELLED,
    ],
    required: true,
  })
  status: BookingStatus;

  // The booking's segments before and after; `changed` lists the indexes
  // that move to another flight (0 outbound, 1 return).
  @Prop({ type: [BookingSegmentSchema], required: true })
  oldSegments: BookingSegment[];

  @Prop({ type: [BookingSegmentSchema], required: true })
  segments: BookingSegment[];

  @Prop({ type: [Number], required: true })
  changed: number[];

  // Seats per segment (adults and children).
  @Prop({ type: Number, required: true, min: 1 })
  seats: number;

  // USD cents.
  @Prop({ type: Number, required: true })
  oldTotal: number;

  @Prop({ type: Number, required: true })
  newTotal: number;

  // newTotal - oldTotal: paid with Stripe when positive, refunded when
  // negative.
  @Prop({ type: Number, required: true })
  difference: number;

  @Prop({ type: String, required: true, default: 'USD' })
  currency: string;

  @Prop({ type: Date, default: null })
  expiresAt: Date | null;

  @Prop({ type: Date, default: null })
  appliedAt: Date | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export type FlightChangeDocument = HydratedDocument<FlightChange>;
export type LeanFlightChange = FlightChange & { _id: Types.ObjectId };
export const FlightChangeSchema = SchemaFactory.createForClass(FlightChange);

// One change waiting for payment per booking; the expiry job.
FlightChangeSchema.index(
  { bookingId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: BookingStatus.PENDING_PAYMENT },
  },
);
FlightChangeSchema.index({ status: 1, expiresAt: 1 });
