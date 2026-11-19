import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { Role } from '../common/enums/role.enum';
import { AuthUser } from '../common/types/auth-user.type';
import { UploadedImage } from '../uploads/image-file';
import { UploadsService } from '../uploads/uploads.service';
import { BlogService, excerptOf, NO_RESULTS } from './blog.service';
import { PostStatus } from './schemas/post.schema';

const authorId = new Types.ObjectId().toHexString();
const postId = new Types.ObjectId().toHexString();
const user: AuthUser = {
  id: authorId,
  role: Role.USER,
  assignedProviderId: null,
};
const query = { page: 1, limit: 10 };

const lean = (value: unknown) => ({ lean: async () => value });

// A post document as findOne() returns it: fields plus save() and toObject().
function postDoc(fields: Record<string, unknown> = {}) {
  const doc: any = {
    _id: new Types.ObjectId(postId),
    authorId: new Types.ObjectId(authorId),
    title: 'Paris',
    body: 'A trip',
    tags: [],
    images: [],
    status: PostStatus.DRAFT,
    publishedAt: null,
    ...fields,
  };
  doc.save = jest.fn<any, any[]>(async () => doc);
  doc.toObject = () => ({ ...doc });
  return doc;
}

function setup(
  opts: {
    owned?: any;
    found?: any;
    deleted?: any;
    pushed?: any;
    pulled?: any;
    page?: any[];
    total?: number;
    names?: { _id: unknown; name: string }[];
    author?: any;
  } = {},
) {
  const posts = {
    create: jest.fn<any, any[]>(async (data: any) => ({
      toObject: () => data,
    })),
    findOne: jest.fn<any, any[]>((filter: any) =>
      filter.status === PostStatus.PUBLISHED
        ? lean(opts.found ?? null)
        : (opts.owned ?? null),
    ),
    findOneAndDelete: jest.fn<any, any[]>(async () => opts.deleted ?? null),
    findOneAndUpdate: jest.fn<any, any[]>((_f: any, update: any) =>
      update.$push ? lean(opts.pushed ?? null) : (opts.pulled ?? null),
    ),
    aggregate: jest.fn<any, any[]>(async () => [
      {
        data: opts.page ?? [],
        total: opts.total === undefined ? [] : [{ n: opts.total }],
      },
    ]),
  };
  const users = {
    distinct: jest.fn<any, any[]>(async () => []),
    find: jest.fn<any, any[]>(() => lean(opts.names ?? [])),
    findOne: jest.fn<any, any[]>(() => ({
      select: () => lean(opts.author ?? null),
    })),
  };
  const uploads = {
    save: jest.fn<any, any[]>(async () => ['/api/uploads/new.jpg']),
    remove: jest.fn<any, any[]>(async () => undefined),
  };
  const comments = {
    listForPost: jest.fn<any, any[]>(async () => ({
      data: [],
      meta: { total: 0 },
    })),
    removeForPost: jest.fn<any, any[]>(async () => undefined),
  };
  const service = new BlogService(
    posts as any,
    users as any,
    uploads as unknown as UploadsService,
    comments as any,
  );
  return { service, posts, users, uploads, comments };
}

describe('BLG-01: create a post', () => {
  it('saves a Draft by default, without publishedAt', async () => {
    const { service, posts } = setup();
    await service.create(user, { title: 'T', body: 'B' });
    const saved = posts.create.mock.calls[0][0];
    expect(saved).toMatchObject({
      title: 'T',
      body: 'B',
      tags: [],
      status: PostStatus.DRAFT,
      publishedAt: null,
    });
    expect(String(saved.authorId)).toBe(authorId);
  });

  it('sets publishedAt when created as Published', async () => {
    const { service, posts } = setup();
    await service.create(user, {
      title: 'T',
      body: 'B',
      tags: ['paris'],
      status: PostStatus.PUBLISHED,
    });
    expect(posts.create.mock.calls[0][0].publishedAt).toBeInstanceOf(Date);
  });
});

