import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export const MIN_RATING = 1;
export const MAX_RATING = 5;
export const MAX_REVIEW_TEXT = 1000;

// HTL-23 (schema only): one rating (1-5) and an optional review text per
// Completed hotel reservation, whatever the number of rooms. Published first
// so others can build on it:
// - Hasan adds the routes (POST /hotel-bookings/:id/review, PATCH and DELETE
//   /reviews/:id) and keeps Hotel.ratingAverage / ratingCount up to date
//   (HTL-23), and lists them (HTL-24).
// - Rawda shows the newest visible reviews on the hotel page (HTL-02).
// - Hafez reports, hides and deletes them (GEN-09, GEN-10).
// Every public list must filter `hidden: false`: hidden reviews are visible
// only to their author and admins (conventions.md, "Reports and hidden
// content"). The rating of a hidden review still counts in the average.
@Schema({ timestamps: true, collection: 'reviews' })
export class Review {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Hotel',
    required: true,
  })
  hotelId: Types.ObjectId;

  // The Completed reservation being reviewed. Unique: one review per
  // reservation; a second one is a duplicate key, which the global filter
  // turns into 409.
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'HotelBooking',
    required: true,
  })
  bookingId: Types.ObjectId;

  // The author, the reservation's owner.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  // A whole number from 1 to 5.
  @Prop({
    type: Number,
    required: true,
    min: MIN_RATING,
    max: MAX_RATING,
    validate: {
      validator: Number.isInteger,
      message: 'rating must be a whole number',
    },
  })
  rating: number;

  // Optional review text, at most 1000 characters; empty when only rated.
  @Prop({ type: String, trim: true, default: '', maxlength: MAX_REVIEW_TEXT })
  text: string;

  // GEN-10: set by an admin (directly or when resolving a report).
  @Prop({ type: Boolean, default: false })
  hidden: boolean;
}

export type ReviewDocument = HydratedDocument<Review>;
export const ReviewSchema = SchemaFactory.createForClass(Review);
ReviewSchema.index({ bookingId: 1 }, { unique: true });
// HTL-24 and HTL-02: a hotel's visible reviews, newest first.
ReviewSchema.index({ hotelId: 1, hidden: 1, createdAt: -1 });
// ACC-12 ("Deleted user") and a user's own reviews.
ReviewSchema.index({ userId: 1 });
