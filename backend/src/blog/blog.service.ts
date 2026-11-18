
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AccountStatus } from '../common/enums/role.enum';
import { AuthUser } from '../common/types/auth-user.type';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto';
import { paginated } from '../common/pagination/pagination.helper';
import { User, UserDocument } from '../users/schemas/user.schema';
import { UploadedImage } from '../uploads/image-file';
import { UploadsService } from '../uploads/uploads.service';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { Post, PostDocument, PostStatus } from './schemas/post.schema';

export const POST_NOT_FOUND = 'Post not found';

@Injectable()
export class BlogService {
  constructor(
    @InjectModel(Post.name)
    private readonly posts: Model<PostDocument>,
    @InjectModel(User.name)
    private readonly users: Model<UserDocument>,
    private readonly uploadsService: UploadsService,
  ) {}

  // BLG-01: Create a new blog post.
  async create(user: AuthUser, dto: CreatePostDto) {
    const status = dto.status ?? PostStatus.DRAFT;

    const post = await this.posts.create({
      authorId: user.id,
      title: dto.title,
      body: dto.body,
      tags: dto.tags ?? [],
      images: dto.images ?? [],
      status,
      publishedAt:
        status === PostStatus.PUBLISHED ? new Date() : null,
    });

    return post.toObject();
  }

