import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, isValidObjectId, Model, Types } from 'mongoose';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto';
import { paginated } from '../common/pagination/pagination.helper';
import { AuthUser } from '../common/types/auth-user.type';
import {
  Comment,
  CommentDocument,
  MAX_COMMENT_LENGTH,
} from './schemas/comment.schema';
import { Like, LikeDocument } from './schemas/like.schema';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';

export const DELETED_USER = 'Deleted user';

@Injectable()
export class CommentsService {
  constructor(
    @InjectModel(Comment.name)
    private readonly comments: Model<CommentDocument>,
    @InjectModel(Like.name) private readonly likes: Model<LikeDocument>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async create(user: AuthUser, postId: string, dto: CreateCommentDto) {
    const post = await this.findVisiblePublishedPost(postId, user.id);
    const body = this.validateCommentBody(dto.body);

    const comment = await this.comments.create({
      postId: post._id,
      authorId: new Types.ObjectId(user.id),
      body,
    });

    try {
      const result = await this.connection
        .collection('posts')
        .updateOne({ _id: post._id }, { $inc: { commentCount: 1 } });

      if (result.matchedCount !== 1) {
        await this.comments.deleteOne({ _id: comment._id });
        throw new NotFoundException('Post not found');
      }
    } catch (error) {
      await this.comments.deleteOne({ _id: comment._id });
      throw error;
    }

    return comment.toObject();
  }

  // BLG-02 and BLG-05: the visible comments of a published, visible post,
  // oldest first. Hidden comments (GEN-10) are left out; a deactivated
  // author is shown as "Deleted user" (ACC-12).
  async listForPost(postId: string, query: PaginationQueryDto) {
    const post = await this.findVisiblePublishedPost(postId, '');
    const filter = { postId: post._id, hidden: { $ne: true } };
    const [rows, total] = await Promise.all([
      this.comments
        .find(filter)
        .sort({ createdAt: 1, _id: 1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      this.comments.countDocuments(filter),
    ]);

    const authors = await this.connection
      .collection('users')
      .find(
        { _id: { $in: rows.map((c) => c.authorId) } },
        { projection: { name: 1, status: 1 } },
      )
      .toArray();
    const byId = new Map(authors.map((a) => [String(a._id), a]));

    const data = rows.map((c) => {
      const author = byId.get(String(c.authorId));
      const gone = !author || author.status === 'deactivated';
      return {
        _id: c._id,
        postId: c.postId,
        body: c.body,
        author: gone
          ? { id: null, name: DELETED_USER }
          : { id: c.authorId, name: String(author?.name ?? '') },
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      };
    });
    return paginated(data, total, query.page, query.limit);
  }

  // BLG-04 and GEN-10: when a post is deleted, its comments and likes go too.
  async removeForPost(postId: Types.ObjectId | string) {
    const id = new Types.ObjectId(String(postId));
    await Promise.all([
      this.comments.deleteMany({ postId: id }),
      this.likes.deleteMany({ postId: id }),
    ]);
  }

  async like(user: AuthUser, postId: string) {
    const post = await this.findVisiblePublishedPost(postId, user.id);

    try {
      await this.likes.create({
        postId: post._id,
        userId: new Types.ObjectId(user.id),
      });
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new ConflictException('You have already liked this post');
      }
      throw error;
    }

    try {
      const result = await this.connection
        .collection('posts')
        .updateOne({ _id: post._id }, { $inc: { likeCount: 1 } });

      if (result.matchedCount !== 1) {
        await this.likes.deleteOne({
          postId: post._id,
          userId: new Types.ObjectId(user.id),
        });
        throw new NotFoundException('Post not found');
      }
    } catch (error) {
      await this.likes.deleteOne({
        postId: post._id,
        userId: new Types.ObjectId(user.id),
      });
      throw error;
    }

    const updatedPost = await this.connection
      .collection('posts')
      .findOne({ _id: post._id });

    return { liked: true, likeCount: updatedPost?.likeCount ?? 0 };
  }

  async unlike(user: AuthUser, postId: string) {
    if (!isValidObjectId(postId)) {
      throw new NotFoundException('Post not found');
    }

    const postObjectId = new Types.ObjectId(postId);
    const post = await this.connection
      .collection('posts')
      .findOne({ _id: postObjectId });

    if (!post || post.status !== 'Published' || post.hidden) {
      throw new NotFoundException('Post not found');
    }

    const userObjectId = new Types.ObjectId(user.id);

    const result = await this.likes.deleteOne({
      postId: postObjectId,
      userId: userObjectId,
    });

    if (!result.deletedCount) {
      throw new NotFoundException('Like not found');
    }

    try {
      const updateResult = await this.connection
        .collection('posts')
        .updateOne(
          { _id: postObjectId, likeCount: { $gt: 0 } },
          { $inc: { likeCount: -1 } },
        );

      if (updateResult.matchedCount !== 1) {
        await this.likes.create({
          postId: postObjectId,
          userId: userObjectId,
        });
        throw new ConflictException('Post like count could not be updated');
      }
    } catch (error) {
      const existingLike = await this.likes.findOne({
        postId: postObjectId,
        userId: userObjectId,
      });

      if (!existingLike) {
        await this.likes.create({
          postId: postObjectId,
          userId: userObjectId,
        });
      }

      throw error;
    }

    const updatedPost = await this.connection
      .collection('posts')
      .findOne({ _id: postObjectId });

    return { liked: false, likeCount: updatedPost?.likeCount ?? 0 };
  }

  async update(user: AuthUser, id: string, dto: UpdateCommentDto) {
    const comment = await this.findComment(id);

    if (String(comment.authorId) !== user.id) {
      throw new ForbiddenException('You can only edit your own comments');
    }

    comment.body = this.validateCommentBody(dto.body);
    await comment.save();

    return comment.toObject();
  }

  async delete(user: AuthUser, id: string) {
    const comment = await this.findComment(id);

    if (String(comment.authorId) !== user.id) {
      throw new ForbiddenException('You can only delete your own comments');
    }

    const result = await this.comments.deleteOne({
      _id: comment._id,
      authorId: new Types.ObjectId(user.id),
    });

    if (result.deletedCount !== 1) {
      throw new NotFoundException('Comment not found');
    }

    await this.connection
      .collection('posts')
      .updateOne(
        { _id: comment.postId, commentCount: { $gt: 0 } },
        { $inc: { commentCount: -1 } },
      );

    return { success: true };
  }

  private validateCommentBody(body: string): string {
    const trimmedBody = body.trim();

    if (!trimmedBody) {
      throw new BadRequestException('Comment cannot be empty');
    }

    if (trimmedBody.length > MAX_COMMENT_LENGTH) {
      throw new BadRequestException(
        `Comment cannot exceed ${MAX_COMMENT_LENGTH} characters`,
      );
    }

    return trimmedBody;
  }

  private async findComment(id: string) {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid comment id');
    }

    const comment = await this.comments.findById(id);

    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    return comment;
  }

  private async findVisiblePublishedPost(id: string, userId: string) {
    if (!isValidObjectId(id)) {
      throw new NotFoundException('Post not found');
    }

    const post = await this.connection
      .collection('posts')
      .findOne({ _id: new Types.ObjectId(id) });

    if (
      !post ||
      post.status !== 'Published' ||
      (post.hidden && String(post.authorId) !== userId)
    ) {
      throw new NotFoundException('Post not found');
    }

    return post;
  }
}
