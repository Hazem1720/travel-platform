
/// <reference types="jest" />
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { Role } from '../common/enums/role.enum';
import { AuthUser } from '../common/types/auth-user.type';
import { UploadedImage } from '../uploads/image-file';
import { UploadsService } from '../uploads/uploads.service';
import { BlogService } from './blog.service';
import { UpdatePostDto } from './dto/update-post.dto';

const authorId = new Types.ObjectId().toHexString();
const otherAuthorId = new Types.ObjectId().toHexString();
const postId = new Types.ObjectId().toHexString();

const user: AuthUser = {
  id: authorId,
  role: Role.USER,
  assignedProviderId: null,
};

const imageUrls = [
  '/api/uploads/image-one.jpg',
  '/api/uploads/image-two.png',
];

function setup(options: {
  post?: any;
  postById?: any;
  updatedPost?: any;
  searchResults?: any[];
  matchingAuthors?: any[];
  postAuthors?: any[];
} = {}) {
  const posts = {
    findOneAndUpdate: jest.fn(() => ({
      lean: async () =>
        options.updatedPost ?? options.post ?? null,
    })),
    findOneAndDelete: jest.fn(async () => options.post ?? null),
    findById: jest.fn(() => ({
      lean: async () =>
        options.postById ?? options.post ?? null,
    })),
    updateOne: jest.fn(async () => ({ modifiedCount: 1 })),
    find: jest.fn(() => ({
      lean: async () => options.searchResults ?? [],
    })),
  };

  const users = {
    find: jest.fn()
      .mockImplementationOnce(() => ({
        select: () => ({
          lean: async () => options.matchingAuthors ?? [],
        }),
      }))
      .mockImplementationOnce(() => ({
        lean: async () => options.postAuthors ?? [],
      })),
  };

  const uploadsService = {
    save: jest.fn(async () => [
      '/api/uploads/new-image.jpg',
    ]),
    remove: jest.fn(async () => undefined),
  };

  const service = new BlogService(
    posts as any,
    users as any,
    uploadsService as unknown as UploadsService,
  );

  return { service, posts, users, uploadsService };
}

