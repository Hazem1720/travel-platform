
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

// BLG-01: A post can be saved as a draft or published.
export enum PostStatus {
  DRAFT = 'Draft',
  PUBLISHED = 'Published',
}

export type PostDocument = HydratedDocument<Post>;

@Schema({ timestamps: true, collection: 'posts' })
export class Post {
  // The user who created this post.
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  authorId: Types.ObjectId;

  // The post title.
  @Prop({ type: String, required: true, trim: true })
  title: string;

  // The main content of the post.
  @Prop({ type: String, required: true, trim: true })
  body: string;

  // BLG-01 / BLG-08: Up to 5 tags, each with a maximum of 30 characters.
  @Prop({
    type: [String],
    default: [],
    validate: {
      validator: (tags: string[]) =>
        Array.isArray(tags) &&
        tags.length <= 5 &&
        tags.every((tag) => typeof tag === 'string' && tag.trim().length <= 30),
      message: 'A post can have at most 5 tags, each up to 30 characters',
    },
  })
  tags: string[];

  // BLG-01 / BLG-10: Up to 5 image URLs.
  @Prop({
    type: [String],
    default: [],
    validate: {
      validator: (images: string[]) =>
        Array.isArray(images) && images.length <= 5,
      message: 'A post can have at most 5 images',
    },
  })
  images: string[];

  // New posts are drafts unless explicitly published.
  @Prop({
    type: String,
    enum: Object.values(PostStatus),
    default: PostStatus.DRAFT,
    index: true,
  })
  status: PostStatus;

  // Records when the post was published.
  @Prop({ type: Date, default: null, index: true })
  publishedAt: Date | null;

  // Number of likes on the post.
  @Prop({ type: Number, default: 0, min: 0 })
  likeCount: number;

  // Number of comments on the post.
  @Prop({ type: Number, default: 0, min: 0 })
  commentCount: number;

  // Hidden posts are excluded from public queries.
  @Prop({ type: Boolean, default: false, index: true })
  hidden: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export const PostSchema = SchemaFactory.createForClass(Post);
