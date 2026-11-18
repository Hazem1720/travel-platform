import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { CommentsService } from './comments.service';
import { CommentSchema } from './schemas/comment.schema';
import { LikeSchema } from './schemas/like.schema';

describe('CommentsService (BLG-05 to BLG-07)', () => {
  const userId = new Types.ObjectId().toString();
  const otherUserId = new Types.ObjectId().toString();
  const postId = new Types.ObjectId().toString();
  const commentId = new Types.ObjectId().toString();

  const user = {
    id: userId,
    role: 'user' as any,
    assignedProviderId: null,
  };

  let comments: any;
  let likes: any;
  let posts: any;
  let service: CommentsService;

  beforeEach(() => {
    comments = {
      create: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(commentId),
        toObject: () => ({ body: 'Nice' }),
      }),
      findById: jest.fn(),
      deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    };

    likes = {
      create: jest.fn().mockResolvedValue({}),
      deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      findOne: jest.fn().mockResolvedValue(null),
    };

    posts = {
      findOne: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(postId),
        status: 'Published',
        hidden: false,
        authorId: new Types.ObjectId(otherUserId),
        likeCount: 0,
        commentCount: 0,
      }),
      updateOne: jest.fn().mockResolvedValue({
        matchedCount: 1,
        modifiedCount: 1,
      }),
    };

    const connection: any = {
      collection: jest.fn().mockReturnValue(posts),
    };

    service = new CommentsService(comments, likes, connection);
  });

  // BLG-05: Create comments

  it('creates a comment and increments commentCount', async () => {
    await service.create(user, postId, { body: 'Nice' });

    expect(comments.create).toHaveBeenCalledWith(
      expect.objectContaining({
        body: 'Nice',
        authorId: expect.any(Types.ObjectId),
      }),
    );

    expect(posts.updateOne).toHaveBeenCalledWith(expect.anything(), {
      $inc: { commentCount: 1 },
    });
  });

  it('trims whitespace when creating a comment', async () => {
    await service.create(user, postId, { body: '  Nice  ' });

    expect(comments.create).toHaveBeenCalledWith(
      expect.objectContaining({ body: 'Nice' }),
    );
  });

  it('rejects an empty comment', async () => {
    await expect(
      service.create(user, postId, { body: '   ' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(comments.create).not.toHaveBeenCalled();
    expect(posts.updateOne).not.toHaveBeenCalled();
  });

  it('rejects a comment longer than 500 characters', async () => {
    await expect(
      service.create(user, postId, { body: 'a'.repeat(501) }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(comments.create).not.toHaveBeenCalled();
    expect(posts.updateOne).not.toHaveBeenCalled();
  });

  it('rejects a comment when the post is not published', async () => {
    posts.findOne.mockResolvedValue({
      _id: new Types.ObjectId(postId),
      status: 'Draft',
      hidden: false,
    });

    await expect(
      service.create(user, postId, { body: 'Nice' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  // BLG-06: Like and unlike posts

  it('rejects a duplicate like and does not increment the count', async () => {
    likes.create.mockRejectedValue({ code: 11000 });

    await expect(service.like(user, postId)).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(posts.updateOne).not.toHaveBeenCalled();
  });

  it('creates a like and increments likeCount', async () => {
    await service.like(user, postId);

    expect(likes.create).toHaveBeenCalledWith({
      postId: expect.any(Types.ObjectId),
      userId: expect.any(Types.ObjectId),
    });

    expect(posts.updateOne).toHaveBeenCalledWith(expect.anything(), {
      $inc: { likeCount: 1 },
    });
  });

  it('rejects liking an unpublished post', async () => {
    posts.findOne.mockResolvedValue({
      _id: new Types.ObjectId(postId),
      status: 'Draft',
      hidden: false,
    });

    await expect(service.like(user, postId)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    expect(likes.create).not.toHaveBeenCalled();
  });

  it('rejects an invalid post id when liking', async () => {
    await expect(service.like(user, 'invalid-id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('removes a like and decrements likeCount', async () => {
    posts.findOne
      .mockResolvedValueOnce({
        _id: new Types.ObjectId(postId),
        status: 'Published',
        hidden: false,
        likeCount: 1,
      })
      .mockResolvedValueOnce({
        _id: new Types.ObjectId(postId),
        status: 'Published',
        hidden: false,
        likeCount: 0,
      });

    const result = await service.unlike(user, postId);

    expect(likes.deleteOne).toHaveBeenCalledWith({
      postId: expect.any(Types.ObjectId),
      userId: expect.any(Types.ObjectId),
    });

    expect(posts.updateOne).toHaveBeenCalledWith(expect.anything(), {
      $inc: { likeCount: -1 },
    });

    expect(result).toEqual({ liked: false, likeCount: 0 });
  });

  it('rejects unliking a post when the user has not liked it', async () => {
    likes.deleteOne.mockResolvedValue({ deletedCount: 0 });

    await expect(service.unlike(user, postId)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    expect(posts.updateOne).not.toHaveBeenCalled();
  });

  // BLG-07: Edit comments

  it('updates a comment owned by the current user', async () => {
    const save = jest.fn().mockResolvedValue(undefined);

    const comment = {
      _id: new Types.ObjectId(commentId),
      authorId: new Types.ObjectId(userId),
      body: 'Old text',
      save,
      toObject: () => ({ body: comment.body }),
    };

    comments.findById.mockResolvedValue(comment);

    await service.update(user, commentId, { body: 'New text' });

    expect(comment.body).toBe('New text');
    expect(save).toHaveBeenCalled();
  });

  it('trims whitespace when updating a comment', async () => {
    const save = jest.fn();

    const comment = {
      _id: new Types.ObjectId(commentId),
      authorId: new Types.ObjectId(userId),
      body: 'Old text',
      save,
      toObject: () => ({ body: comment.body }),
    };

    comments.findById.mockResolvedValue(comment);

    await service.update(user, commentId, { body: '  Updated  ' });

    expect(comment.body).toBe('Updated');
  });

  it('rejects an empty comment update', async () => {
    const save = jest.fn();

    comments.findById.mockResolvedValue({
      _id: new Types.ObjectId(commentId),
      authorId: new Types.ObjectId(userId),
      body: 'Old text',
      save,
    });

    await expect(
      service.update(user, commentId, { body: '   ' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(save).not.toHaveBeenCalled();
  });

  it('rejects updating a comment with more than 500 characters', async () => {
    const save = jest.fn();

    comments.findById.mockResolvedValue({
      _id: new Types.ObjectId(commentId),
      authorId: new Types.ObjectId(userId),
      body: 'Old text',
      save,
    });

    await expect(
      service.update(user, commentId, { body: 'a'.repeat(501) }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(save).not.toHaveBeenCalled();
  });

  it('prevents another user from editing a comment', async () => {
    comments.findById.mockResolvedValue({
      _id: new Types.ObjectId(commentId),
      authorId: new Types.ObjectId(otherUserId),
      body: 'Original',
      save: jest.fn(),
    });

    await expect(
      service.update(user, commentId, { body: 'Changed' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  // BLG-07: Delete comments

  it('deletes only the comment owner’s comment and decrements the count', async () => {
    comments.findById.mockResolvedValue({
      _id: new Types.ObjectId(commentId),
      authorId: new Types.ObjectId(userId),
      postId: new Types.ObjectId(postId),
    });

    await service.delete(user, commentId);

    expect(comments.deleteOne).toHaveBeenCalled();

    expect(posts.updateOne).toHaveBeenCalledWith(expect.anything(), {
      $inc: { commentCount: -1 },
    });
  });

  it('prevents another user from deleting a comment', async () => {
    comments.findById.mockResolvedValue({
      _id: new Types.ObjectId(commentId),
      authorId: new Types.ObjectId(otherUserId),
      postId: new Types.ObjectId(postId),
    });

    await expect(service.delete(user, commentId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    expect(comments.deleteOne).not.toHaveBeenCalled();
    expect(posts.updateOne).not.toHaveBeenCalled();
  });

  it('does not decrement commentCount when the comment was not deleted', async () => {
    comments.findById.mockResolvedValue({
      _id: new Types.ObjectId(commentId),
      authorId: new Types.ObjectId(userId),
      postId: new Types.ObjectId(postId),
    });

    comments.deleteOne.mockResolvedValue({ deletedCount: 0 });

    await expect(service.delete(user, commentId)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    expect(posts.updateOne).not.toHaveBeenCalled();
  });

  it('rejects an invalid comment id', async () => {
    await expect(service.delete(user, 'invalid-id')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  // Schema indexes

  it('defines a unique like per post and user', () => {
    expect(LikeSchema.indexes()).toContainEqual([
      { postId: 1, userId: 1 },
      { unique: true, background: true },
    ]);
  });

  it('indexes comments in chronological order per post', () => {
    expect(CommentSchema.indexes()).toContainEqual([
      { postId: 1, createdAt: 1 },
      { background: true },
    ]);
  });
});
