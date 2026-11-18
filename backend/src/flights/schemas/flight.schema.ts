import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

// FLT-30: only Scheduled flights are searchable, editable or bookable.
export enum FlightStatus {
  SCHEDULED = 'Scheduled',
  CANCELLED = 'Cancelled',
  DEPARTED = 'Departed',
}

// FLT-04: the fixed cabin set (conventions.md, "Flights (FLT)").
export enum CabinCategory {
  ECONOMY = 'Economy',
  PREMIUM_ECONOMY = 'Premium Economy',
  BUSINESS = 'Business',
  FIRST = 'First',
}

// FLT-04: one cabin, embedded in the flight. Prices are USD cents (PAY-04).
// Available seats = totalSeats - bookedSeats - heldSeats. bookedSeats and
// heldSeats start at 0, never come from the client, and change only through
// one atomic conditional update on the flight (Aabsy's holds, FLT-22/23).
@Schema({ _id: true })
export class Cabin {
  _id: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(CabinCategory), required: true })
  category: CabinCategory;

  @Prop({ type: Number, required: true, min: 1 })
  totalSeats: number;

  @Prop({ type: Number, default: 0, min: 0 })
  bookedSeats: number;

  @Prop({ type: Number, default: 0, min: 0 })
  heldSeats: number;

  @Prop({ type: Number, required: true, min: 1 })
  price: number;

  // Free checked bags per passenger and the weight limit of each bag (an
  // extra bag, FLT-08, has the same limit).
  @Prop({ type: Number, required: true, min: 0 })
  freeBags: number;

  @Prop({ type: Number, required: true, min: 1 })
  maxKgPerBag: number;
}
export const CabinSchema = SchemaFactory.createForClass(Cabin);

// FLT-03. Times are stored in UTC; the airports' IANA time zones turn them
// back into local times in every response (GEN-06).
@Schema({ timestamps: true, collection: 'flights' })
export class Flight {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Airline',
    required: true,
    index: true,
  })
  airlineId: Types.ObjectId;

  // Such as NP101: stored uppercase.
  @Prop({ type: String, required: true, uppercase: true, trim: true })
  flightNumber: string;

  // IATA codes from the airport list (FLT-02).
  @Prop({ type: String, required: true, uppercase: true })
  from: string;

  @Prop({ type: String, required: true, uppercase: true })
  to: string;

  @Prop({ type: Date, required: true })
  departureAt: Date;

  @Prop({ type: Date, required: true })
  arrivalAt: Date;

  // Local calendar date at the departure airport ("2026-12-01"): the "same
  // departure date" of the duplicate rule (unique index below).
  @Prop({ type: String, required: true })
  departureDate: string;

  @Prop({
    type: String,
    enum: Object.values(FlightStatus),
    default: FlightStatus.SCHEDULED,
  })
  status: FlightStatus;

  @Prop({ type: [CabinSchema], default: [] })
  cabins: Cabin[];

  createdAt?: Date;
  updatedAt?: Date;
}

export type FlightDocument = HydratedDocument<Flight>;
export const FlightSchema = SchemaFactory.createForClass(Flight);

// FLT-03: one flight number per airline per local departure date. The index
// also stops two requests creating the same flight at the same moment.
FlightSchema.index(
  { airlineId: 1, flightNumber: 1, departureDate: 1 },
  { unique: true },
);
// Search (FLT-11) and the Departed job (FLT-30).
FlightSchema.index({ from: 1, to: 1, status: 1, departureAt: 1 });
FlightSchema.index({ status: 1, departureAt: 1 });