describe('BLG-02 / BLG-08: browse published posts', () => {
  it('lists only published, visible posts newest first, with author names', async () => {
    const row = {
      _id: new Types.ObjectId(),
      authorId: new Types.ObjectId(authorId),
      title: 'Paris',
      body: 'Body',
      tags: ['paris'],
      images: [],
      publishedAt: new Date(),
      likeCount: 2,
      commentCount: 1,
    };
    const { service, posts } = setup({
      page: [row],
      total: 1,
      names: [{ _id: row.authorId, name: 'Sara' }],
    });
    const res = await service.findAll({ ...query, tag: 'paris' });
    const [match, sort] = posts.aggregate.mock.calls[0][0];
    expect(match.$match).toMatchObject({
      status: PostStatus.PUBLISHED,
      hidden: { $ne: true },
      tags: 'paris',
    });
    expect(sort.$sort).toEqual({ publishedAt: -1, _id: -1 });
    expect(res.data[0]).toMatchObject({
      title: 'Paris',
      excerpt: 'Body',
      author: { name: 'Sara' },
      likeCount: 2,
      commentCount: 1,
    });
    expect(res.meta.total).toBe(1);
  });

  it('leaves out posts by deactivated authors (ACC-12)', async () => {
    const gone = new Types.ObjectId();
    const { service, posts, users } = setup();
    users.distinct.mockResolvedValueOnce([gone] as never);
    await service.findAll(query);
    expect(posts.aggregate.mock.calls[0][0][0].$match.authorId).toEqual({
      $nin: [gone],
    });
  });

  it('a tag page lowercases the tag (BLG-08)', async () => {
    const { service, posts } = setup();
    await service.findByTag(' Paris ', query);
    expect(posts.aggregate.mock.calls[0][0][0].$match.tags).toBe('paris');
  });

  it('shows a published post with its author and first page of comments', async () => {
    const { service, comments } = setup({
      found: { _id: postId, authorId, title: 'Paris' },
      author: { name: 'Sara' },
    });
    const post = await service.findById(postId);
    expect(post.author).toEqual({ id: authorId, name: 'Sara' });
    expect(comments.listForPost).toHaveBeenCalledWith(postId, {
      page: 1,
      limit: 10,
    });
    expect(post.comments).toEqual({ data: [], meta: { total: 0 } });
  });

  it('is 404 for an invalid id, a draft, a hidden post or a deactivated author', async () => {
    await expect(setup().service.findById('nope')).rejects.toThrow(
      NotFoundException,
    );
    await expect(setup().service.findById(postId)).rejects.toThrow(
      NotFoundException,
    );
    const { service } = setup({ found: { _id: postId, authorId } });
    await expect(service.findById(postId)).rejects.toThrow(NotFoundException);
  });
});

