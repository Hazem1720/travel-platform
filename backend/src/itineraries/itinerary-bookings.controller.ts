import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
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
import { LinkBookingDto } from './dto/link-booking.dto';
import { ID_PARAM, NOT_A_USER, NOT_FOUND } from './itineraries.controller';
import { ItineraryBookingsService } from './itinerary-bookings.service';

const EXAMPLE = {
  itineraryId: '6736a1f4c1a2b3c4d5e6f301',
  linkedBookings: [
    {
      _id: '6736a1f4c1a2b3c4d5e6f3a1',
      type: 'hotel',
      bookingId: '6737b2f4c1a2b3c4d5e6f201',
      dayId: '6736a1f4c1a2b3c4d5e6f311',
      dayNumber: 2,
      reference: 'HT-7KQ2M9XA',
      label: 'Nile Hotel, 2026-12-02 to 2026-12-04',
      amount: 450,
      currency: 'USD',
    },
  ],
  budget: {
    total: { USD: 450 },
    byCategory: { accommodation: { USD: 450 } },
  },
};

// ITN-27 (bonus): link your own bookings to days of your itinerary.
@ApiTags('Itineraries')
@ApiCookieAuth('access_token')
@Roles(Role.USER)
@Controller('itineraries')
export class ItineraryBookingsController {
  constructor(private readonly links: ItineraryBookingsService) {}

  @Get(':id/bookings')
  @ApiParam(ID_PARAM)
  @ApiOperation({
    summary: 'Bookings linked to my itinerary, with the budget (ITN-27)',
  })
  @ApiOkResponse({ schema: { example: EXAMPLE } })
  @ApiErrors(UNAUTHENTICATED, NOT_A_USER, NOT_FOUND)
  list(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.links.list(user, id);
  }

  @Post(':id/bookings')
  @ApiParam(ID_PARAM)
  @ApiOperation({
    summary: 'Link one of my bookings to a day; it feeds the budget (ITN-27)',
    description:
      'Your own Confirmed or Completed flight or hotel booking. Its total ' +
      'counts on that day: hotels under Accommodation, flights under ' +
      'Intercity transport. Linked bookings never show on the public ' +
      'itinerary and are not cloned.',
  })
  @ApiCreatedResponse({ schema: { example: EXAMPLE } })
  @ApiErrors(
    {
      status: 400,
      message:
        'Only a Confirmed or Completed booking can be linked (this one is PendingPayment)',
    },
    UNAUTHENTICATED,
    NOT_A_USER,
    {
      status: 404,
      message: 'Booking not found',
      description:
        "Unknown itinerary, day or booking, or another user's itinerary or booking",
    },
    {
      status: 409,
      message: 'This booking is already linked to this itinerary',
    },
  )
  link(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: LinkBookingDto,
  ) {
    return this.links.link(user, id, dto);
  }

  @Delete(':id/bookings/:linkId')
  @ApiParam(ID_PARAM)
  @ApiParam({ name: 'linkId', example: '6736a1f4c1a2b3c4d5e6f3a1' })
  @ApiOperation({ summary: 'Unlink a booking from my itinerary (ITN-27)' })
  @ApiOkResponse({ schema: { example: { ...EXAMPLE, linkedBookings: [] } } })
  @ApiErrors(UNAUTHENTICATED, NOT_A_USER, {
    status: 404,
    message: 'Linked booking not found',
  })
  unlink(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('linkId') linkId: string,
  ) {
    return this.links.unlink(user, id, linkId);
  }
}
