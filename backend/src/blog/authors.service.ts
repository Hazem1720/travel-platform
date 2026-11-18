
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AccountStatus } from '../common/enums/role.enum';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto';
import { paginated } from '../common/pagination/pagination.helper';
import { PublicItinerariesService } from '../itineraries/public-itineraries.service';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Post, PostDocument, PostStatus } from './schemas/post.schema';

@Injectable()
export class AuthorsService {
  constructor(
    @InjectModel(User.name)
    private readonly users: Model<UserDocument>,
    @InjectModel(Post.name)
    private readonly posts: Model<PostDocument>,
    private readonly publicItinerariesService: PublicItinerariesService,
  ) {}

  // BLG-12: Get an author's public profile and content.
  async findProfile(
    authorId: string,
    query: PaginationQueryDto,
  ) {
    if (!Types.ObjectId.isValid(authorId)) {
      throw new NotFoundException('Author not found');
    }

    const author = (await this.users
  .findOne({
    _id: authorId,
    status: { $ne: AccountStatus.DEACTIVATED },
  })
  .select('name createdAt')
  .lean()) as {
  _id: Types.ObjectId;
  name: string;
  createdAt?: Date;
} | null;

    if (!author) {
      throw new NotFoundException('Author not found');
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 10;

    const postFilter = {
      authorId: author._id,
      status: PostStatus.PUBLISHED,
      hidden: false,
    };

    const [posts, totalPosts] = await Promise.all([
      this.posts
        .find(postFilter)
        .sort({ publishedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      this.posts.countDocuments(postFilter),
    ]);

    const itineraries =
      await this.publicItinerariesService.findByAuthor(
        String(author._id),
        page,
        limit,
      );

    return {
      author: {
        id: author._id,
        name: author.name,
        joinedAt: author.createdAt,
      },
      posts: paginated(posts, totalPosts, page, limit),
      itineraries,
    };
  }
}
