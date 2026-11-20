import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
@Schema({ timestamps: true, collection: 'likes' })
export class Like {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  postId: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;
}
export type LikeDocument = HydratedDocument<Like>;
export const LikeSchema = SchemaFactory.createForClass(Like);
LikeSchema.index({ postId: 1, userId: 1 }, { unique: true });
