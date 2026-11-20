import { Body, Controller, Param, Post } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
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
import { ReviewReplyDto } from './dto/review-reply.dto';
import {
  ALREADY_REPLIED,
  ReviewRepliesService,
} from './review-replies.service';
import { REVIEW_NOT_FOUND } from './reviews.service';

// HTL-26 (bonus).
@ApiTags('Hotel reviews')
@ApiCookieAuth('access_token')
@Roles(Role.HOTEL_MODERATOR)
@Controller('reviews')
export class ReviewRepliesController {
  constructor(private readonly replies: ReviewRepliesService) {}

  @Post(':id/reply')
  @ApiParam({ name: 'id', example: '6737e1a2c1a2b3c4d5e6fe01' })
  @ApiOperation({
    summary: 'Reply to a review of your hotel, once (HTL-26)',
    description:
      'Hotel moderator of the reviewed hotel only. The reviewer is ' +
      'notified; the reply shows on GET /api/hotels/{id}/reviews.',
  })
  @ApiCreatedResponse({
    schema: {
      example: {
        _id: '6737e1a2c1a2b3c4d5e6fe01',
        rating: 4,
        text: 'Great stay',
        reply: {
          text: 'Thank you, we hope to see you again!',
          createdAt: '2026-11-19T10:00:00.000Z',
        },
      },
    },
  })
  @ApiErrors(
    { status: 400, message: 'Validation failed' },
    UNAUTHENTICATED,
    {
      status: 403,
      message: 'You can only manage your assigned provider',
      description: "Not a hotel moderator, or another hotel's review",
    },
    { status: 404, message: REVIEW_NOT_FOUND },
    { status: 409, message: ALREADY_REPLIED },
  )
  reply(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ReviewReplyDto,
  ) {
    return this.replies.reply(user, id, dto.text);
  }
}
