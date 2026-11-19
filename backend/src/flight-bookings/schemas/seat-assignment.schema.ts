import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

// FLT-28 (bonus): one seat of one cabin of one flight, given to one
// passenger of one booking segment. The unique index on (flight, cabin,
// seat) makes two passengers choosing the same seat at the same moment end
// with one success and one 409.
@Schema({ timestamps: true, collection: 'seatassignments' })
export class SeatAssignment {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Flight', required: true })
  flightId: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  cabinId: Types.ObjectId;

  // e.g. "12A"
  @Prop({ type: String, required: true })
  seat: string;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'FlightBooking',
    required: true,
  })
  bookingId: Types.ObjectId;

  // 0 = outbound, 1 = return (FLT-12).
  @Prop({ type: Number, required: true, min: 0 })
  segment: number;

  // Index in the booking's passengers.
  @Prop({ type: Number, required: true, min: 0 })
  passengerIndex: number;
}

export type SeatAssignmentDocument = HydratedDocument<SeatAssignment>;
export const SeatAssignmentSchema =
  SchemaFactory.createForClass(SeatAssignment);
SeatAssignmentSchema.index(
  { flightId: 1, cabinId: 1, seat: 1 },
  { unique: true },
);
SeatAssignmentSchema.index(
  { bookingId: 1, segment: 1, passengerIndex: 1 },
  { unique: true },
);
