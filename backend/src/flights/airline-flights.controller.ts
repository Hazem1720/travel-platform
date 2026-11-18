import { Controller, Get, Param, Query } from '@nestjs/common';
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
import { assertOwnsProvider } from '../common/helpers/provider-ownership';
import {
  ApiErrors,
  UNAUTHENTICATED,
} from '../common/swagger/api-error.decorator';
import { AuthUser } from '../common/types/auth-user.type';
import { FlightPageDto } from './dto/flight.dto';
import { FlightQueryDto } from './dto/flight-query.dto';
import { NOT_YOUR_AIRLINE } from './flights.controller';
import { FlightsService } from './flights.service';

@ApiTags('Flights (airline moderator)')
@ApiCookieAuth('access_token')
@Controller('airlines')
export class AirlineFlightsController {
  constructor(private readonly flights: FlightsService) {}

  @Get(':id/flights')
  @Roles(Role.AIRLINE_MODERATOR)
  @ApiParam({ name: 'id', example: '6735a1f4c1a2b3c4d5e6f701' })
  @ApiOperation({
    summary: "Your airline's flights, next departure first (FLT-03)",
    description: 'Paginated, 10 per page. Optional ?status filter.',
  })
  @ApiOkResponse({ type: FlightPageDto })
  @ApiErrors(
    {
      status: 400,
      message: 'Validation failed',
      details: { status: ['status must be one of the following values: ...'] },
    },
    UNAUTHENTICATED,
    NOT_YOUR_AIRLINE,
  )
  list(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() q: FlightQueryDto,
  ) {
    assertOwnsProvider(user, Role.AIRLINE_MODERATOR, id);
    return this.flights.listForAirline(id, q);
  }
}
