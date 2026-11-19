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
  MyHotelBookingsPageDto,
  MyHotelBookingsQueryDto,
} from './dto/my-hotel-bookings.dto';
import { MyHotelBookingsService } from './my-hotel-bookings.service';

// Hasan's hotel reservation routes for the user (HTL-20; HTL-21 joins
// later). Same /hotel-bookings prefix as Memo's HotelBookingsController,
// which keeps POST /hotel-bookings and GET /hotel-bookings/:id.
@ApiTags('Hotel bookings')
@ApiCookieAuth('access_token')
@Controller('hotel-bookings')
export class MyHotelBookingsController {
  constructor(private readonly myBookings: MyHotelBookingsService) {}

  @Get()
  @Roles(Role.USER)
  @ApiOperation({
    summary: 'My hotel reservations: Upcoming, Past or Cancelled (HTL-20)',
    description:
      'Your own reservations, one tab at a time (group=upcoming, past or ' +
      'cancelled), 10 per page. Each row shows the reference, hotel, rooms, ' +
      'dates, guests, total and status. Open one with ' +
      'GET /hotel-bookings/:id for the full details.',
  })
  @ApiOkResponse({ type: MyHotelBookingsPageDto })
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
      description:
        'Not a registered user (admins and moderators have their own lists)',
    },
  )
  list(@CurrentUser() user: AuthUser, @Query() query: MyHotelBookingsQueryDto) {
    return this.myBookings.list(user, query);
  }
}
