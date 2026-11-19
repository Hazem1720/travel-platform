import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ItineraryVisibility } from '../itineraries/schemas/itinerary.schema';
import { AUTHOR_NOT_FOUND, AuthorsService } from './authors.service';
import { PostStatus } from './schemas/post.schema';

const authorId = new Types.ObjectId();
const query = { page: 1, limit: 10 };
const lean = (value: unknown) => ({ lean: async () => value });
const chain = (rows: unknown[]) => ({
  sort: () => ({ skip: () => ({ limit: () => lean(rows) }) }),
});

function setup(author: unknown) {
  const users = {
    findOne: jest.fn(() => ({ select: () => lean(author) })),
  };
  const posts = {
    find: jest.fn(() =>
      chain([
        {
          _id: new Types.ObjectId(),
          title: 'Nile cruise',
          body: 'B'.repeat(250),
          tags: ['egypt'],
          publishedAt: new Date(),
          likeCount: 3,
          commentCount: 1,
        },
      ]),
    ),
    countDocuments: jest.fn(async () => 1),
  };
  const itineraries = {
    find: jest.fn(() =>
      chain([
        {
          _id: new Types.ObjectId(),
          title: 'Week in Egypt',
          countries: ['EG'],
          startDate: new Date(),
          days: [{}, {}],
        },
      ]),
    ),
    countDocuments: jest.fn(async () => 1),
  };
  const service = new AuthorsService(
    users as any,
    posts as any,
    itineraries as any,
  );
  return { service, users, posts, itineraries };
}

describe('BLG-12: public author page', () => {
  const joined = new Date('2026-01-05');

  it('shows name, join date, published posts and public itineraries', async () => {
    const { service } = setup({
      _id: authorId,
      name: 'Sara',
      createdAt: joined,
    });
    const page = await service.findProfile(String(authorId), query);

    expect(page.author).toEqual({
      id: authorId,
      name: 'Sara',
      joinedAt: joined,
    });
    expect(page.posts.data[0]).toMatchObject({
      title: 'Nile cruise',
      excerpt: `${'B'.repeat(200)}...`,
      likeCount: 3,
    });
    expect(page.posts.meta.total).toBe(1);
    expect(page.itineraries.data[0]).toMatchObject({
      title: 'Week in Egypt',
      dayCount: 2,
    });
  });

  it('lists only published, visible posts and public, visible itineraries', async () => {
    const { service, posts, itineraries } = setup({ _id: authorId, name: 'S' });
    await service.findProfile(String(authorId), query);
    expect((posts.find.mock.calls[0] as any[])[0]).toEqual({
      authorId,
      status: PostStatus.PUBLISHED,
      hidden: { $ne: true },
    });
    expect((itineraries.find.mock.calls[0] as any[])[0]).toEqual({
      ownerId: authorId,
      visibility: ItineraryVisibility.PUBLIC,
      hidden: { $ne: true },
    });
  });

  it('is 404 for an unknown or deactivated author (ACC-12)', async () => {
    const { service, users } = setup(null);
    await expect(service.findProfile(String(authorId), query)).rejects.toThrow(
      AUTHOR_NOT_FOUND,
    );
    expect((users.findOne.mock.calls[0] as any[])[0].status).toEqual({
      $ne: 'deactivated',
    });
  });

  it('is 404 for an invalid id', async () => {
    await expect(setup(null).service.findProfile('bad', query)).rejects.toThrow(
      NotFoundException,
    );
  });
});
