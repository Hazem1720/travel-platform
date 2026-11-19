import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
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
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import {
  ApiErrors,
  UNAUTHENTICATED,
} from '../common/swagger/api-error.decorator';
import { AuthUser } from '../common/types/auth-user.type';
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';

@ApiTags('Comments and likes')
@Controller()
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Get('posts/:id/comments')
  @Public()
  @ApiParam({ name: 'id', example: '6736e5f4c1a2b3c4d5e6fc01' })
  @ApiOperation({
    summary: "A published post's comments, oldest first (BLG-02, BLG-05)",
    description:
      'Hidden comments are left out (GEN-10); a deactivated author shows ' +
      'as "Deleted user" (ACC-12).',
  })
  @ApiOkResponse({
    description: 'Paginated comments in chronological order',
    schema: {
      example: {
        data: [
          {
            _id: '6736e5f4c1a2b3c4d5e6fc11',
            postId: '6736e5f4c1a2b3c4d5e6fc01',
            body: 'Amazing trip!',
            author: { id: '6736e5f4c1a2b3c4d5e6f001', name: 'Sara' },
            createdAt: '2026-11-18T10:00:00.000Z',
            updatedAt: '2026-11-18T10:00:00.000Z',
          },
        ],
        meta: { page: 1, limit: 10, total: 1, totalPages: 1 },
      },
    },
  })
  @ApiErrors(
    { status: 400, message: 'Validation failed' },
    { status: 404, message: 'Post not found' },
  )
  list(@Param('id') id: string, @Query() query: PaginationQueryDto) {
    return this.comments.listForPost(id, query);
  }

  @Post('posts/:id/comments')
  @Roles(Role.USER)
  @ApiCookieAuth('access_token')
  @ApiParam({ name: 'id', example: '6736e5f4c1a2b3c4d5e6fc01' })
  @ApiOperation({ summary: 'Comment on a published post (BLG-05)' })
  @ApiCreatedResponse({
    description: 'Comment created',
    schema: {
      example: {
        _id: '6736e5f4c1a2b3c4d5e6fc01',
        body: 'Amazing trip!',
        hidden: false,
      },
    },
  })
  @ApiErrors({ status: 400, message: 'Validation failed' }, UNAUTHENTICATED, {
    status: 404,
    message: 'Post not found',
  })
  create(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.comments.create(user, id, dto);
  }

  @Post('posts/:id/like')
  @Roles(Role.USER)
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Like a post once (BLG-06)' })
  @ApiOkResponse({
    description: 'Post liked',
    schema: { example: { liked: true, likeCount: 1 } },
  })
  @ApiErrors(
    UNAUTHENTICATED,
    { status: 404, message: 'Post not found' },
    { status: 409, message: 'You have already liked this post' },
  )
  like(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.comments.like(user, id);
  }

  @Delete('posts/:id/like')
  @Roles(Role.USER)
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Remove your like from a post (BLG-06)' })
  @ApiOkResponse({
    description: 'Like removed',
    schema: { example: { liked: false, likeCount: 0 } },
  })
  @ApiErrors(UNAUTHENTICATED, {
    status: 404,
    message: 'Post or like not found',
  })
  unlike(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.comments.unlike(user, id);
  }

  @Patch('comments/:id')
  @Roles(Role.USER)
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Edit your own comment (BLG-07)' })
  @ApiOkResponse({
    description: 'Comment updated',
    schema: {
      example: {
        _id: '6736e5f4c1a2b3c4d5e6fc01',
        body: 'Updated comment text',
      },
    },
  })
  @ApiErrors(
    { status: 400, message: 'Validation failed' },
    UNAUTHENTICATED,
    { status: 403, message: 'You can only edit your own comments' },
    { status: 404, message: 'Comment not found' },
  )
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateCommentDto,
  ) {
    return this.comments.update(user, id, dto);
  }

  @Delete('comments/:id')
  @Roles(Role.USER)
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Delete your own comment (BLG-07)' })
  @ApiOkResponse({
    description: 'Comment deleted',
    schema: { example: { success: true } },
  })
  @ApiErrors(
    UNAUTHENTICATED,
    { status: 403, message: 'You can only delete your own comments' },
    { status: 404, message: 'Comment not found' },
  )
  delete(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.comments.delete(user, id);
  }
}
