import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import {
  ApiCookieAuth,
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
import { SelectSeatDto } from './dto/select-seat.dto';
import { BOOKING_NOT_FOUND } from './flight-confirmation.service';
import { SeatSelectionService } from './seat-selection.service';

const ID = { name: 'id', example: '6737b2f4c1a2b3c4d5e6f201' };
const FORBIDDEN = {
  status: 403,
  message: 'You do not have permission for this action',
  description: 'Not a registered user',
};
const NOT_FOUND = {
  status: 404,
  message: BOOKING_NOT_FOUND,
  description: "Unknown id, or another user's booking",
};

// FLT-28 (bonus): seat selection on your own flight booking.
@ApiTags('Flight bookings')
@ApiCookieAuth('access_token')
@Roles(Role.USER)
@Controller('flight-bookings')
export class SeatSelectionController {
  constructor(private readonly seats: SeatSelectionService) {}

  @Get(':id/seats')
  @ApiParam(ID)
  @ApiOperation({
    summary: 'Seat maps of my booking, with free and taken seats (FLT-28)',
    description:
      'One map per flight of the booking, in the booked cabin. 6 seats a ' +
      'row (A-F), 4 in Business and First (A, C, D, F). Seats of Expired ' +
      'or Cancelled bookings are free again.',
  })
  @ApiOkResponse({
    description: 'Seat map per flight',
    schema: {
      example: [
        {
          segment: 0,
          flightNumber: 'NP101',
          from: 'CAI',
          to: 'DXB',
          cabin: 'Economy',
          letters: ['A', 'B', 'C', 'D', 'E', 'F'],
          seats: [
            { seat: '1A', taken: true, passengerIndex: null },
            { seat: '1B', taken: false, passengerIndex: 0 },
            { seat: '1C', taken: false, passengerIndex: null },
          ],
          passengers: [{ index: 0, fullName: 'Sara Ali', seat: '1B' }],
        },
      ],
    },
  })
  @ApiErrors(UNAUTHENTICATED, FORBIDDEN, NOT_FOUND)
  seatMap(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.seats.seatsFor(user, id);
  }

  @Patch(':id/seat')
  @ApiParam(ID)
  @ApiOperation({
    summary: 'Choose or change a passenger seat (FLT-28)',
    description:
      'For a Confirmed booking or one awaiting payment, before the flight ' +
      'departs. Infants get no seat. A seat belongs to one passenger only: ' +
      'if two people choose it at the same moment, one gets 409.',
  })
  @ApiOkResponse({
    description: 'The seat now held',
    schema: {
      example: {
        bookingId: '6737b2f4c1a2b3c4d5e6f201',
        segment: 0,
        passengerIndex: 0,
        flightNumber: 'NP101',
        cabin: 'Economy',
        seat: '12A',
      },
    },
  })
  @ApiErrors(
    {
      status: 400,
      message: 'No seat 40A in Economy on this flight',
      description:
        'Unknown seat, flight or passenger, an infant, a departed flight, or ' +
        'a booking that is not Confirmed or awaiting payment',
    },
    UNAUTHENTICATED,
    FORBIDDEN,
    NOT_FOUND,
    { status: 409, message: 'Seat 12A is already taken' },
  )
  select(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: SelectSeatDto,
  ) {
    return this.seats.selectSeat(user, id, dto);
  }
}
