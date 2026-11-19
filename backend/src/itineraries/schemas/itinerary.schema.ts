import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { SUPPORTED_CURRENCIES } from '../../common/constants/currencies';

export const MAX_TITLE_LENGTH = 100;
export const MAX_ITINERARY_DAYS = 60;

// ITN-20: private by default; only Public itineraries appear in shared search.
export enum ItineraryVisibility {
  PUBLIC = 'Public',
  PRIVATE = 'Private',
}

// ITN-10, ITN-14: an amount in a supported currency. Amounts are in the
// currency's main unit with up to 2 decimals (150.5 EGP), not cents: they are
// planning figures in many currencies, never charged (PAY-04).
@Schema({ _id: false })
export class Money {
  @Prop({ type: Number, required: true, min: 0 })
  amount: number;

  @Prop({ type: String, enum: SUPPORTED_CURRENCIES, required: true })
  currency: string;
}
export const MoneySchema = SchemaFactory.createForClass(Money);

// ITN-10: an activity on a day. Its cost counts under Activities in the
// budget (ITN-14). Images: ITN-12.
@Schema({ _id: true })
export class Activity {
  _id: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true, maxlength: 100 })
  name: string;

  @Prop({ type: String, trim: true, maxlength: 2000, default: '' })
  description: string;

  // "HH:mm", 24-hour, optional.
  @Prop({ type: String, default: null })
  time: string | null;

  @Prop({ type: MoneySchema, default: null })
  cost: Money | null;

  @Prop({ type: [String], default: [] })
  images: string[];
}
export const ActivitySchema = SchemaFactory.createForClass(Activity);

// ITN-14: the four daily budget categories (conventions.md, "Itineraries").
// Activity costs count under Activities; intercity transport is separate.
export enum BudgetCategory {
  FOOD = 'food',
  ACCOMMODATION = 'accommodation',
  IN_CITY_TRANSPORT = 'in_city_transport',
  ACTIVITIES = 'activities',
}

@Schema({ _id: true })
export class BudgetEntry {
  _id: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(BudgetCategory), required: true })
  category: BudgetCategory;

  @Prop({ type: Number, required: true, min: 0 })
  amount: number;

  @Prop({ type: String, enum: SUPPORTED_CURRENCIES, required: true })
  currency: string;

  @Prop({ type: String, trim: true, maxlength: 200, default: '' })
  note: string;
}
export const BudgetEntrySchema = SchemaFactory.createForClass(BudgetEntry);

// ITN-05: one day of the itinerary. Its number and date are not stored: they
// are computed from its position in `days` and the itinerary's startDate
// (conventions.md, "Itineraries"). Activities and budget entries are added
// in ITN-10 and ITN-14.
@Schema({ _id: true })
export class ItineraryDay {
  _id: Types.ObjectId;

  // A seeded city id, such as "cairo".
  @Prop({ type: String, required: true })
  cityId: string;

  @Prop({ type: String, trim: true, default: '' })
  notes: string;

  @Prop({ type: [ActivitySchema], default: [] })
  activities: Activity[];

  @Prop({ type: [BudgetEntrySchema], default: [] })
  budgets: BudgetEntry[];
}
export const ItineraryDaySchema = SchemaFactory.createForClass(ItineraryDay);

// ITN-16: intercity transport, counted as its own line in the budget.
export enum TransportMode {
  FLIGHT = 'flight',
  TRAIN = 'train',
  BUS = 'bus',
  CAR = 'car',
  FERRY = 'ferry',
}

@Schema({ _id: true })
export class TransportCost {
  _id: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(TransportMode), required: true })
  mode: TransportMode;

  @Prop({ type: String, required: true })
  fromCityId: string;

  @Prop({ type: String, required: true })
  toCityId: string;

  @Prop({ type: Number, required: true, min: 0 })
  amount: number;

  @Prop({ type: String, enum: SUPPORTED_CURRENCIES, required: true })
  currency: string;

  // The day of this itinerary it belongs to; deleting the day deletes it.
  @Prop({ type: Types.ObjectId, required: true })
  dayId: Types.ObjectId;
}
export const TransportCostSchema = SchemaFactory.createForClass(TransportCost);

