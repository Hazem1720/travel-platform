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
  CancelFlightBookingDto,
  FlightCancellationQuoteDto,
  FlightCancellationResultDto,
} from './dto/cancel-flight-booking.dto';
import {
  ALREADY_DEPARTED,
  FlightBookingCancellationService,
  NOT_CONFIRMED,
  REFUND_CHANGED,
} from './flight-booking-cancellation.service';
import { BOOKING_NOT_FOUND } from './flight-confirmation.service';

const NOT_FOUND = {
  status: 404,
  message: BOOKING_NOT_FOUND,
  description: "Unknown id or another user's booking",
};
const CANNOT_CANCEL = {
  status: 409,
  message: NOT_CONFIRMED,
  description: `Not Confirmed, or "${ALREADY_DEPARTED}"`,
};

// Hasan's FLT-26: a user cancels their own flight booking before departure,
// after seeing the refund.
@ApiTags('Flight bookings')
@ApiCookieAuth('access_token')
@Controller('flight-bookings')
export class FlightBookingCancellationController {
  constructor(
    private readonly cancellations: FlightBookingCancellationService,
  ) {}

  @Get(':id/cancellation')
  @Roles(Role.USER)
  @ApiOperation({
    summary: 'See the refund for cancelling your booking (FLT-26)',
    description:
      "The refund if you cancel now: the airline's tier (FLT-09) for the " +
      "days left before departure, counted in the departure airport's " +
      'local date, on the full total. A round trip is cancelled as a ' +
      "whole with the outbound flight's tier. Nothing changes. Send " +
      'refundAmount to POST /flight-bookings/:id/cancel to confirm.',
  })
  @ApiOkResponse({ type: FlightCancellationQuoteDto })
  @ApiErrors(UNAUTHENTICATED, NOT_FOUND, CANNOT_CANCEL)
  preview(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.cancellations.preview(user, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Roles(Role.USER)
  @ApiOperation({
    summary: 'Cancel your booking (FLT-26)',
    description:
      'Cancels the whole booking (both flights of a round trip) any time ' +
      'before departure. refundAmount must be the amount shown by ' +
      'GET /flight-bookings/:id/cancellation; if it has changed since, ' +
      'nothing is cancelled (409). The booking becomes Cancelled, its ' +
      'seats return to inventory (chosen seats too), a refund is issued ' +
      'when the amount is above 0 (PAY-03) and you get a notification.',
  })
  @ApiOkResponse({ type: FlightCancellationResultDto })
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
      description: 'The airline changed its tiers, or a day passed',
    },
  )
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CancelFlightBookingDto,
  ) {
    return this.cancellations.cancel(user, id, dto.refundAmount);
  }
}