describe('BLG-04: Update and Delete Posts', () => {
  describe('update', () => {
    it('updates a post owned by the current user', async () => {
      const updatedPost = {
        _id: postId,
        authorId,
        title: 'Updated travel post',
        body: 'Updated body',
      };

      const { service, posts } = setup({ post: updatedPost });

      const dto = {
        title: 'Updated travel post',
        body: 'Updated body',
      } as UpdatePostDto;

      const result = await service.update(user, postId, dto);

      expect(result).toEqual(updatedPost);
      expect(posts.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: postId, authorId: user.id },
        { $set: dto },
        { new: true, runValidators: true },
      );
    });

    it('returns 404 if the post does not exist or belong to the user', async () => {
      const { service } = setup();

      await expect(
        service.update(user, postId, {} as UpdatePostDto),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('remove', () => {
    it('deletes the post and all its uploaded images', async () => {
      const post = {
        _id: postId,
        authorId,
        images: imageUrls,
      };

      const { service, posts, uploadsService } = setup({ post });

      const result = await service.remove(user, postId);

      expect(result).toEqual({ message: 'Post deleted' });
      expect(posts.findOneAndDelete).toHaveBeenCalledWith({
        _id: postId,
        authorId: user.id,
      });

      expect(uploadsService.remove).toHaveBeenCalledTimes(2);
      expect(uploadsService.remove).toHaveBeenCalledWith(imageUrls[0]);
      expect(uploadsService.remove).toHaveBeenCalledWith(imageUrls[1]);
    });

    it('deletes a post that has no images', async () => {
      const post = {
        _id: postId,
        authorId,
        images: [],
      };

      const { service, uploadsService } = setup({ post });

      await expect(service.remove(user, postId)).resolves.toEqual({
        message: 'Post deleted',
      });

      expect(uploadsService.remove).not.toHaveBeenCalled();
    });

    it('returns 404 if the post does not exist or belong to the user', async () => {
      const { service, uploadsService } = setup();

      await expect(
        service.remove(user, postId),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(uploadsService.remove).not.toHaveBeenCalled();
    });
  });
});

describe('BLG-09: Search Blog Posts', () => {
  const query = { page: 1, limit: 10 } as any;

  it('searches posts by title', async () => {
    const posts = [{
      _id: new Types.ObjectId(),
      authorId,
      title: 'Paris Travel Guide',
      body: 'Explore Paris',
      tags: [],
      likeCount: 5,
      commentCount: 2,
      publishedAt: new Date(),
    }];

    const { service } = setup({
      searchResults: posts,
      matchingAuthors: [],
      postAuthors: [{ _id: authorId, name: 'Travel Author' }],
    });

    const result = await service.searchPosts('Paris', query);

    expect(result.data).toHaveLength(1);
    expect(result.data[0].title).toBe('Paris Travel Guide');
  });

  it('searches posts by tags', async () => {
    const posts = [{
      _id: new Types.ObjectId(),
      authorId,
      title: 'My Holiday',
      body: 'A great holiday',
      tags: ['paris'],
      likeCount: 1,
      commentCount: 0,
      publishedAt: new Date(),
    }];

    const { service } = setup({
      searchResults: posts,
      matchingAuthors: [],
      postAuthors: [{ _id: authorId, name: 'Travel Author' }],
    });

    const result = await service.searchPosts('paris', query);

    expect(result.data).toHaveLength(1);
    expect(result.data[0].tags).toContain('paris');
  });

  it('searches posts by author name', async () => {
    const posts = [{
      _id: new Types.ObjectId(),
      authorId,
      title: 'My Journey',
      body: 'A journey around the world',
      tags: [],
      likeCount: 2,
      commentCount: 1,
      publishedAt: new Date(),
    }];

    const { service } = setup({
      searchResults: posts,
      matchingAuthors: [{ _id: new Types.ObjectId(authorId) }],
      postAuthors: [{ _id: authorId, name: 'Travel Author' }],
    });

    const result = await service.searchPosts('Travel Author', query);

    expect(result.data).toHaveLength(1);
    expect(result.data[0].author.name).toBe('Travel Author');
  });

  it('sorts posts by interaction score, then newest', async () => {
    const older = new Date('2026-01-01');
    const newer = new Date('2026-02-01');

    const posts = [
      {
        _id: new Types.ObjectId(),
        authorId,
        title: 'Low score',
        body: 'Post one',
        likeCount: 1,
        commentCount: 1,
        publishedAt: newer,
      },
      {
        _id: new Types.ObjectId(),
        authorId,
        title: 'High score',
        body: 'Post two',
        likeCount: 10,
        commentCount: 5,
        publishedAt: older,
      },
      {
        _id: new Types.ObjectId(),
        authorId,
        title: 'Same score newer',
        body: 'Post three',
        likeCount: 1,
        commentCount: 1,
        publishedAt: newer,
      },
    ];

    const { service } = setup({
      searchResults: posts,
      matchingAuthors: [],
      postAuthors: [{ _id: authorId, name: 'Travel Author' }],
    });

    const result = await service.searchPosts('Post', query);

    expect(result.data.map((post: any) => post.title)).toEqual([
      'High score',
      'Low score',
      'Same score newer',
    ]);
  });

  it('returns a maximum 200-character excerpt followed by ellipsis for long bodies', async () => {
    const longBody = 'A'.repeat(250);

    const posts = [{
      _id: new Types.ObjectId(),
      authorId,
      title: 'Long article',
      body: longBody,
      likeCount: 0,
      commentCount: 0,
      publishedAt: new Date(),
    }];

    const { service } = setup({
      searchResults: posts,
      matchingAuthors: [],
      postAuthors: [{ _id: authorId, name: 'Travel Author' }],
    });

    const result = await service.searchPosts('Long', query);

    expect(result.data[0].excerpt).toBe(`${'A'.repeat(200)}...`);
  });
});

describe('BLG-10: Post Image Management', () => {
  const uploadedFiles = [
    { originalname: 'photo.jpg', buffer: Buffer.from('image') },
  ] as UploadedImage[];

  describe('addImages', () => {
    it('allows the author to upload images to their post', async () => {
      const post = {
        _id: postId,
        authorId,
        images: [],
      };

      const updatedPost = {
        ...post,
        images: ['/api/uploads/new-image.jpg'],
      };

      const { service, uploadsService, posts } = setup({
        postById: post,
        updatedPost,
      });

      const result = await service.addImages(
        user,
        postId,
        uploadedFiles,
      );

      expect(uploadsService.save).toHaveBeenCalledWith(uploadedFiles);
      expect(posts.findOneAndUpdate).toHaveBeenCalled();
      expect(result.images).toContain('/api/uploads/new-image.jpg');
    });

    it('rejects uploads from users who do not own the post', async () => {
      const post = {
        _id: postId,
        authorId: otherAuthorId,
        images: [],
      };

      const { service, uploadsService } = setup({ postById: post });

      await expect(
        service.addImages(user, postId, uploadedFiles),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(uploadsService.save).not.toHaveBeenCalled();
    });

    it('rejects uploads when the post would exceed 5 images', async () => {
      const post = {
        _id: postId,
        authorId,
        images: [
          'one.jpg',
          'two.jpg',
          'three.jpg',
          'four.jpg',
          'five.jpg',
        ],
      };

      const { service, uploadsService } = setup({ postById: post });

      await expect(
        service.addImages(user, postId, uploadedFiles),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(uploadsService.save).not.toHaveBeenCalled();
    });

    it('returns 404 when the post does not exist', async () => {
      const { service, uploadsService } = setup();

      await expect(
        service.addImages(user, postId, uploadedFiles),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(uploadsService.save).not.toHaveBeenCalled();
    });
  });

  describe('removeImage', () => {
    it('allows the author to delete an image from their post', async () => {
      const post = {
        _id: postId,
        authorId,
        images: imageUrls,
      };

      const { service, uploadsService, posts } = setup({
        postById: post,
        updatedPost: {
          ...post,
          images: [imageUrls[1]],
        },
      });

      const result = await service.removeImage(
        user,
        postId,
        'image-one.jpg',
      );

      expect(result).toEqual({
        message: 'Image deleted successfully',
      });
      expect(posts.findOneAndUpdate).toHaveBeenCalled();
      expect(uploadsService.remove).toHaveBeenCalledWith(imageUrls[0]);
    });

    it('rejects image deletion by a non-author', async () => {
      const post = {
        _id: postId,
        authorId: otherAuthorId,
        images: imageUrls,
      };

      const { service, uploadsService } = setup({ postById: post });

      await expect(
        service.removeImage(user, postId, 'image-one.jpg'),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(uploadsService.remove).not.toHaveBeenCalled();
    });

    it('returns 404 when the image does not exist', async () => {
      const post = {
        _id: postId,
        authorId,
        images: imageUrls,
      };

      const { service, uploadsService } = setup({ postById: post });

      await expect(
        service.removeImage(user, postId, 'missing.jpg'),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(uploadsService.remove).not.toHaveBeenCalled();
    });
  });
});
