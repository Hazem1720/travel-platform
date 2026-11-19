import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export const MAX_COMMENT_LENGTH = 500;

@Schema({ timestamps: true, collection: 'comments' })
export class Comment {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    required: true,
    index: true,
  })
  postId: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  authorId: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    trim: true,
    maxlength: MAX_COMMENT_LENGTH,
  })
  body: string;

  @Prop({ type: Boolean, default: false, index: true })
  hidden: boolean;

  createdAt?: Date;
  updatedAt?: Date;
}

export type CommentDocument = HydratedDocument<Comment>;

export const CommentSchema = SchemaFactory.createForClass(Comment);

CommentSchema.index({ postId: 1, createdAt: 1 });
