import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { CabinCategory } from '../../flights/schemas/flight.schema';
import { PassengerType } from '../flight-booking.rules';

// FLT-22, FLT-23. Read by Hasan (ACC-12, ACC-17, FLT-25, FLT-26, FLT-29),
// Hazem (FLT-05) and Moharm (ITN-26), so these field names are a contract:
// reference, userId, segments, passengers, totalAmount, status.

@Schema({ _id: false })
export class BookingExtraBag {
  @Prop({ type: Number, required: true, min: 1 })
  weightKg: number;
}
const BookingExtraBagSchema = SchemaFactory.createForClass(BookingExtraBag);

@Schema({ _id: false })
export class BookingPassenger {
  @Prop({ type: String, enum: Object.values(PassengerType), required: true })
  type: PassengerType;

  @Prop({ type: String, required: true, trim: true })
  fullName: string;

  // YYYY-MM-DD, as entered.
  @Prop({ type: String, required: true })
  dateOfBirth: string;

  @Prop({ type: String, required: true })
  passportNumber: string;

  @Prop({ type: [BookingExtraBagSchema], default: [] })
  extraBags: BookingExtraBag[];
}
const BookingPassengerSchema = SchemaFactory.createForClass(BookingPassenger);

// One flight of the booking: outbound, then the return of a round trip.
// The price fields are the snapshot taken at hold time (conventions.md):
// later price changes never affect the booking.
@Schema({ _id: false })
export class BookingSegment {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Flight', required: true })
  flightId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Airline', required: true })
  airlineId: Types.ObjectId;

  @Prop({ type: String, required: true })
  flightNumber: string;

  @Prop({ type: String, required: true })
  from: string;

  @Prop({ type: String, required: true })
  to: string;

  @Prop({ type: Date, required: true })
  departureAt: Date;

  @Prop({ type: Date, required: true })
  arrivalAt: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  cabinId: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(CabinCategory), required: true })
  cabin: CabinCategory;

  // Seats held (then booked) in this cabin: adults and children.
  @Prop({ type: Number, required: true, min: 1 })
  seats: number;

  // USD cents: per seat, all passengers' fares, extra bags, both together.
  @Prop({ type: Number, required: true })
  cabinFare: number;

  @Prop({ type: Number, required: true })
  fares: number;

  @Prop({ type: Number, required: true })
  baggageFees: number;

  @Prop({ type: Number, required: true })
  subtotal: number;
}
// Exported for FLT-27 (flight changes store the new segments).
export const BookingSegmentSchema =
  SchemaFactory.createForClass(BookingSegment);

@Schema({ timestamps: true, collection: 'flightbookings' })
export class FlightBooking {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  // FL-XXXXXXXX, set on confirmation (FLT-23); null while PendingPayment.
  @Prop({ type: String, default: null })
  reference: string | null;

  @Prop({
    type: String,
    enum: Object.values(BookingStatus),
    default: BookingStatus.PENDING_PAYMENT,
  })
  status: BookingStatus;

  @Prop({ type: [BookingSegmentSchema], required: true })
  segments: BookingSegment[];

  @Prop({ type: [BookingPassengerSchema], required: true })
  passengers: BookingPassenger[];

  // USD cents: the Stripe amount (PAY-01).
  @Prop({ type: Number, required: true, min: 1 })
  totalAmount: number;

  @Prop({ type: String, required: true, default: 'USD' })
  currency: string;

  // End of the 10-minute hold while PendingPayment (FLT-22).
  @Prop({ type: Date, default: null })
  expiresAt: Date | null;

  // PAY-02: set by Memo's accept-policies route; payment needs it.
  @Prop({ type: Date, default: null })
  policiesAcceptedAt: Date | null;

  @Prop({ type: Date, default: null })
  confirmedAt: Date | null;

  @Prop({ type: Date, default: null })
  expiredAt: Date | null;

  @Prop({ type: Date, default: null })
  cancelledAt: Date | null;

  // GEN-11: set when the last segment has landed.
  @Prop({ type: Date, default: null })
  completedAt: Date | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export type FlightBookingDocument = HydratedDocument<FlightBooking>;
export const FlightBookingSchema = SchemaFactory.createForClass(FlightBooking);

// FLT-23: references are unique; PendingPayment bookings have none yet.
FlightBookingSchema.index(
  { reference: 1 },
  { unique: true, partialFilterExpression: { reference: { $type: 'string' } } },
);
// The expiry job and "release this flight's expired holds" (FLT-22).
FlightBookingSchema.index({ status: 1, expiresAt: 1 });
FlightBookingSchema.index({ 'segments.flightId': 1, status: 1 });
// "My bookings" (Hasan, FLT-25) and hasUpcomingConfirmed (ACC-12).
FlightBookingSchema.index({ userId: 1, status: 1, createdAt: -1 });
