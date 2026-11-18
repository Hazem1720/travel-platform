
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
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto';
import {
  ApiErrors,
  UNAUTHENTICATED,
} from '../common/swagger/api-error.decorator';
import { AuthUser } from '../common/types/auth-user.type';
import { UploadedImage } from '../uploads/image-file';
import { ImageUpload } from '../uploads/image-upload.decorator';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { BlogService } from './blog.service';

@ApiTags('Blog')
@ApiCookieAuth('access_token')
@Controller('posts')
export class BlogController {
  constructor(private readonly blogService: BlogService) {}

  @Get('mine')
  @ApiOperation({ summary: 'Get my posts, including drafts (BLG-03)' })
  @ApiQuery({ type: PaginationQueryDto })
  @ApiOkResponse({
    description: 'My posts, including drafts',
    schema: {
      example: {
        data: [],
        meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
      },
    },
  })
  @ApiErrors(UNAUTHENTICATED)
  findMine(
    @CurrentUser() user: AuthUser,
    @Query() query: PaginationQueryDto,
  ) {
    return this.blogService.findMine(user, query);
  }

  @Get()
  @Public()
  @ApiOperation({
    summary: 'List published blog posts and search posts (BLG-02, BLG-09)',
  })
  @ApiQuery({ type: PaginationQueryDto })
  @ApiQuery({
    name: 'tag',
    required: false,
    example: 'travel',
    description: 'Filter posts by tag',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    example: 'Paris',
    description: 'Search by post title, tags, or author name',
  })
  @ApiOkResponse({
    description: 'Paginated published posts',
    schema: {
      example: {
        data: [],
        meta: { page: 1, limit: 10, total: 0, totalPages: 0 },
      },
    },
  })
  findAll(
    @Query() query: PaginationQueryDto,
    @Query('tag') tag?: string,
    @Query('search') search?: string,
  ): Promise<any> {
    if (search?.trim()) {
      return this.blogService.searchPosts(search, query, tag);
    }

    return this.blogService.findAll(query, tag);
  }

  @Get(':id')
  @Public()
  @ApiOperation({ summary: 'Get blog post details (BLG-02)' })
  @ApiOkResponse({
    description: 'Post details including author information',
  })
  @ApiErrors({ status: 404, message: 'Post not found' })
  findById(@Param('id') id: string): Promise<any> {
    return this.blogService.findById(id);
  }

  @HttpPost()
  @ApiOperation({ summary: 'Create a blog post (BLG-01)' })
  @ApiCreatedResponse({ description: 'Blog post created successfully' })
  @ApiErrors(
    UNAUTHENTICATED,
    {
      status: 400,
      message: 'Validation failed',
      details: {
        title: ['title should not be empty'],
        body: ['body should not be empty'],
      },
    },
  )
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreatePostDto,
  ) {
    return this.blogService.create(user, dto);
  }

  // BLG-04: Update a post (author only).
  @Patch(':id')
  @ApiOperation({ summary: 'Update my blog post (BLG-04)' })
  @ApiOkResponse({ description: 'Post updated successfully' })
  @ApiErrors(
    UNAUTHENTICATED,
    { status: 404, message: 'Post not found' },
    { status: 400, message: 'Validation failed' },
  )
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdatePostDto,
  ) {
    return this.blogService.update(user, id, dto);
  }

  // BLG-04: Delete a post (author only).
  @Delete(':id')
  @ApiOperation({ summary: 'Delete my blog post (BLG-04)' })
  @ApiOkResponse({
    description: 'Post deleted successfully',
    schema: {
      example: { message: 'Post deleted' },
    },
  })
  @ApiErrors(
    UNAUTHENTICATED,
    { status: 404, message: 'Post not found' },
  )
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.blogService.remove(user, id);
  }

  // BLG-10: Upload images to a post (author only).
  @HttpPost(':id/images')
  @ImageUpload('images', 5)
  @ApiOperation({
    summary: 'Upload up to 5 images to my post (BLG-10)',
  })
  @ApiCreatedResponse({
    description: 'Images uploaded and attached to the post',
  })
  @ApiErrors(
    UNAUTHENTICATED,
    { status: 400, message: 'A post can have at most 5 images' },
    { status: 403, message: 'You can only modify your own posts' },
    { status: 404, message: 'Post not found' },
  )
  addImages(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFiles() files: UploadedImage[],
  ) {
    return this.blogService.addImages(user, id, files);
  }

  // BLG-10: Delete an image from a post (author only).
  @Delete(':id/images/:imageId')
  @ApiOperation({
    summary: 'Delete an image from my post (BLG-10)',
  })
  @ApiOkResponse({
    description: 'Image deleted successfully',
    schema: {
      example: { message: 'Image deleted successfully' },
    },
  })
  @ApiErrors(
    UNAUTHENTICATED,
    { status: 403, message: 'You can only modify your own posts' },
    { status: 404, message: 'Post or image not found' },
  )
  removeImage(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('imageId') imageId: string,
  ) {
    return this.blogService.removeImage(user, id, imageId);
  }
}
