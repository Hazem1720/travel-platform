import { Controller, HttpCode, Param, Post } from '@nestjs/common';
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
import { FLIGHT_NOT_FOUND } from '../flights/flights.service';
import { CancelFlightResultDto } from './dto/cancel-flight.dto';
import {
  FLIGHT_NOT_SCHEDULED,
  FlightCancellationService,
} from './flight-cancellation.service';

// Hasan's FLT-06: an airline moderator cancels one of their flights.
@ApiTags('Flights')
@ApiCookieAuth('access_token')
@Controller('flights')
export class FlightCancellationController {
  constructor(private readonly cancellation: FlightCancellationService) {}

  @Post(':id/cancel')
  @HttpCode(200)
  @Roles(Role.AIRLINE_MODERATOR)
  @ApiOperation({
    summary: 'Cancel a Scheduled flight (FLT-06)',
    description:
      'For your own airline, after confirmation in the interface. The ' +
      'flight becomes Cancelled and disappears from search; its unpaid ' +
      'holds are released; every Confirmed booking on it is Cancelled with ' +
      'a 100% refund and its passengers get an in-app notification. A round ' +
      'trip is cancelled as a whole. Cannot be undone.',
  })
  @ApiOkResponse({ type: CancelFlightResultDto })
  @ApiErrors(
    UNAUTHENTICATED,
    {
      status: 403,
      message: 'You can only manage your assigned provider',
      description: "Not an airline moderator, or another airline's flight",
    },
    { status: 404, message: FLIGHT_NOT_FOUND },
    {
      status: 409,
      message: FLIGHT_NOT_SCHEDULED,
      description: 'Already Cancelled, or already Departed',
    },
  )
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.cancellation.cancel(user, id);
  }
}