describe('BLG-09: search posts', () => {
  it('matches title, tags or author name and orders by likes + comments, then newest', async () => {
    const matchingAuthor = new Types.ObjectId();
    const { service, posts, users } = setup({ total: 1 });
    users.distinct
      .mockResolvedValueOnce([matchingAuthor] as never)
      .mockResolvedValueOnce([] as never);
    await service.findAll({ ...query, search: 'Par(is' });

    const pipeline = posts.aggregate.mock.calls[0][0];
    const { $or } = pipeline[0].$match;
    expect($or[0].title).toEqual(/Par\(is/i);
    expect($or[1].tags).toEqual(/Par\(is/i);
    expect($or[2]).toEqual({ authorId: { $in: [matchingAuthor] } });
    expect(pipeline[1].$addFields.score).toBeDefined();
    expect(pipeline[2].$sort).toEqual({ score: -1, publishedAt: -1, _id: -1 });
  });

  it('says "No results found" when nothing matches', async () => {
    const { service } = setup({ total: 0 });
    const res = await service.searchPosts({ ...query, search: 'zzz' });
    expect(res).toMatchObject({ data: [], message: NO_RESULTS });
  });

  it('cuts the excerpt at 200 characters followed by an ellipsis', () => {
    expect(excerptOf('A'.repeat(250))).toBe(`${'A'.repeat(200)}...`);
    expect(excerptOf('short')).toBe('short');
  });
});

describe('BLG-03: my posts', () => {
  it('lists every post of the current user, drafts included', async () => {
    const find = jest.fn<any, any[]>(() => ({
      sort: () => ({ skip: () => ({ limit: () => lean([{ title: 'D' }]) }) }),
    }));
    const posts = { find, countDocuments: jest.fn<any, any[]>(async () => 1) };
    const service = new BlogService(
      posts as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const res = await service.findMine(user, query);
    expect(String((find.mock.calls[0] as any[])[0].authorId)).toBe(authorId);
    expect(res.data).toEqual([{ title: 'D' }]);
  });
});

describe('BLG-04 / BLG-08: update and delete', () => {
  it('updates title, body and tags of my post', async () => {
    const doc = postDoc();
    const { service, posts } = setup({ owned: doc });
    await service.update(user, postId, {
      title: 'New',
      body: 'Text',
      tags: ['nile'],
    });
    const filter = (posts.findOne.mock.calls[0] as any[])[0];
    expect(filter._id).toBe(postId);
    expect(String(filter.authorId)).toBe(authorId);
    expect(doc).toMatchObject({ title: 'New', body: 'Text', tags: ['nile'] });
    expect(doc.save).toHaveBeenCalled();
  });

  it('sets publishedAt the first time a draft is published', async () => {
    const doc = postDoc();
    const { service } = setup({ owned: doc });
    await service.update(user, postId, { status: PostStatus.PUBLISHED });
    expect(doc.publishedAt).toBeInstanceOf(Date);

    const first = new Date('2026-01-01');
    const again = postDoc({ publishedAt: first });
    await setup({ owned: again }).service.update(user, postId, {
      status: PostStatus.PUBLISHED,
    });
    expect(again.publishedAt).toBe(first);
  });

  it("is 404 for someone else's post or an invalid id", async () => {
    await expect(
      setup().service.update(user, postId, { title: 'x' }),
    ).rejects.toThrow(NotFoundException);
    await expect(
      setup().service.update(user, 'bad', { title: 'x' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('deletes my post with its uploaded images, comments and likes', async () => {
    const { service, uploads, comments } = setup({
      deleted: {
        _id: postId,
        images: ['/api/uploads/a.jpg', '/api/uploads/b.png'],
      },
    });
    await expect(service.remove(user, postId)).resolves.toEqual({
      message: 'Post deleted',
    });
    expect(uploads.remove).toHaveBeenCalledTimes(2);
    expect(comments.removeForPost).toHaveBeenCalledWith(postId);
  });

  it("is 404 when deleting someone else's post", async () => {
    await expect(setup().service.remove(user, postId)).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('BLG-10: post images', () => {
  const files = [{ originalname: 'a.jpg' }] as UploadedImage[];

  it('uploads images to my post', async () => {
    const { service, uploads } = setup({
      owned: postDoc(),
      pushed: { images: ['/api/uploads/new.jpg'] },
    });
    const res = await service.addImages(user, postId, files);
    expect(uploads.save).toHaveBeenCalledWith(files);
    expect(res.images).toEqual(['/api/uploads/new.jpg']);
  });

  it('refuses more than 5 images in total, before saving anything', async () => {
    const { service, uploads } = setup({
      owned: postDoc({ images: ['1', '2', '3', '4', '5'] }),
    });
    await expect(service.addImages(user, postId, files)).rejects.toThrow(
      BadRequestException,
    );
    expect(uploads.save).not.toHaveBeenCalled();
  });

  it('removes the saved files when the atomic re-check fails', async () => {
    const { service, uploads } = setup({ owned: postDoc(), pushed: null });
    await expect(service.addImages(user, postId, files)).rejects.toThrow(
      BadRequestException,
    );
    expect(uploads.remove).toHaveBeenCalledWith('/api/uploads/new.jpg');
  });

  it("is 404 for someone else's post", async () => {
    await expect(
      setup().service.addImages(user, postId, files),
    ).rejects.toThrow(NotFoundException);
  });

  it('removes an image by its file name', async () => {
    const { service, uploads } = setup({
      owned: postDoc({ images: ['/api/uploads/a.jpg'] }),
      pulled: { images: [] },
    });
    await expect(service.removeImage(user, postId, 'a.jpg')).resolves.toEqual({
      message: 'Image deleted successfully',
    });
    expect(uploads.remove).toHaveBeenCalledWith('/api/uploads/a.jpg');
  });

  it('is 404 for an unknown image', async () => {
    const { service } = setup({ owned: postDoc() });
    await expect(service.removeImage(user, postId, 'x.jpg')).rejects.toThrow(
      NotFoundException,
    );
  });
});
