import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export enum FavouriteType {
  HOTEL = 'hotel',
  ITINERARY = 'itinerary',
}

// BON-02 (Memo): a hotel or a public itinerary a user saved.
@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'favourites',
})
export class Favourite {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(FavouriteType), required: true })
  type: FavouriteType;

  // The hotel's or the itinerary's _id.
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  targetId: Types.ObjectId;

  createdAt?: Date;
}

export type FavouriteDocument = HydratedDocument<Favourite>;
export type LeanFavourite = Favourite & { _id: Types.ObjectId };
export const FavouriteSchema = SchemaFactory.createForClass(Favourite);

// Saving the same hotel or itinerary twice is refused (409).
FavouriteSchema.index({ userId: 1, type: 1, targetId: 1 }, { unique: true });
// The user's list, newest first.
FavouriteSchema.index({ userId: 1, createdAt: -1 });
