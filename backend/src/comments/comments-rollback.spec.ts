import { ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { CommentsService } from './comments.service';

// BLG-05 / BLG-06: what happens when the post changes between the two writes
// of a comment or a like. The comment or like must never stay behind with a
// wrong counter on the post.
describe('CommentsService rollbacks (BLG-05, BLG-06)', () => {
  const userId = new Types.ObjectId().toString();
  const postId = new Types.ObjectId().toString();
  const user = { id: userId, role: 'user' as any, assignedProviderId: null };

  function setup(postOverrides: object = {}) {
    const commentId = new Types.ObjectId();
    const comments = {
      create: jest.fn().mockResolvedValue({
        _id: commentId,
        toObject: () => ({ body: 'Nice' }),
      }),
      deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    };
    const likes = {
      create: jest.fn().mockResolvedValue({}),
      deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      findOne: jest.fn().mockResolvedValue(null),
    };
    const post = {
      _id: new Types.ObjectId(postId),
      status: 'Published',
      hidden: false,
      authorId: new Types.ObjectId(),
      likeCount: 3,
      commentCount: 0,
      ...postOverrides,
    };
    const posts = {
      findOne: jest.fn().mockResolvedValue(post),
      updateOne: jest
        .fn()
        .mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    };
    const connection: any = { collection: jest.fn().mockReturnValue(posts) };
    const service = new CommentsService(
      comments as any,
      likes as any,
      connection,
    );
    return { service, comments, likes, posts, commentId };
  }

  describe('create comment', () => {
    it('deletes the comment again when the post vanished before the counter update (404)', async () => {
      const { service, comments, posts, commentId } = setup();
      posts.updateOne.mockResolvedValueOnce({ matchedCount: 0 });
      await expect(
        service.create(user, postId, { body: 'Nice' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(comments.deleteOne).toHaveBeenCalledWith({ _id: commentId });
    });

    it('deletes the comment again and rethrows when the counter update fails', async () => {
      const { service, comments, posts, commentId } = setup();
      posts.updateOne.mockRejectedValueOnce(new Error('db down'));
      await expect(
        service.create(user, postId, { body: 'Nice' }),
      ).rejects.toThrow('db down');
      expect(comments.deleteOne).toHaveBeenCalledWith({ _id: commentId });
    });
  });

  describe('like', () => {
    it('answers 409 for a second like by the same user', async () => {
      const { service, likes, posts } = setup();
      likes.create.mockRejectedValueOnce({ code: 11000 });
      await expect(service.like(user, postId)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(posts.updateOne).not.toHaveBeenCalled();
    });

    it('rethrows any other error from saving the like, without touching the counter', async () => {
      const { service, likes, posts } = setup();
      likes.create.mockRejectedValueOnce(new Error('write failed'));
      await expect(service.like(user, postId)).rejects.toThrow('write failed');
      expect(posts.updateOne).not.toHaveBeenCalled();
    });

    it('removes the like again when the post vanished before the counter update', async () => {
      const { service, likes, posts } = setup();
      posts.updateOne.mockResolvedValueOnce({ matchedCount: 0 });
      await expect(service.like(user, postId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(likes.deleteOne).toHaveBeenCalledWith({
        postId: new Types.ObjectId(postId),
        userId: new Types.ObjectId(userId),
      });
    });

    it('removes the like again when the counter update throws', async () => {
      const { service, likes, posts } = setup();
      posts.updateOne.mockRejectedValueOnce(new Error('db down'));
      await expect(service.like(user, postId)).rejects.toThrow('db down');
      expect(likes.deleteOne).toHaveBeenCalled();
    });

    it('answers 0 likes when the post cannot be re-read after liking', async () => {
      const { service, posts } = setup();
      posts.findOne
        .mockResolvedValueOnce({
          _id: new Types.ObjectId(postId),
          status: 'Published',
          hidden: false,
          authorId: new Types.ObjectId(),
        })
        .mockResolvedValueOnce(null);
      await expect(service.like(user, postId)).resolves.toEqual({
        liked: true,
        likeCount: 0,
      });
    });
  });

  describe('unlike', () => {
    it('answers 404 for an invalid post id without any query', async () => {
      const { service, posts } = setup();
      await expect(service.unlike(user, 'not-an-id')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(posts.findOne).not.toHaveBeenCalled();
    });

    it.each([
      ['a missing post', null],
      ['a draft', { status: 'Draft' }],
      ['a hidden post', { hidden: true }],
    ])('answers 404 for %s', async (_label, post) => {
      const { service, posts, likes } = setup();
      posts.findOne.mockResolvedValueOnce(
        post && {
          _id: new Types.ObjectId(postId),
          status: 'Published',
          hidden: false,
          ...post,
        },
      );
      await expect(service.unlike(user, postId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(likes.deleteOne).not.toHaveBeenCalled();
    });

    it('answers 404 when the user had not liked the post', async () => {
      const { service, likes, posts } = setup();
      likes.deleteOne.mockResolvedValueOnce({ deletedCount: 0 });
      await expect(service.unlike(user, postId)).rejects.toThrow(
        'Like not found',
      );
      expect(posts.updateOne).not.toHaveBeenCalled();
    });

    it('puts the like back and answers 409 when the counter is already 0', async () => {
      const { service, likes, posts } = setup();
      posts.updateOne.mockResolvedValueOnce({ matchedCount: 0 });
      likes.findOne.mockResolvedValueOnce({ _id: 'restored' });
      await expect(service.unlike(user, postId)).rejects.toBeInstanceOf(
        ConflictException,
      );
      // Restored once in the try block; the catch finds it and does not
      // create a duplicate.
      expect(likes.create).toHaveBeenCalledTimes(1);
    });

    it('puts the like back when the counter update throws', async () => {
      const { service, likes, posts } = setup();
      posts.updateOne.mockRejectedValueOnce(new Error('db down'));
      likes.findOne.mockResolvedValueOnce(null);
      await expect(service.unlike(user, postId)).rejects.toThrow('db down');
      expect(likes.create).toHaveBeenCalledWith({
        postId: new Types.ObjectId(postId),
        userId: new Types.ObjectId(userId),
      });
    });

    it('answers 0 likes when the post cannot be re-read after unliking', async () => {
      const { service, posts } = setup();
      posts.findOne
        .mockResolvedValueOnce({
          _id: new Types.ObjectId(postId),
          status: 'Published',
          hidden: false,
        })
        .mockResolvedValueOnce(null);
      await expect(service.unlike(user, postId)).resolves.toEqual({
        liked: false,
        likeCount: 0,
      });
    });
  });
});
