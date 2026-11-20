import { Controller, Get, Param, Query } from '@nestjs/common';
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
  HotelReservationsPageDto,
  HotelReservationsQueryDto,
} from './dto/hotel-reservations.dto';
import { HOTEL_NOT_FOUND } from './hotel-rooms.service';
import { HotelReservationsService } from './hotel-reservations.service';

// Hasan's HTL-22: a hotel moderator's reservations for their own hotel.
@ApiTags('Hotels')
@ApiCookieAuth('access_token')
@Controller('hotels')
export class HotelReservationsController {
  constructor(private readonly reservations: HotelReservationsService) {}

  @Get(':id/reservations')
  @Roles(Role.HOTEL_MODERATOR)
  @ApiOperation({
    summary: "Your hotel's reservations (HTL-22)",
    description:
      'For your own hotel: its reservations with the guest (name, email, ' +
      'number of adults and children), dates, rooms and status ' +
      '(Confirmed, Completed or Cancelled), by check-in date, 10 per page. ' +
      'Filter by status, and by from/to to see only stays with a night in ' +
      'that range. Unpaid holds are not listed.',
  })
  @ApiOkResponse({ type: HotelReservationsPageDto })
  @ApiErrors(
    {
      status: 400,
      message: 'Validation failed',
      details: { to: ['to cannot be before from'] },
      description: 'A bad status or date, or to before from',
    },
    UNAUTHENTICATED,
    {
      status: 403,
      message: 'You can only manage your assigned provider',
      description: "Not a hotel moderator, or another hotel's id",
    },
    { status: 404, message: HOTEL_NOT_FOUND },
  )
  list(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() query: HotelReservationsQueryDto,
  ) {
    return this.reservations.list(user, id, query);
  }
}
