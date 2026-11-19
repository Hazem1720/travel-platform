import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, PipelineStage, Types } from 'mongoose';
import { AccountStatus, Role } from '../common/enums/role.enum';
import {
  PAGE_SIZE,
  PaginationQueryDto,
} from '../common/pagination/pagination-query.dto';
import { paginated } from '../common/pagination/pagination.helper';
import { AuthUser } from '../common/types/auth-user.type';
import { CommentsService } from '../comments/comments.service';
import { idInAnyForm } from '../common/helpers/ownership';
import {
  Itinerary,
  ItineraryDocument,
  ItineraryVisibility,
} from '../itineraries/schemas/itinerary.schema';
import {
  assertImageLimit,
  IMAGE_LIMITS,
  UploadedImage,
} from '../uploads/image-file';
import { UploadsService } from '../uploads/uploads.service';
import { User, UserDocument } from '../users/schemas/user.schema';
import { CreatePostDto } from './dto/create-post.dto';
import { PostListQueryDto } from './dto/post-list-query.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { Post, PostDocument, PostStatus } from './schemas/post.schema';

export const POST_NOT_FOUND = 'Post not found';
export const EXCERPT_LENGTH = 200;
export const NO_RESULTS = 'No results found';

type PostRow = Post & { _id: Types.ObjectId };

// BLG-02: what the post page shows.
export type PostDetails = Record<string, unknown> & {
  author: { id: unknown; name: string };
  comments: unknown;
  itinerary: AttachedItinerary | null;
};

// BLG-13: what a post shows of its attached itinerary.
export interface AttachedItinerary {
  id: unknown;
  title: string;
  countries: string[];
  startDate: Date;
  dayCount: number;
}

export const ITINERARY_NOT_ATTACHABLE =
  'You can attach only one of your own public itineraries';

// Public and not hidden (GEN-10): what anyone may see of an itinerary.
const PUBLIC_ITINERARY = {
  visibility: ItineraryVisibility.PUBLIC,
  hidden: { $ne: true },
};

export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// BLG-09: the first 200 characters of the body, with "..." when cut.
export function excerptOf(body: string): string {
  return body.length > EXCERPT_LENGTH
    ? `${body.slice(0, EXCERPT_LENGTH)}...`
    : body;
}

@Injectable()
export class BlogService {
  constructor(
    @InjectModel(Post.name)
    private readonly posts: Model<PostDocument>,
    @InjectModel(User.name)
    private readonly users: Model<UserDocument>,
    private readonly uploadsService: UploadsService,
    private readonly comments: CommentsService,
    @InjectModel(Itinerary.name)
    private readonly itineraries: Model<ItineraryDocument>,
  ) {}

  // BLG-01: Create a new blog post, as a Draft unless Published is asked for.
  async create(user: AuthUser, dto: CreatePostDto) {
    const status = dto.status ?? PostStatus.DRAFT;
    const post = await this.posts.create({
      authorId: new Types.ObjectId(user.id),
      title: dto.title,
      body: dto.body,
      tags: dto.tags ?? [],
      status,
      publishedAt: status === PostStatus.PUBLISHED ? new Date() : null,
    });
    return post.toObject();
  }

  // BLG-02: published posts, newest first, optionally only one tag (BLG-08).
  // With ?search= this is the BLG-09 search instead.
  async findAll(query: PostListQueryDto) {
    if (query.search) {
      return this.searchPosts(query);
    }
    const match = await this.visibleFilter();
    if (query.tag) match.tags = query.tag;
    return this.page(match, { publishedAt: -1, _id: -1 }, query);
  }

  // BLG-08: clicking a tag lists the published posts that carry it.
  async findByTag(tag: string, query: PaginationQueryDto) {
    return this.findAll({
      page: query.page,
      limit: query.limit,
      tag: tag.trim().toLowerCase(),
    });
  }

  // BLG-09: keyword in the title, a tag or the author's name. Ordered by
  // interaction score (likes + comments), newest first on ties.
  async searchPosts(query: PostListQueryDto) {
    const re = new RegExp(escapeRegex(query.search ?? ''), 'i');
    const authorIds = await this.users.distinct('_id', {
      name: re,
      status: { $ne: AccountStatus.DEACTIVATED },
    });
    const match = await this.visibleFilter();
    match.$or = [{ title: re }, { tags: re }, { authorId: { $in: authorIds } }];
    if (query.tag) match.tags = query.tag;

    const result = await this.page(
      match,
      { score: -1, publishedAt: -1, _id: -1 },
      query,
      true,
    );
    return result.meta.total ? result : { ...result, message: NO_RESULTS };
  }

