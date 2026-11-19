import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import {
  ApiErrors,
  UNAUTHENTICATED,
} from '../common/swagger/api-error.decorator';
import { AuthUser } from '../common/types/auth-user.type';
import { FLIGHT_NOT_FOUND } from '../flights/flights.service';
import {
  FlightBookingsPageDto,
  FlightBookingsQueryDto,
} from './dto/flight-passengers.dto';
import { FlightPassengersService } from './flight-passengers.service';

const NOT_YOUR_FLIGHT = {
  status: 403,
  message: 'You can only manage your assigned provider',
  description: "Not an airline moderator, or another airline's flight",
};
const NO_FLIGHT = { status: 404, message: FLIGHT_NOT_FOUND };

// Hasan's FLT-29: an airline moderator's bookings and passenger list for one
// of their flights.
@ApiTags('Flights')
@ApiCookieAuth('access_token')
@Controller('flights')
export class FlightPassengersController {
  constructor(private readonly passengers: FlightPassengersService) {}

  @Get(':id/bookings')
  @Roles(Role.AIRLINE_MODERATOR)
  @ApiOperation({
    summary: "A flight's bookings and seats remaining (FLT-29)",
    description:
      'For your own airline: the bookings on this flight (reference, ' +
      'passenger names, cabin, seats and status: Confirmed, Completed or ' +
      'Cancelled), newest first, 10 per page, and the seats remaining in ' +
      'each cabin. Unpaid holds are not listed.',
  })
  @ApiOkResponse({ type: FlightBookingsPageDto })
  @ApiErrors(UNAUTHENTICATED, NOT_YOUR_FLIGHT, NO_FLIGHT)
  list(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() query: FlightBookingsQueryDto,
  ) {
    return this.passengers.listBookings(user, id, query);
  }

  @Get(':id/passengers/export')
  @Roles(Role.AIRLINE_MODERATOR)
  @ApiProduces('text/csv')
  @ApiOperation({
    summary: "Download a flight's passenger list as CSV (FLT-29)",
    description:
      'For your own airline: one row per passenger of the Confirmed and ' +
      'Completed bookings on this flight (reference, name, type, date of ' +
      'birth, passport number, cabin, status), sorted by reference. ' +
      'Cancelled bookings are left out.',
  })
  @ApiOkResponse({
    description: 'A CSV file',
    schema: {
      type: 'string',
      example:
        '"Booking reference","Passenger name","Passenger type","Date of birth","Passport number","Cabin","Booking status"\r\n' +
        '"FL-7K2M9QX4","Sara Ali","adult","1995-01-01","A1234567","Economy","Confirmed"\r\n',
    },
  })
  @ApiErrors(UNAUTHENTICATED, NOT_YOUR_FLIGHT, NO_FLIGHT)
  async export(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { filename, csv } = await this.passengers.exportPassengers(user, id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return csv;
  }
}