  // BLG-02: List public posts, optionally filtered by tag.
  async findAll(
    query: PaginationQueryDto,
    tag?: string,
  ): Promise<any> {
    const deactivated = await this.users.distinct('_id', {
      status: AccountStatus.DEACTIVATED,
    });

    const filter: Record<string, unknown> = {
      status: PostStatus.PUBLISHED,
      hidden: false,
      ...(deactivated.length
        ? { authorId: { $nin: deactivated } }
        : {}),
    };

    if (tag) {
      filter.tags = tag.trim().toLowerCase();
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 10;

    const [posts, total] = await Promise.all([
      this.posts
        .find(filter)
        .sort({ publishedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      this.posts.countDocuments(filter),
    ]);

    const authors = await this.users
      .find(
        { _id: { $in: posts.map((post) => post.authorId) } },
        { name: 1 },
      )
      .lean();

    const authorNames = new Map(
      authors.map((author) => [
        String(author._id),
        author.name,
      ]),
    );

    const data = posts.map((post) => ({
      ...post,
      author: {
        id: post.authorId,
        name: authorNames.get(String(post.authorId)) ?? '',
      },
    }));

    return paginated(data, total, page, limit);
  }

  // BLG-09: Search published posts by title, tags, or author name.
  async searchPosts(
    keyword: string,
    query: PaginationQueryDto,
    tag?: string,
  ): Promise<any> {
    const search = keyword.trim();
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'i');

    const authors = await this.users
      .find({
        name: regex,
        status: { $ne: AccountStatus.DEACTIVATED },
      })
      .select('_id')
      .lean();

    const authorIds = authors.map((author) => author._id);

    const filter: Record<string, any> = {
      status: PostStatus.PUBLISHED,
      hidden: false,
      $or: [
        { title: regex },
        { tags: regex },
        { authorId: { $in: authorIds } },
      ],
    };

    if (tag) {
      filter.tags = tag.trim().toLowerCase();
    }

    const allPosts = await this.posts.find(filter).lean();

    const sortedPosts = allPosts.sort((a, b) => {
      const scoreA = (a.likeCount ?? 0) + (a.commentCount ?? 0);
      const scoreB = (b.likeCount ?? 0) + (b.commentCount ?? 0);

      if (scoreA !== scoreB) {
        return scoreB - scoreA;
      }

      return (
        new Date(b.publishedAt).getTime() -
        new Date(a.publishedAt).getTime()
      );
    });

    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const total = sortedPosts.length;

    const selectedPosts = sortedPosts.slice(
      (page - 1) * limit,
      page * limit,
    );

    const postAuthors = await this.users
      .find(
        { _id: { $in: selectedPosts.map((post) => post.authorId) } },
        { name: 1 },
      )
      .lean();

    const authorNames = new Map(
      postAuthors.map((author) => [
        String(author._id),
        author.name,
      ]),
    );

    const data = selectedPosts.map((post) => ({
      ...post,
      author: {
        id: post.authorId,
        name: authorNames.get(String(post.authorId)) ?? '',
      },
      excerpt:
        post.body.length > 200
          ? `${post.body.slice(0, 200)}...`
          : post.body,
    }));

    return paginated(data, total, page, limit);
  }

  // BLG-08: Find published posts matching a tag.
  async findByTag(
    tag: string,
    query: PaginationQueryDto,
  ): Promise<any> {
    return this.findAll(query, tag);
  }

  // BLG-03: Get the current user's posts, including drafts.
  async findMine(user: AuthUser, query: PaginationQueryDto) {
    const filter = { authorId: user.id };

    const page = query.page ?? 1;
    const limit = query.limit ?? 10;

    const [posts, total] = await Promise.all([
      this.posts
        .find(filter)
        .select('title status createdAt likeCount commentCount')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      this.posts.countDocuments(filter),
    ]);

    return paginated(posts, total, page, limit);
  }

  // BLG-02: Get public post details and author information.
  async findById(id: string): Promise<any> {
    const post = await this.posts
      .findOne({
        _id: id,
        status: PostStatus.PUBLISHED,
        hidden: false,
      })
      .lean();

    if (!post) {
      throw new NotFoundException(POST_NOT_FOUND);
    }

    const author = await this.users
      .findOne({
        _id: post.authorId,
        status: { $ne: AccountStatus.DEACTIVATED },
      })
      .select('name')
      .lean();

    if (!author) {
      throw new NotFoundException(POST_NOT_FOUND);
    }

    return {
      ...post,
      author: {
        id: post.authorId,
        name: author.name,
      },
    };
  }

  // BLG-04: Update an existing post.
  async update(user: AuthUser, id: string, dto: UpdatePostDto) {
    const post = await this.posts
      .findOneAndUpdate(
        { _id: id, authorId: user.id },
        { $set: dto },
        { new: true, runValidators: true },
      )
      .lean();

    if (!post) {
      throw new NotFoundException(POST_NOT_FOUND);
    }

    return post;
  }

  // BLG-04: Delete a post and its uploaded images.
  async remove(user: AuthUser, id: string) {
    const post = await this.posts.findOneAndDelete({
      _id: id,
      authorId: user.id,
    });

    if (!post) {
      throw new NotFoundException(POST_NOT_FOUND);
    }

    await Promise.all(
      (post.images ?? []).map((imageUrl) =>
        this.uploadsService.remove(imageUrl),
      ),
    );

    return { message: 'Post deleted' };
  }

  // BLG-10: Upload images to the author's post.
  async addImages(
    user: AuthUser,
    id: string,
    files: UploadedImage[],
  ) {
    const post = await this.posts.findById(id).lean();

    if (!post) {
      throw new NotFoundException(POST_NOT_FOUND);
    }

    if (String(post.authorId) !== user.id) {
      throw new ForbiddenException(
        'You can only modify your own posts',
      );
    }

    if ((post.images ?? []).length + files.length > 5) {
      throw new BadRequestException(
        'A post can have at most 5 images',
      );
    }

    const urls = await this.uploadsService.save(files);

    try {
      const updatedPost = await this.posts.findOneAndUpdate(
        {
          _id: id,
          authorId: user.id,
          $expr: {
            $lte: [
              {
                $add: [
                  { $size: { $ifNull: ['$images', []] } },
                  files.length,
                ],
              },
              5,
            ],
          },
        },
        { $push: { images: { $each: urls } } },
        { new: true, runValidators: true },
      ).lean();

      if (!updatedPost) {
        throw new BadRequestException(
          'A post can have at most 5 images',
        );
      }

      return updatedPost;
    } catch (error) {
      await Promise.all(
        urls.map((url) => this.uploadsService.remove(url)),
      );
      throw error;
    }
  }

  // BLG-10: Remove an image from the author's post.
  async removeImage(
    user: AuthUser,
    id: string,
    imageId: string,
  ) {
    const post = await this.posts.findById(id).lean();

    if (!post) {
      throw new NotFoundException(POST_NOT_FOUND);
    }

    if (String(post.authorId) !== user.id) {
      throw new ForbiddenException(
        'You can only modify your own posts',
      );
    }

    const imageUrl = (post.images ?? []).find(
      (url) => url.split('/').pop() === imageId,
    );

    if (!imageUrl) {
      throw new NotFoundException('Image not found');
    }

    const updatedPost = await this.posts.findOneAndUpdate(
      {
        _id: id,
        authorId: user.id,
        images: imageUrl,
      },
      { $pull: { images: imageUrl } },
      { new: true },
    ).lean();

    if (!updatedPost) {
      throw new NotFoundException('Image not found');
    }

    await this.uploadsService.remove(imageUrl);

    return { message: 'Image deleted successfully' };
  }
}
