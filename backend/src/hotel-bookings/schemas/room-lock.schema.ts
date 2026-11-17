import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

// Why a room night is taken (conventions.md, "Overlap safety").
export enum RoomLockKind {
  // A PendingPayment reservation's 10-minute hold (HTL-18). Free again once
  // expiresAt has passed, even before the expiry job deletes it.
  HELD = 'Held',
  // A Confirmed reservation (HTL-17).
  BOOKED = 'Booked',
  // Blocked by the hotel moderator (HTL-06).
  BLOCKED = 'Blocked',
}

// HTL-11, HTL-18, HTL-06: one document per room per night. The unique index
// on (roomId, date) is what makes holds, bookings and blocks safe when two
// requests arrive at once: only one of them can insert a given room night.
// `date` is the night's check-in day as "YYYY-MM-DD", the same format as
// Room.bookableRanges (HTL-04), so the night of 10 Dec is "2026-12-10".
@Schema({ timestamps: true, collection: 'roomlocks' })
export class RoomLock {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Room', required: true })
  roomId: Types.ObjectId;

  // Copied from the room so a hotel's locks can be read in one query (HTL-08).
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Hotel', required: true })
  hotelId: Types.ObjectId;

  @Prop({ type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ })
  date: string;

  @Prop({ type: String, enum: Object.values(RoomLockKind), required: true })
  kind: RoomLockKind;

  // The reservation that holds or booked the night; null for Blocked.
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'HotelBooking',
    default: null,
    required(this: RoomLock) {
      return this.kind !== RoomLockKind.BLOCKED;
    },
  })
  bookingId: Types.ObjectId | null;

  // End of the hold, for Held only.
  @Prop({
    type: Date,
    default: null,
    required(this: RoomLock) {
      return this.kind === RoomLockKind.HELD;
    },
  })
  expiresAt: Date | null;
}

export type RoomLockDocument = HydratedDocument<RoomLock>;
export const RoomLockSchema = SchemaFactory.createForClass(RoomLock);
RoomLockSchema.index({ roomId: 1, date: 1 }, { unique: true });
// HTL-08 (a hotel's calendar), confirming or releasing one reservation's
// nights, and the expiry job looking for dead holds.
RoomLockSchema.index({ hotelId: 1, date: 1 });
RoomLockSchema.index({ bookingId: 1 });
RoomLockSchema.index({ kind: 1, expiresAt: 1 });
