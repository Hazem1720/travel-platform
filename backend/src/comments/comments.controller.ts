import { Body, Controller, Delete, Param, Patch, Post } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
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
@ApiCookieAuth('access_token')
@Roles(Role.USER)
@Controller()
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Post('posts/:id/comments')
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
