import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireVerifiedEmail } from '../common/decorators/verified-email.decorator';
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
  HotelBookingViewDto,
} from './dto/create-hotel-booking.dto';
import {
  ROOM_NOT_FOUND,
  ROOMS_NOT_AVAILABLE,
} from './hotel-availability.service';
import {
  HotelConfirmationService,
  RESERVATION_NOT_FOUND,
} from './hotel-confirmation.service';
import { HotelHoldService } from './hotel-hold.service';
import { HOTEL_NOT_FOUND } from './hotel-rooms.service';
import { PaymentBookingType } from '../payments/payment-handler';
import { PaymentsService } from '../payments/payments.service';

// Memo's hotel reservations: HTL-16 and HTL-18 (book and hold) and HTL-17
// (GET /hotel-bookings/:id, the confirmation page; Hasan's HTL-20 reuses
// it). Hasan's routes (HTL-20 to HTL-22) live in his own controller under
// the same prefix.
@ApiTags('Hotel bookings')
@ApiCookieAuth('access_token')
@Controller('hotel-bookings')
export class HotelBookingsController {
  constructor(
    private readonly holds: HotelHoldService,
    private readonly confirmations: HotelConfirmationService,
    private readonly payments: PaymentsService,
  ) {}

  @Post()
  @Roles(Role.USER)
  // ACC-02 (bonus): 403 until the account's email is verified.
  @RequireVerifiedEmail()
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

  @Get(':id')
  @Roles(Role.USER)
  @ApiParam({ name: 'id', example: '6736f0a1c1a2b3c4d5e6fa10' })
  @ApiOperation({
    summary: 'Your reservation: the confirmation page (HTL-17)',
    description:
      'Your own reservation in any status, with its HT- reference once paid, ' +
      'the rooms and guests, the total, and the hotel address and ' +
      'check-in/check-out times. After paying, poll this until status is ' +
      "Confirmed. Another user's reservation answers 404.",
  })
  @ApiOkResponse({ type: HotelBookingViewDto })
  @ApiErrors(
    UNAUTHENTICATED,
    {
      status: 403,
      message: 'You do not have permission for this action',
      description: 'Not a registered user',
    },
    {
      status: 404,
      message: RESERVATION_NOT_FOUND,
      description: "No such reservation, or another user's reservation",
    },
  )
  async findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const reservation = await this.confirmations.getForOwner(user, id);
    // PAY-03: its refunds and their status.
    const refunds = await this.payments.refundsFor(
      PaymentBookingType.HOTEL,
      id,
    );
    return { ...reservation, refunds };
  }
}
