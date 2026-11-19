import { Controller, Get, Query } from '@nestjs/common';
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
  MyFlightBookingsPageDto,
  MyFlightBookingsQueryDto,
} from './dto/my-flight-bookings.dto';
import { MyFlightBookingsService } from './my-flight-bookings.service';

// Hasan's flight booking routes for the user (FLT-25; FLT-26 joins later).
// Same /flight-bookings prefix as Mostafa's FlightBookingsController, which
// keeps POST /flight-bookings, /hold and GET /flight-bookings/:id.
@ApiTags('Flight bookings')
@ApiCookieAuth('access_token')
@Controller('flight-bookings')
export class MyFlightBookingsController {
  constructor(private readonly myBookings: MyFlightBookingsService) {}

  @Get()
  @Roles(Role.USER)
  @ApiOperation({
    summary: 'My flight bookings: Upcoming, Past or Cancelled (FLT-25)',
    description:
      'Your own bookings, one tab at a time (group=upcoming, past or ' +
      'cancelled), 10 per page. Each row shows the reference, the flights ' +
      'with dates and cabin, the passengers and the status. Open one with ' +
      'GET /flight-bookings/:id for the full details.',
  })
  @ApiOkResponse({ type: MyFlightBookingsPageDto })
  @ApiErrors(
    {
      status: 400,
      message: 'Validation failed',
      details: {
        group: [
          'group must be one of the following values: upcoming, past, cancelled',
        ],
      },
      description: 'Unknown group, page below 1 or limit above 10',
    },
    UNAUTHENTICATED,
    {
      status: 403,
      message: 'You do not have permission for this action',
      description: 'Not a registered user',
    },
  )
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: MyFlightBookingsQueryDto,
  ) {
    return this.myBookings.list(user, query);
  }
}
