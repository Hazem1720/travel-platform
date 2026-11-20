import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post as HttpPost,
  Query,
  UploadedFiles,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto';
import {
  ApiErrors,
  UNAUTHENTICATED,
} from '../common/swagger/api-error.decorator';
import { AuthUser } from '../common/types/auth-user.type';
import { IMAGE_LIMITS, UploadedImage } from '../uploads/image-file';
import { ImageUpload } from '../uploads/image-upload.decorator';
import { BlogService } from './blog.service';
import { AttachItineraryDto } from './dto/attach-itinerary.dto';
import { CreatePostDto } from './dto/create-post.dto';
import { PostListQueryDto } from './dto/post-list-query.dto';
import { UpdatePostDto } from './dto/update-post.dto';

const POST_ID = { name: 'id', example: '6736e5f4c1a2b3c4d5e6fa01' };
const NOT_FOUND = { status: 404, message: 'Post not found' };
// Blog writing is for registered users (role user), like comments and likes.
const FORBIDDEN = {
  status: 403,
  message: 'You do not have permission for this action',
};
const PAGE_EXAMPLE = {
  data: [],
  meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
};

@ApiTags('Blog')
@Controller('posts')
export class BlogController {
  constructor(private readonly blogService: BlogService) {}

  @Get('mine')
  @Roles(Role.USER)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'My posts, drafts included, newest first (BLG-03)',
    description:
      'Title, status, dates, tags, images, like and comment counts. ' +
      'Hidden posts (GEN-10) are listed here with hidden: true.',
  })
  @ApiOkResponse({ description: 'My posts', schema: { example: PAGE_EXAMPLE } })
  @ApiErrors(UNAUTHENTICATED, FORBIDDEN)
  findMine(@CurrentUser() user: AuthUser, @Query() query: PaginationQueryDto) {
    return this.blogService.findMine(user, query);
  }

  @Get()
  @Public()
  @ApiOperation({
    summary:
      'Browse published posts, optionally by tag, or search them (BLG-02, BLG-08, BLG-09)',
    description:
      'Without ?search: published posts, newest first. With ?search: ' +
      'keyword in the title, a tag or the author name, ordered by likes + ' +
      'comments then newest; an empty result carries message "No results found".',
  })
  @ApiOkResponse({
    description: 'Paginated published posts',
    schema: {
      example: {
        data: [
          {
            _id: '6736e5f4c1a2b3c4d5e6fa01',
            title: 'My Trip to Paris',
            excerpt: 'I had an amazing experience visiting Paris...',
            tags: ['travel', 'france'],
            images: [],
            author: { id: '6736e5f4c1a2b3c4d5e6f001', name: 'Sara' },
            publishedAt: '2026-11-18T10:00:00.000Z',
            likeCount: 3,
            commentCount: 2,
          },
        ],
        meta: { page: 1, limit: 10, total: 1, totalPages: 1 },
      },
    },
  })
  @ApiErrors({ status: 400, message: 'Validation failed' })
  findAll(@Query() query: PostListQueryDto) {
    return this.blogService.findAll(query);
  }

  @Get(':id')
  @Public()
  @ApiParam(POST_ID)
  @ApiOperation({
    summary: 'A published post with its author (BLG-02)',
    description:
      'Public. A logged-in author may also open their own draft or hidden post, and an admin any hidden post (GEN-10).',
  })
  @ApiOkResponse({ description: 'Post details' })
  @ApiErrors(NOT_FOUND)
  findById(
    @Param('id') id: string,
    // Set only when the visitor is logged in (GEN-10: the author or an admin
    // may open a hidden post; the author may open their own draft).
    @CurrentUser() viewer?: AuthUser,
  ) {
    return this.blogService.findById(id, viewer);
  }

  @HttpPost()
  @Roles(Role.USER)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Create a post as Draft or Published (BLG-01, BLG-08)',
    description:
      'Images are added afterwards with POST /api/posts/{id}/images (BLG-10).',
  })
  @ApiCreatedResponse({ description: 'Post created' })
  @ApiErrors(UNAUTHENTICATED, FORBIDDEN, {
    status: 400,
    message: 'Validation failed',
    details: {
      title: ['title should not be empty'],
      tags: ['tags must contain no more than 5 elements'],
    },
  })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePostDto) {
    return this.blogService.create(user, dto);
  }

  @Patch(':id')
  @Roles(Role.USER)
  @ApiCookieAuth('access_token')
  @ApiParam(POST_ID)
  @ApiOperation({
    summary: 'Edit my post: title, body, tags or status (BLG-04, BLG-08)',
  })
  @ApiOkResponse({ description: 'Post updated' })
  @ApiErrors(
    { status: 400, message: 'Validation failed' },
    UNAUTHENTICATED,
    FORBIDDEN,
    NOT_FOUND,
  )
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdatePostDto,
  ) {
    return this.blogService.update(user, id, dto);
  }

  @Patch(':id/itinerary')
  @Roles(Role.USER)
  @ApiCookieAuth('access_token')
  @ApiParam(POST_ID)
  @ApiOperation({
    summary: 'Attach one of your public itineraries to your post (BLG-13)',
    description:
      'Send itineraryId: null to detach it. The post page shows the ' +
      'itinerary while it stays public and visible.',
  })
  @ApiOkResponse({
    description: 'The post with its attached itinerary',
    schema: {
      example: {
        _id: '6736e5f4c1a2b3c4d5e6fa01',
        itineraryId: '6736a1f4c1a2b3c4d5e6f301',
        itinerary: {
          id: '6736a1f4c1a2b3c4d5e6f301',
          title: 'A week in Egypt',
          countries: ['EG'],
          startDate: '2026-12-01T00:00:00.000Z',
          dayCount: 7,
        },
      },
    },
  })
  @ApiErrors(
    {
      status: 400,
      message: 'You can attach only one of your own public itineraries',
      details: {
        itineraryId: ['You can attach only one of your own public itineraries'],
      },
    },
    UNAUTHENTICATED,
    FORBIDDEN,
    NOT_FOUND,
  )
  attachItinerary(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: AttachItineraryDto,
  ) {
    return this.blogService.attachItinerary(user, id, dto.itineraryId);
  }

  @Delete(':id')
  @Roles(Role.USER)
  @ApiCookieAuth('access_token')
  @ApiParam(POST_ID)
  @ApiOperation({ summary: 'Delete my post (BLG-04)' })
  @ApiOkResponse({
    description: 'Post deleted',
    schema: { example: { message: 'Post deleted' } },
  })
  @ApiErrors(UNAUTHENTICATED, FORBIDDEN, NOT_FOUND)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.blogService.remove(user, id);
  }

  @HttpPost(':id/images')
  @Roles(Role.USER)
  @ApiCookieAuth('access_token')
  @ApiParam(POST_ID)
  @ImageUpload('images', IMAGE_LIMITS.POST)
  @ApiOperation({
    summary: 'Upload images to my post, at most 5 per post (BLG-10, GEN-08)',
  })
  @ApiCreatedResponse({ description: 'The post with its new images' })
  @ApiErrors(
    { status: 400, message: 'At most 5 images allowed (4 already uploaded)' },
    UNAUTHENTICATED,
    FORBIDDEN,
    NOT_FOUND,
  )
  addImages(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFiles() files: UploadedImage[],
  ) {
    return this.blogService.addImages(user, id, files);
  }

  @Delete(':id/images/:imageId')
  @Roles(Role.USER)
  @ApiCookieAuth('access_token')
  @ApiParam(POST_ID)
  @ApiParam({
    name: 'imageId',
    description: 'The file name at the end of the image URL',
    example: '3f2b8c1e-6a8d-4e0f-9b1a-2c3d4e5f6a7b.jpg',
  })
  @ApiOperation({ summary: 'Remove an image from my post (BLG-10)' })
  @ApiOkResponse({
    description: 'Image removed',
    schema: { example: { message: 'Image deleted successfully' } },
  })
  @ApiErrors(UNAUTHENTICATED, FORBIDDEN, {
    status: 404,
    message: 'Image not found',
  })
  removeImage(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('imageId') imageId: string,
  ) {
    return this.blogService.removeImage(user, id, imageId);
  }
}
