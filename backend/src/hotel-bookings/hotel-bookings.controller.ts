import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
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
  CreateHotelBookingDto,
  HotelBookingDto,
} from './dto/create-hotel-booking.dto';
import {
  ROOM_NOT_FOUND,
  ROOMS_NOT_AVAILABLE,
} from './hotel-availability.service';
import { HotelHoldService } from './hotel-hold.service';
import { HOTEL_NOT_FOUND } from './hotel-rooms.service';

// Memo's hotel reservations: HTL-16 and HTL-18 now; GET /hotel-bookings/:id
// comes with HTL-17. Hasan's routes (HTL-20 to HTL-22) live in his own
// controller under the same prefix.
@ApiTags('Hotel bookings')
@ApiCookieAuth('access_token')
@Controller('hotel-bookings')
export class HotelBookingsController {
  constructor(private readonly holds: HotelHoldService) {}

  @Post()
  @Roles(Role.USER)
  @ApiOperation({
    summary: 'Book and hold rooms for payment (HTL-16, HTL-18)',
    description:
      'Books one or more rooms of one hotel for the same dates in one ' +
      'reservation, with adults and children (ages 0-17) per room: at ' +
      'least one adult in the reservation, and no room over its ' +
      "maxOccupancy. Total = sum over rooms of nights x that room's " +
      'pricePerNight now, stored as a price snapshot (USD cents). All rooms ' +
      'are held together for 10 minutes as one PendingPayment reservation ' +
      '(expiresAt): if any room is already booked, blocked or held on any ' +
      'night, nothing is held (409). Pay before expiresAt (PAY-01); after it ' +
      'the reservation becomes Expired and the rooms are free again.',
  })
  @ApiCreatedResponse({
    type: HotelBookingDto,
    description: 'The PendingPayment reservation and its 10-minute hold',
  })
  @ApiErrors(
    {
      status: 400,
      message: 'Validation failed',
      details: { rooms: ['A reservation needs at least one adult'] },
      description:
        'No adult, a child age outside 0-17, a room over its maxOccupancy, ' +
        'a room listed twice or from another hotel, a room with no guest, ' +
        'checkOut not after checkIn, checkIn in the past, or bad ids',
    },
    UNAUTHENTICATED,
    {
      status: 403,
      message: 'You do not have permission for this action',
      description:
        'Not a registered user (admins and moderators cannot book), or a ' +
        'temporary password must be changed first',
    },
    {
      status: 404,
      message: HOTEL_NOT_FOUND,
      description: `No such hotel, an inactive hotel, or "${ROOM_NOT_FOUND}"`,
    },
    {
      status: 409,
      message: ROOMS_NOT_AVAILABLE,
      description:
        'A room is booked, blocked or held on a night of the stay, inactive, ' +
        'or not bookable on those dates. Nothing was held.',
    },
  )
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateHotelBookingDto) {
    return this.holds.hold(user, dto);
  }
}
