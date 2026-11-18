import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
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
  MUST_CHANGE_PASSWORD,
  UNAUTHENTICATED,
} from '../common/swagger/api-error.decorator';
import { AuthUser } from '../common/types/auth-user.type';
import { AddCabinDto } from './dto/add-cabin.dto';
import { CreateFlightDto } from './dto/create-flight.dto';
import { FlightDto } from './dto/flight.dto';
import { UpdateCabinDto } from './dto/update-cabin.dto';
import { UpdateFlightDto } from './dto/update-flight.dto';
import {
  AIRPORTS_LOCKED,
  CABIN_NOT_FOUND,
  FLIGHT_NOT_FOUND,
  FlightsService,
  NOT_SCHEDULED,
} from './flights.service';

export const NOT_YOUR_AIRLINE = {
  status: 403,
  message: 'You can only manage your assigned provider',
  description:
    "Not this airline's moderator, or not an airline moderator (other " +
    `403s: suspended account, or "${MUST_CHANGE_PASSWORD.message}")`,
};

// Hazem's flight routes: POST and PATCH only. GET /flights/search and
// GET /flights/:id are Aabsy's (team plan, B4).
@ApiTags('Flights (airline moderator)')
@ApiCookieAuth('access_token')
@Controller('flights')
export class FlightsController {
  constructor(private readonly flights: FlightsService) {}

  @Post()
  @Roles(Role.AIRLINE_MODERATOR)
  @ApiOperation({
    summary: 'Create a flight for your airline (FLT-03)',
    description:
      'Times are local at each airport (no offset) and stored in UTC. ' +
      'The response shows each time in UTC and in its airport time zone ' +
      '(GEN-06). Add cabins next with POST /flights/:id/cabins.',
  })
  @ApiCreatedResponse({ type: FlightDto, description: 'The new flight' })
  @ApiErrors(
    {
      status: 400,
      message: 'Validation failed',
      details: {
        arrivalLocal: ['Arrival must be after departure (compared in UTC)'],
      },
      description:
        'Same airports, unknown airport, arrival not after departure, ' +
        'departure in the past, or a malformed time',
    },
    UNAUTHENTICATED,
    NOT_YOUR_AIRLINE,
    {
      status: 409,
      message: 'Your airline already has flight NP101 on 2026-12-01',
      details: { flightNumber: ['must be unique per departure date'] },
    },
  )
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateFlightDto) {
    return this.flights.create(user, dto);
  }

  @Post(':id/cabins')
  @Roles(Role.AIRLINE_MODERATOR)
  @ApiParam({ name: 'id', example: '6736d4f4c1a2b3c4d5e6fa01' })
  @ApiOperation({
    summary: 'Add a cabin category to your flight (FLT-04)',
    description:
      'Economy, Premium Economy, Business or First, each at most once per ' +
      'flight. Price in USD cents.',
  })
  @ApiCreatedResponse({ type: FlightDto, description: 'The flight' })
  @ApiErrors(
    {
      status: 400,
      message: 'Validation failed',
      details: { totalSeats: ['totalSeats must not be less than 1'] },
      description: `Invalid fields, or: "${NOT_SCHEDULED}"`,
    },
    UNAUTHENTICATED,
    NOT_YOUR_AIRLINE,
    { status: 404, message: FLIGHT_NOT_FOUND },
    {
      status: 409,
      message: 'This flight already has a Economy cabin',
      details: { category: ['must be unique per flight'] },
    },
  )
  addCabin(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: AddCabinDto,
  ) {
    return this.flights.addCabin(user, id, dto);
  }

  @Patch(':id')
  @Roles(Role.AIRLINE_MODERATOR)
  @ApiParam({ name: 'id', example: '6736d4f4c1a2b3c4d5e6fa01' })
  @ApiOperation({
    summary: 'Edit the airports or times of your Scheduled flight (FLT-05)',
    description:
      'Local times at each airport, as in FLT-03. Airports cannot change ' +
      'once the flight has a booking. A time change sends an in-app ' +
      'notification to passengers with a Confirmed booking.',
  })
  @ApiOkResponse({ type: FlightDto, description: 'The updated flight' })
  @ApiErrors(
    {
      status: 400,
      message: AIRPORTS_LOCKED,
      description:
        `"${NOT_SCHEDULED}", the FLT-03 time and airport rules, ` +
        'or no field sent',
    },
    UNAUTHENTICATED,
    NOT_YOUR_AIRLINE,
    { status: 404, message: FLIGHT_NOT_FOUND },
    {
      status: 409,
      message: 'Your airline already has flight NP101 on 2026-12-02',
      description: 'The new date clashes with the same flight number',
    },
  )
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateFlightDto,
  ) {
    return this.flights.update(user, id, dto);
  }

  @Patch(':id/cabins/:cabinId')
  @Roles(Role.AIRLINE_MODERATOR)
  @ApiParam({ name: 'id', example: '6736d4f4c1a2b3c4d5e6fa01' })
  @ApiParam({ name: 'cabinId', example: '6736d4f4c1a2b3c4d5e6fb01' })
  @ApiOperation({
    summary: 'Edit the price or seat count of a cabin (FLT-04, FLT-05)',
    description:
      'Seats cannot go below the seats already booked or held. A new price ' +
      'does not change existing bookings (they keep their price snapshot).',
  })
  @ApiOkResponse({ type: FlightDto, description: 'The updated flight' })
  @ApiErrors(
    {
      status: 400,
      message: NOT_SCHEDULED,
      description: 'Or invalid fields, or no field sent',
    },
    UNAUTHENTICATED,
    NOT_YOUR_AIRLINE,
    { status: 404, message: CABIN_NOT_FOUND },
    {
      status: 409,
      message: 'Seats cannot go below the 12 already booked or held',
    },
  )
  updateCabin(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('cabinId') cabinId: string,
    @Body() dto: UpdateCabinDto,
  ) {
    return this.flights.updateCabin(user, id, cabinId, dto);
  }
}
