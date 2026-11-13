import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import {
  CancellationTier,
  CancellationTierSchema,
} from '../../common/helpers/cancellation-tiers';

export const AIRLINE_CODE = /^[A-Z0-9]{2,3}$/;

// FLT-01 (profile), ACC-15 (isActive), FLT-08 (baggage), FLT-09 (tiers).
// Fields as in docs/api/conventions.md, "Flights (FLT)".
@Schema({ timestamps: true, collection: 'airlines' })
export class Airline {
  @Prop({ required: true, trim: true, maxlength: 100 })
  name: string;

  // IATA (2) or ICAO (3) style code, stored uppercase, unique (409 if taken).
  @Prop({
    required: true,
    unique: true,
    uppercase: true,
    trim: true,
    match: AIRLINE_CODE,
  })
  code: string;

  // URL of the logo image (GEN-08 upload), or null.
  @Prop({ type: String, default: null })
  logo: string | null;

  // ACC-15: an inactive airline's flights are hidden from search and new
  // bookings; existing Confirmed bookings stay valid.
  @Prop({ type: Boolean, default: true, index: true })
  isActive: boolean;

  // FLT-08: price per extra bag in USD cents (> 0), null until the policy is
  // set; maxExtraBags per passenger (>= 0). An extra bag has the cabin's
  // maxKgPerBag limit.
  @Prop({ type: Number, default: null, min: 1 })
  extraBagPrice: number | null;

  @Prop({ type: Number, default: 0, min: 0 })
  maxExtraBags: number;

  // FLT-09: [{ daysBefore, refundPercent }], unique daysBefore.
  @Prop({ type: [CancellationTierSchema], default: [] })
  cancellationTiers: CancellationTier[];
}

export type AirlineDocument = HydratedDocument<Airline>;
export const AirlineSchema = SchemaFactory.createForClass(Airline);
