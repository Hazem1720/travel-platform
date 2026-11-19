import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import { AccountStatus } from '../common/enums/role.enum';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto';
import { paginated } from '../common/pagination/pagination.helper';
import {
  Itinerary,
  ItineraryDocument,
  ItineraryVisibility,
} from '../itineraries/schemas/itinerary.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { excerptOf } from './blog.service';
import { Post, PostDocument, PostStatus } from './schemas/post.schema';

export const AUTHOR_NOT_FOUND = 'Author not found';

@Injectable()
export class AuthorsService {
  constructor(
    @InjectModel(User.name)
    private readonly users: Model<UserDocument>,
    @InjectModel(Post.name)
    private readonly posts: Model<PostDocument>,
    @InjectModel(Itinerary.name)
    private readonly itineraries: Model<ItineraryDocument>,
  ) {}

  // BLG-12: the public author page: name, join date, published posts and
  // public itineraries (ITN-20), each list paginated with the same page.
  // Hidden content (GEN-10) is left out; a deactivated author is 404 (ACC-12).
  async findProfile(authorId: string, query: PaginationQueryDto) {
    if (!isValidObjectId(authorId)) {
      throw new NotFoundException(AUTHOR_NOT_FOUND);
    }
    const author = await this.users
      .findOne({
        _id: authorId,
        status: { $ne: AccountStatus.DEACTIVATED },
      })
      .select('name createdAt')
      .lean<{ _id: Types.ObjectId; name: string; createdAt?: Date }>();
    if (!author) throw new NotFoundException(AUTHOR_NOT_FOUND);

    const { page, limit } = query;
    const skip = (page - 1) * limit;
    const postFilter = {
      authorId: author._id,
      status: PostStatus.PUBLISHED,
      hidden: { $ne: true },
    };
    const itineraryFilter = {
      ownerId: author._id,
      visibility: ItineraryVisibility.PUBLIC,
      hidden: { $ne: true },
    };

    const [posts, totalPosts, itineraries, totalItineraries] =
      await Promise.all([
        this.posts
          .find(postFilter)
          .sort({ publishedAt: -1, _id: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        this.posts.countDocuments(postFilter),
        this.itineraries
          .find(itineraryFilter)
          .sort({ updatedAt: -1, _id: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        this.itineraries.countDocuments(itineraryFilter),
      ]);

    return {
      author: {
        id: author._id,
        name: author.name,
        joinedAt: author.createdAt,
      },
      posts: paginated(
        posts.map((p) => ({
          _id: p._id,
          title: p.title,
          excerpt: excerptOf(p.body),
          tags: p.tags,
          publishedAt: p.publishedAt,
          likeCount: p.likeCount ?? 0,
          commentCount: p.commentCount ?? 0,
        })),
        totalPosts,
        page,
        limit,
      ),
      itineraries: paginated(
        itineraries.map((i) => ({
          _id: i._id,
          title: i.title,
          countries: i.countries,
          startDate: i.startDate,
          dayCount: i.days?.length ?? 0,
          updatedAt: (i as { updatedAt?: Date }).updatedAt,
        })),
        totalItineraries,
        page,
        limit,
      ),
    };
  }
}
