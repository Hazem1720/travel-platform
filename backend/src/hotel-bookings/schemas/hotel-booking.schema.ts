import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { platformCurrencyProp } from '../../common/helpers/money';

// One room of a reservation (HTL-16): who stays in it and the price snapshot
// taken at booking time (conventions.md, P-5), so a later price change never
// alters the reservation.
@Schema({ _id: false })
export class BookedRoom {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Room', required: true })
  roomId: Types.ObjectId;

  // Copied from the room for confirmation pages and lists.
  @Prop({ type: String, required: true })
  name: string;

  @Prop({ type: String, required: true })
  type: string;

  @Prop({ type: Number, required: true, min: 0 })
  adults: number;

  // Ages 0 to 17 (HTL-16).
  @Prop({ type: [Number], default: [] })
  childAges: number[];

  // USD cents at booking time.
  @Prop({ type: Number, required: true, min: 1 })
  pricePerNight: number;

  // nights x pricePerNight.
  @Prop({ type: Number, required: true, min: 1 })
  subtotal: number;
}
const BookedRoomSchema = SchemaFactory.createForClass(BookedRoom);

// HTL-16, HTL-18 (Memo): a hotel reservation. Created PendingPayment with a
// 10-minute hold (its rooms' nights are Held RoomLocks with the same
// bookingId); Confirmed after payment (HTL-17); Expired when the hold runs
// out. Read by Hasan (HTL-20 to HTL-24, ACC-17) and by PAY-01 to PAY-03.
@Schema({ timestamps: true, collection: 'hotelbookings' })
export class HotelBooking {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Hotel', required: true })
  hotelId: Types.ObjectId;

  // Copied from the hotel at booking time.
  @Prop({ type: String, required: true })
  hotelName: string;

  // HT-XXXXXXXX, set on confirmation (HTL-17); null while PendingPayment.
  @Prop({ type: String, default: null })
  reference: string | null;

  @Prop({
    type: String,
    enum: Object.values(BookingStatus),
    default: BookingStatus.PENDING_PAYMENT,
  })
  status: BookingStatus;

  // YYYY-MM-DD, the hotel's local dates; the nights are checkIn up to, not
  // including, checkOut.
  @Prop({ type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ })
  checkIn: string;

  @Prop({ type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ })
  checkOut: string;

  @Prop({ type: Number, required: true, min: 1 })
  nights: number;

  @Prop({ type: [BookedRoomSchema], required: true })
  rooms: BookedRoom[];

  // USD cents: the sum of the rooms' subtotals, what Stripe charges (PAY-01).
  @Prop({ type: Number, required: true, min: 1 })
  totalAmount: number;

  @Prop(platformCurrencyProp())
  currency: string;

  // End of the 10-minute hold while PendingPayment (HTL-18).
  @Prop({ type: Date, default: null })
  expiresAt: Date | null;

  // PAY-02: when the user accepted the hotel's policies; payment needs it.
  @Prop({ type: Date, default: null })
  policiesAcceptedAt: Date | null;

  @Prop({ type: Date, default: null })
  confirmedAt: Date | null;

  @Prop({ type: Date, default: null })
  expiredAt: Date | null;

  @Prop({ type: Date, default: null })
  cancelledAt: Date | null;

  @Prop({ type: Date, default: null })
  completedAt: Date | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export type HotelBookingDocument = HydratedDocument<HotelBooking>;
export const HotelBookingSchema = SchemaFactory.createForClass(HotelBooking);

// HTL-17: references are unique; PendingPayment reservations have none yet.
HotelBookingSchema.index(
  { reference: 1 },
  { unique: true, partialFilterExpression: { reference: { $type: 'string' } } },
);
// The hold-expiry job (HTL-18).
HotelBookingSchema.index({ status: 1, expiresAt: 1 });
// "My reservations" (Hasan, HTL-20) and ACC-12's upcoming-bookings check.
HotelBookingSchema.index({ userId: 1, status: 1, createdAt: -1 });
// A hotel's reservations (Hasan, HTL-22).
HotelBookingSchema.index({ hotelId: 1, checkIn: 1 });
