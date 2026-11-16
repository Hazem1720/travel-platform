import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import {
  CancellationTier,
  CancellationTierSchema,
} from '../../common/helpers/cancellation-tiers';

export const MAX_HOTEL_IMAGES = 5;
export const DEFAULT_CHECK_IN_TIME = '14:00';
export const DEFAULT_CHECK_OUT_TIME = '12:00';

// HTL-01 (profile), HTL-09 (check-in/out times), HTL-10 (cancellation tiers),
// ACC-15 (isActive). Fields as in docs/api/conventions.md, "Hotels (HTL)".
// Other modules use it: Hazem (ACC-13, ACC-15), Memo (HTL-11, HTL-23) and
// Moharm (ITN-25).
@Schema({ timestamps: true, collection: 'hotels' })
export class Hotel {
  @Prop({ required: true, trim: true, maxlength: 120 })
  name: string;

  @Prop({ required: true, trim: true, maxlength: 250 })
  address: string;

  // Reference data uses text ids: a city id such as "cairo" and the country
  // code of that city, such as "EG" (conventions.md, "Reference data").
  @Prop({ type: String, required: true, index: true })
  cityId: string;

  @Prop({ type: String, required: true, index: true })
  countryCode: string;

  @Prop({ trim: true, maxlength: 2000, default: '' })
  description: string;

  // Photo URLs (GEN-08 upload), at most MAX_HOTEL_IMAGES.
  @Prop({ type: [String], default: [] })
  images: string[];

  // Whole number from 1 to 5.
  @Prop({ type: Number, required: true, min: 1, max: 5 })
  starClass: number;

  @Prop({ type: [String], default: [] })
  amenities: string[];

  // ACC-15: an inactive hotel is hidden from search and cannot be booked;
  // its Confirmed reservations stay valid.
  @Prop({ type: Boolean, default: true, index: true })
  isActive: boolean;

  // HTL-09: "HH:mm", 24-hour.
  @Prop({ type: String, default: DEFAULT_CHECK_IN_TIME })
  checkInTime: string;

  @Prop({ type: String, default: DEFAULT_CHECK_OUT_TIME })
  checkOutTime: string;

  // HTL-10: [{ daysBefore, refundPercent }], unique daysBefore.
  @Prop({ type: [CancellationTierSchema], default: [] })
  cancellationTiers: CancellationTier[];

  // Written only by Memo's review routes (HTL-23). Never by this module.
  @Prop({ type: Number, default: 0, min: 0, max: 5 })
  ratingAverage: number;

  @Prop({ type: Number, default: 0, min: 0 })
  ratingCount: number;
}

export type HotelDocument = HydratedDocument<Hotel>;
export const HotelSchema = SchemaFactory.createForClass(Hotel);