// ITN-27 (bonus): one of the owner's own Confirmed or Completed flight or
// hotel bookings, linked to a day. Its total (a snapshot, in the platform
// currency's main unit) feeds the budget: hotels under Accommodation,
// flights under Intercity transport. Never shown on public itineraries and
// never cloned (ITN-21).
export enum LinkedBookingType {
  FLIGHT = 'flight',
  HOTEL = 'hotel',
}

@Schema({ _id: true })
export class LinkedBooking {
  _id: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(LinkedBookingType),
    required: true,
  })
  type: LinkedBookingType;

  @Prop({ type: Types.ObjectId, required: true })
  bookingId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  dayId: Types.ObjectId;

  // FL-... or HT-...
  @Prop({ type: String, default: null })
  reference: string | null;

  // e.g. "NP101 CAI-DXB" or "Nile Hotel, 2026-12-01 to 2026-12-04"
  @Prop({ type: String, required: true })
  label: string;

  @Prop({ type: Number, required: true, min: 0 })
  amount: number;

  @Prop({ type: String, enum: SUPPORTED_CURRENCIES, required: true })
  currency: string;
}
export const LinkedBookingSchema = SchemaFactory.createForClass(LinkedBooking);

// ITN-21: a clone credits the itinerary and author it was copied from. It is
// a separate document, so deleting or changing the original never affects it.
@Schema({ _id: false })
export class ClonedFrom {
  @Prop({ type: Types.ObjectId, required: true })
  itineraryId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  authorId: Types.ObjectId;

  @Prop({ type: String, required: true })
  authorName: string;
}
export const ClonedFromSchema = SchemaFactory.createForClass(ClonedFrom);

// ITN-01. Other modules read it: Hafez (BLG-12), Emad (GEN-09, GEN-10) and Memo
// (BON-02). Reference data uses text ids: countries are country codes ("EG").
@Schema({ timestamps: true, collection: 'itineraries' })
export class Itinerary {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  ownerId: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    trim: true,
    maxlength: MAX_TITLE_LENGTH,
  })
  title: string;

  // At least one seeded country code.
  @Prop({
    type: [String],
    required: true,
    validate: {
      validator: (v: string[]) => Array.isArray(v) && v.length > 0,
      message: 'An itinerary needs at least one country',
    },
  })
  countries: string[];

  // Stored as UTC midnight of the chosen day.
  @Prop({ type: Date, required: true })
  startDate: Date;

  @Prop({
    type: String,
    enum: Object.values(ItineraryVisibility),
    default: ItineraryVisibility.PRIVATE,
    index: true,
  })
  visibility: ItineraryVisibility;

  // GEN-10: hidden by an admin after a report. Hidden itineraries are visible
  // only to their owner and admins; every public query filters them out.
  @Prop({ type: Boolean, default: false, index: true })
  hidden: boolean;

  @Prop({
    type: [ItineraryDaySchema],
    default: [],
    validate: {
      validator: (v: unknown[]) => v.length <= MAX_ITINERARY_DAYS,
      message: `An itinerary has at most ${MAX_ITINERARY_DAYS} days`,
    },
  })
  days: ItineraryDay[];

  @Prop({ type: [TransportCostSchema], default: [] })
  transportCosts: TransportCost[];

  // ITN-27 (bonus).
  @Prop({ type: [LinkedBookingSchema], default: [] })
  linkedBookings: LinkedBooking[];

  @Prop({ type: ClonedFromSchema, default: null })
  clonedFrom: ClonedFrom | null;

  createdAt: Date;
  updatedAt: Date;
}

export type ItineraryDocument = HydratedDocument<Itinerary>;
export const ItinerarySchema = SchemaFactory.createForClass(Itinerary);

// ITN-03: the owner's list, most recently updated first.
ItinerarySchema.index({ ownerId: 1, updatedAt: -1 });
