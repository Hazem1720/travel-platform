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
import { MessageDto } from '../auth/dto/auth-responses.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import {
  ApiErrors,
  UNAUTHENTICATED,
} from '../common/swagger/api-error.decorator';
import { AuthUser } from '../common/types/auth-user.type';
import {
  CreateReviewDto,
  HotelReviewsPageDto,
  HotelReviewsQueryDto,
  ReviewDto,
  UpdateReviewDto,
} from './dto/review.dto';
import { RESERVATION_NOT_FOUND } from './hotel-confirmation.service';
import { HOTEL_NOT_FOUND } from './hotel-rooms.service';
import {
  REVIEW_ALREADY_EXISTS,
  REVIEW_NOT_COMPLETED,
  REVIEW_NOT_FOUND,
  ReviewsService,
} from './reviews.service';

const NOT_A_USER = {
  status: 403,
  message: 'You do not have permission for this action',
  description: 'Not a registered user',
};

// Hasan's hotel reviews (HTL-23, HTL-24). The routes sit under three
// prefixes, as the project description lists them, so the controller has
// none of its own.
@ApiTags('Hotel reviews')
@Controller()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post('hotel-bookings/:id/review')
  @Roles(Role.USER)
  @ApiCookieAuth('access_token')
  @ApiParam({ name: 'id', description: 'Your Completed reservation' })
  @ApiOperation({
    summary: 'Rate and review a stay (HTL-23)',
    description:
      'One rating (1-5) and an optional review (up to 1000 characters) per ' +
      'Completed reservation, whatever the number of rooms. A reservation ' +
      'becomes Completed once its check-out date has passed. The hotel ' +
      'average rating is recalculated.',
  })
  @ApiCreatedResponse({ type: ReviewDto })
  @ApiErrors(
    {
      status: 400,
      message: 'Validation failed',
      details: { rating: ['rating must not be greater than 5'] },
      description:
        'Rating not a whole number from 1 to 5, or text over 1000 characters',
    },
    UNAUTHENTICATED,
    NOT_A_USER,
    {
      status: 404,
      message: RESERVATION_NOT_FOUND,
      description: "No such reservation, or another user's reservation",
    },
    {
      status: 409,
      message: REVIEW_NOT_COMPLETED,
      description: `Not Completed yet, or "${REVIEW_ALREADY_EXISTS}"`,
    },
  )
  create(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateReviewDto,
  ) {
    return this.reviews.create(user, id, dto);
  }

  @Patch('reviews/:id')
  @Roles(Role.USER)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Edit my review (HTL-23)',
    description:
      'Change the rating, the text or both. The hotel average rating is ' +
      'recalculated when the rating changes.',
  })
  @ApiOkResponse({ type: ReviewDto })
  @ApiErrors(
    {
      status: 400,
      message: 'Validation failed',
      details: {
        text: ['text must be shorter than or equal to 1000 characters'],
      },
    },
    UNAUTHENTICATED,
    NOT_A_USER,
    {
      status: 404,
      message: REVIEW_NOT_FOUND,
      description: "No such review, or another user's review",
    },
  )
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateReviewDto,
  ) {
    return this.reviews.update(user, id, dto);
  }

  @Delete('reviews/:id')
  @Roles(Role.USER)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Delete my review (HTL-23)',
    description: 'The hotel average rating is recalculated.',
  })
  @ApiOkResponse({ type: MessageDto })
  @ApiErrors(UNAUTHENTICATED, NOT_A_USER, {
    status: 404,
    message: REVIEW_NOT_FOUND,
    description: "No such review, or another user's review",
  })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.reviews.remove(user, id);
  }

  @Get('hotels/:id/reviews')
  @Public()
  @ApiOperation({
    summary: "A hotel's rating and reviews (HTL-24)",
    description:
      'The average rating, the number of ratings and the reviews, newest ' +
      'first, 10 per page. Open to guests. A deactivated author shows as ' +
      '"Deleted user".',
  })
  @ApiOkResponse({ type: HotelReviewsPageDto })
  @ApiErrors(
    {
      status: 400,
      message: 'Validation failed',
      details: { limit: ['limit must not be greater than 10'] },
    },
    {
      status: 404,
      message: HOTEL_NOT_FOUND,
      description: 'No such hotel, or an inactive hotel',
    },
  )
  listForHotel(@Param('id') id: string, @Query() query: HotelReviewsQueryDto) {
    return this.reviews.listForHotel(id, query);
  }
}
