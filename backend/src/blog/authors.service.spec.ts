
import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { AccountStatus } from '../common/enums/role.enum';
import { PublicItinerariesService } from '../itineraries/public-itineraries.service';
import { AuthorsService } from './authors.service';

describe('BLG-12: Author Profiles', () => {
  const authorId = new Types.ObjectId().toHexString();
  const query = { page: 1, limit: 10 } as any;

  const author = {
    _id: new Types.ObjectId(authorId),
    name: 'Travel Author',
    createdAt: new Date('2026-01-01'),
  };

  const postsData = [
    {
      _id: new Types.ObjectId(),
      title: 'My Paris Trip',
      status: 'Published',
      authorId: author._id,
    },
  ];

  const itinerariesData = {
    data: [{ title: 'European Adventure' }],
    meta: { page: 1, limit: 10, total: 1, totalPages: 1 },
  };

  function setup(authorResult: any = author) {
    const users = {
      findOne: jest.fn(() => ({
        select: jest.fn(() => ({
          lean: jest.fn().mockResolvedValue(authorResult),
        })),
      })),
    };

    const posts = {
      find: jest.fn(() => ({
        sort: jest.fn(() => ({
          skip: jest.fn(() => ({
            limit: jest.fn(() => ({
              lean: jest.fn().mockResolvedValue(postsData),
            })),
          })),
        })),
      })),
      countDocuments: jest.fn().mockResolvedValue(1),
    };

    const publicItinerariesService = {
      findByAuthor: jest.fn().mockResolvedValue(itinerariesData),
    };

    const service = new AuthorsService(
      users as any,
      posts as any,
      publicItinerariesService as unknown as PublicItinerariesService,
    );

    return {
      service,
      users,
      posts,
      publicItinerariesService,
    };
  }

  it('returns an author profile with published posts and public itineraries', async () => {
    const { service } = setup();

    const result = await service.findProfile(authorId, query);

    expect(result.author.name).toBe('Travel Author');
    expect(result.author.joinedAt).toEqual(author.createdAt);
    expect(result.posts.data).toEqual(postsData);
    expect(result.itineraries).toEqual(itinerariesData);
  });

  it('only retrieves published and non-hidden posts', async () => {
    const { service, posts } = setup();

    await service.findProfile(authorId, query);

    expect(posts.find).toHaveBeenCalledWith({
      authorId: author._id,
      status: 'Published',
      hidden: false,
    });
  });

  it('requests the author itineraries with pagination', async () => {
    const { service, publicItinerariesService } = setup();

    await service.findProfile(authorId, query);

    expect(
      publicItinerariesService.findByAuthor,
    ).toHaveBeenCalledWith(authorId, 1, 10);
  });

  it('returns 404 when the author does not exist', async () => {
    const { service, posts, publicItinerariesService } = setup(null);

    await expect(
      service.findProfile(authorId, query),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(posts.find).not.toHaveBeenCalled();
    expect(publicItinerariesService.findByAuthor).not.toHaveBeenCalled();
  });

  it('returns 404 for a deactivated author', async () => {
    const { service, users } = setup();

    await service.findProfile(authorId, query);

    expect(users.findOne).toHaveBeenCalledWith({
      _id: authorId,
      status: { $ne: AccountStatus.DEACTIVATED },
    });
  });

  it('returns 404 for an invalid author ID', async () => {
    const { service, users } = setup();

    await expect(
      service.findProfile('invalid-id', query),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(users.findOne).not.toHaveBeenCalled();
  });
});