  // BLG-03: the current user's posts, drafts and hidden ones included.
  async findMine(user: AuthUser, query: PaginationQueryDto) {
    const filter = { authorId: new Types.ObjectId(user.id) };
    const [posts, total] = await Promise.all([
      this.posts
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      this.posts.countDocuments(filter),
    ]);
    return paginated(posts, total, query.page, query.limit);
  }

  // BLG-02: a published, visible post with its author, like and comment
  // counts and the first page of comments (oldest first, BLG-05). More
  // comments: GET /api/posts/:id/comments?page=2.
  // GEN-10: hidden posts stay visible to their author and admins; BLG-03:
  // the author may also open their own draft. Everyone else sees only
  // published, visible posts.
  async findById(id: string, viewer?: AuthUser): Promise<PostDetails> {
    if (!isValidObjectId(id)) throw new NotFoundException(POST_NOT_FOUND);
    const visible = { status: PostStatus.PUBLISHED, hidden: { $ne: true } };
    const filter: Record<string, unknown> = { _id: id };
    if (viewer?.role === Role.ADMIN) {
      filter.status = PostStatus.PUBLISHED;
    } else if (viewer) {
      filter.$or = [visible, { authorId: idInAnyForm(viewer.id) }];
    } else {
      Object.assign(filter, visible);
    }
    const post = await this.posts.findOne(filter).lean();
    if (!post) throw new NotFoundException(POST_NOT_FOUND);

    const author = await this.users
      .findOne({
        _id: post.authorId,
        status: { $ne: AccountStatus.DEACTIVATED },
      })
      .select('name')
      .lean();
    if (!author) throw new NotFoundException(POST_NOT_FOUND);

    // Comments are public only on a published, visible post; the author's
    // draft or hidden post shows none (the comment list itself is public).
    const isPublic = post.status === PostStatus.PUBLISHED && !post.hidden;
    const comments = isPublic
      ? await this.comments.listForPost(id, { page: 1, limit: PAGE_SIZE })
      : paginated([], 0, 1, PAGE_SIZE);
    return {
      ...post,
      author: { id: post.authorId, name: author.name },
      comments,
      itinerary: await this.attachedItinerary(post.itineraryId),
    };
  }

  // BLG-13 (bonus): attach one of the author's own public itineraries to
  // the post, or detach it with itineraryId: null. A private, hidden, someone
  // else's or unknown itinerary is 400.
  async attachItinerary(
    user: AuthUser,
    id: string,
    itineraryId: string | null,
  ) {
    const post = await this.findOwned(user, id);
    if (itineraryId === null) {
      post.itineraryId = null;
    } else {
      const itinerary = isValidObjectId(itineraryId)
        ? await this.itineraries
            .findOne(
              {
                _id: itineraryId,
                // Itineraries store ownerId as the id string.
                ownerId: idInAnyForm(user.id),
                ...PUBLIC_ITINERARY,
              },
              { _id: 1 },
            )
            .lean()
        : null;
      if (!itinerary) {
        throw new BadRequestException({
          error: 'Bad Request',
          message: ITINERARY_NOT_ATTACHABLE,
          details: { itineraryId: [ITINERARY_NOT_ATTACHABLE] },
        });
      }
      post.itineraryId = itinerary._id as Types.ObjectId;
    }
    await post.save();
    return {
      ...post.toObject(),
      itinerary: await this.attachedItinerary(post.itineraryId),
    };
  }

  // The attached itinerary while it is still public and visible; if the
  // author made it private later, or an admin hid it, the post shows none.
  private async attachedItinerary(
    itineraryId: Types.ObjectId | null | undefined,
  ): Promise<AttachedItinerary | null> {
    if (!itineraryId) return null;
    const it = await this.itineraries
      .findOne({ _id: itineraryId, ...PUBLIC_ITINERARY })
      .lean();
    if (!it) return null;
    return {
      id: it._id,
      title: it.title,
      countries: it.countries,
      startDate: it.startDate,
      dayCount: it.days?.length ?? 0,
    };
  }

  // BLG-04 and BLG-08: the author edits title, body, tags or status. The
  // first time a post becomes Published, publishedAt is set.
  async update(user: AuthUser, id: string, dto: UpdatePostDto) {
    const post = await this.findOwned(user, id);
    if (dto.title !== undefined) post.title = dto.title;
    if (dto.body !== undefined) post.body = dto.body;
    if (dto.tags !== undefined) post.tags = dto.tags;
    if (dto.status !== undefined) {
      post.status = dto.status;
      if (dto.status === PostStatus.PUBLISHED && !post.publishedAt) {
        post.publishedAt = new Date();
      }
    }
    await post.save();
    return post.toObject();
  }

