import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
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
import {
  CancelHotelBookingDto,
  HotelCancellationQuoteDto,
  HotelCancellationResultDto,
} from './dto/cancel-hotel-booking.dto';
import {
  CHECK_IN_REACHED,
  HotelCancellationService,
  NOT_CONFIRMED,
  REFUND_CHANGED,
} from './hotel-cancellation.service';
import { RESERVATION_NOT_FOUND } from './hotel-confirmation.service';

const NOT_FOUND = {
  status: 404,
  message: RESERVATION_NOT_FOUND,
  description: "Unknown id or another user's reservation",
};
const CANNOT_CANCEL = {
  status: 409,
  message: NOT_CONFIRMED,
  description: `Not Confirmed, or "${CHECK_IN_REACHED}"`,
};

// Hasan's HTL-21: a user cancels their own reservation, as a whole, before
// the check-in date, after seeing the refund.
@ApiTags('Hotel bookings')
@ApiCookieAuth('access_token')
@Controller('hotel-bookings')
export class HotelCancellationController {
  constructor(private readonly cancellations: HotelCancellationService) {}

  @Get(':id/cancellation')
  @Roles(Role.USER)
  @ApiOperation({
    summary: 'See the refund for cancelling your reservation (HTL-21)',
    description:
      "The refund if you cancel now: the hotel's tier (HTL-10) for the " +
      "days left before check-in, counted in the hotel's local date, on " +
      'the full total. Nothing changes. Send refundAmount to ' +
      'POST /hotel-bookings/:id/cancel to confirm.',
  })
  @ApiOkResponse({ type: HotelCancellationQuoteDto })
  @ApiErrors(UNAUTHENTICATED, NOT_FOUND, CANNOT_CANCEL)
  preview(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.cancellations.preview(user, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Roles(Role.USER)
  @ApiOperation({
    summary: 'Cancel your reservation (HTL-21)',
    description:
      'Cancels the whole reservation (all rooms) before the check-in date. ' +
      'refundAmount must be the amount shown by ' +
      'GET /hotel-bookings/:id/cancellation; if it has changed since, ' +
      'nothing is cancelled (409). The reservation becomes Cancelled, its ' +
      'rooms are free again for those dates, a refund is issued when the ' +
      'amount is above 0 (PAY-03) and you get a notification.',
  })
  @ApiOkResponse({ type: HotelCancellationResultDto })
  @ApiErrors(
    {
      status: 400,
      message: 'Validation failed',
      details: {
        refundAmount: ['refundAmount must be a whole number of cents'],
      },
    },
    UNAUTHENTICATED,
    NOT_FOUND,
    CANNOT_CANCEL,
    {
      status: 409,
      message: REFUND_CHANGED,
      description: 'The hotel changed its tiers, or a day passed',
    },
  )
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CancelHotelBookingDto,
  ) {
    return this.cancellations.cancel(user, id, dto.refundAmount);
  }
}
