import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export const MAX_POST_TAGS = 5;
export const MAX_TAG_LENGTH = 30;

// BLG-01: A post can be saved as a draft or published.
export enum PostStatus {
  DRAFT = 'Draft',
  PUBLISHED = 'Published',
}

export type PostDocument = HydratedDocument<Post>;

@Schema({ timestamps: true, collection: 'posts' })
export class Post {
  // The user who created this post.
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
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
        tags.length <= MAX_POST_TAGS &&
        tags.every(
          (tag) =>
            typeof tag === 'string' && tag.trim().length <= MAX_TAG_LENGTH,
        ),
      message: 'A post can have at most 5 tags, each up to 30 characters',
    },
  })
  tags: string[];

  // BLG-10: Up to 5 image URLs, added only through the upload route (GEN-08).
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

  // Records when the post was first published.
  @Prop({ type: Date, default: null, index: true })
  publishedAt: Date | null;

  // Number of likes on the post (BLG-06 keeps it up to date).
  @Prop({ type: Number, default: 0, min: 0 })
  likeCount: number;

  // Number of comments on the post (BLG-05 keeps it up to date).
  @Prop({ type: Number, default: 0, min: 0 })
  commentCount: number;

  // BLG-13 (bonus): one of the author's own public itineraries, shown on the
  // post page while it stays public and visible.
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Itinerary',
    default: null,
  })
  itineraryId: Types.ObjectId | null;

  // GEN-10: hidden posts are visible only to their author and admins.
  @Prop({ type: Boolean, default: false, index: true })
  hidden: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export const PostSchema = SchemaFactory.createForClass(Post);
// BLG-02 and BLG-08: published, visible posts, newest first; tag lookups.
PostSchema.index({ status: 1, hidden: 1, publishedAt: -1 });
PostSchema.index({ tags: 1 });