  // BLG-04: delete a post with its uploaded images, comments and likes.
  async remove(user: AuthUser, id: string) {
    if (!isValidObjectId(id)) throw new NotFoundException(POST_NOT_FOUND);
    const post = await this.posts.findOneAndDelete({
      _id: id,
      authorId: new Types.ObjectId(user.id),
    });
    if (!post) throw new NotFoundException(POST_NOT_FOUND);

    await Promise.all([
      this.comments.removeForPost(post._id),
      ...(post.images ?? []).map((url) => this.uploadsService.remove(url)),
    ]);
    return { message: 'Post deleted' };
  }

  // BLG-10: upload images to the author's post (at most 5 per post, GEN-08).
  async addImages(user: AuthUser, id: string, files: UploadedImage[]) {
    const post = await this.findOwned(user, id);
    assertImageLimit(post.images.length, files.length, IMAGE_LIMITS.POST);

    const urls = await this.uploadsService.save(files);
    try {
      // Re-checked atomically, so two uploads at once cannot pass 5 images.
      const updated = await this.posts
        .findOneAndUpdate(
          {
            _id: post._id,
            authorId: post.authorId,
            $expr: {
              $lte: [
                {
                  $add: [{ $size: { $ifNull: ['$images', []] } }, urls.length],
                },
                IMAGE_LIMITS.POST,
              ],
            },
          },
          { $push: { images: { $each: urls } } },
          { new: true },
        )
        .lean();
      if (!updated) {
        throw new BadRequestException(
          `At most ${IMAGE_LIMITS.POST} images allowed`,
        );
      }
      return updated;
    } catch (error) {
      await Promise.all(urls.map((url) => this.uploadsService.remove(url)));
      throw error;
    }
  }

  // BLG-10: remove one image (by its file name) from the author's post.
  async removeImage(user: AuthUser, id: string, imageId: string) {
    const post = await this.findOwned(user, id);
    const url = post.images.find((u) => u.split('/').pop() === imageId);
    if (!url) throw new NotFoundException('Image not found');

    const updated = await this.posts.findOneAndUpdate(
      { _id: post._id, images: url },
      { $pull: { images: url } },
      { new: true },
    );
    if (!updated) throw new NotFoundException('Image not found');

    await this.uploadsService.remove(url);
    return { message: 'Image deleted successfully' };
  }

  // ACC-11: another user's post is 404, so drafts are not revealed.
  private async findOwned(user: AuthUser, id: string) {
    if (!isValidObjectId(id)) throw new NotFoundException(POST_NOT_FOUND);
    const post = await this.posts.findOne({
      _id: id,
      authorId: new Types.ObjectId(user.id),
    });
    if (!post) throw new NotFoundException(POST_NOT_FOUND);
    return post;
  }

  // Published, not hidden (GEN-10) and not by a deactivated author (ACC-12).
  private async visibleFilter(): Promise<Record<string, unknown>> {
    const deactivated = await this.users.distinct('_id', {
      status: AccountStatus.DEACTIVATED,
    });
    return {
      status: PostStatus.PUBLISHED,
      hidden: { $ne: true },
      ...(deactivated.length ? { authorId: { $nin: deactivated } } : {}),
    };
  }

  // One page of list items: title, author, date, excerpt, tags, first image
  // and the like and comment counts.
  private async page(
    match: Record<string, unknown>,
    sort: Record<string, 1 | -1>,
    query: PaginationQueryDto,
    withScore = false,
  ) {
    const pipeline: PipelineStage[] = [
      { $match: match },
      ...(withScore
        ? [
            {
              $addFields: {
                score: {
                  $add: [
                    { $ifNull: ['$likeCount', 0] },
                    { $ifNull: ['$commentCount', 0] },
                  ],
                },
              },
            },
          ]
        : []),
      { $sort: sort },
      {
        $facet: {
          data: [
            { $skip: (query.page - 1) * query.limit },
            { $limit: query.limit },
          ],
          total: [{ $count: 'n' }],
        },
      },
    ];
    const [result] = await this.posts.aggregate(pipeline);
    const rows = (result?.data ?? []) as PostRow[];
    const names = await this.authorNames(rows.map((p) => p.authorId));
    const data = rows.map((p) => ({
      _id: p._id,
      title: p.title,
      excerpt: excerptOf(p.body),
      tags: p.tags,
      images: p.images,
      author: { id: p.authorId, name: names.get(String(p.authorId)) ?? '' },
      publishedAt: p.publishedAt,
      likeCount: p.likeCount ?? 0,
      commentCount: p.commentCount ?? 0,
    }));
    return paginated(data, result?.total[0]?.n ?? 0, query.page, query.limit);
  }

  private async authorNames(ids: Types.ObjectId[]) {
    const authors = await this.users
      .find({ _id: { $in: ids } }, { name: 1 })
      .lean();
    return new Map(authors.map((a) => [String(a._id), a.name]));
  }
}
