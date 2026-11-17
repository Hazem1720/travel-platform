import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

// HTL-04: one bookable date range, as whole dates "YYYY-MM-DD".
// `from` is the first night and `to` is the day AFTER the last night, so
// { from: '2026-12-01', to: '2027-01-01' } covers the 31 nights of December.
// Two ranges of the same room may touch (one ends the day the next starts)
// but never overlap. Memo's availability query reads this exact format.
export class BookableRange {
  from: string;
  to: string;
}

// HTL-03 (the room), HTL-04 (bookableRanges), HTL-05 (edits), HTL-06 (isActive).
// Rooms are a separate collection so they can be locked and searched on their
// own (conventions.md, "Hotels (HTL)").
@Schema({ timestamps: true, collection: 'rooms' })
export class Room {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Hotel',
    required: true,
    index: true,
  })
  hotelId: Types.ObjectId;

  // Room number or name, unique within the hotel (compound index below).
  @Prop({ required: true, trim: true, maxlength: 50 })
  name: string;

  @Prop({ required: true, trim: true, maxlength: 50 })
  type: string;

  @Prop({ type: Number, required: true, min: 1 })
  beds: number;

  @Prop({ type: Number, required: true, min: 1 })
  maxOccupancy: number;

  // USD cents, greater than 0 (PAY-04).
  @Prop({ type: Number, required: true, min: 1 })
  pricePerNight: number;

  @Prop({
    type: [{ _id: false, from: { type: String }, to: { type: String } }],
    default: [],
  })
  bookableRanges: BookableRange[];

  @Prop({ type: Boolean, default: true })
  isActive: boolean;
}

export type RoomDocument = HydratedDocument<Room>;
export const RoomSchema = SchemaFactory.createForClass(Room);
// A duplicate name in the same hotel is a duplicate-key error, which the
// global filter turns into 409 (also when two requests arrive at once).
RoomSchema.index({ hotelId: 1, name: 1 }, { unique: true });
