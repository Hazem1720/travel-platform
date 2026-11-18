import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums/role.enum';
import { AuthUser } from '../common/types/auth-user.type';
import {
  ApiErrors,
  MUST_CHANGE_PASSWORD,
  UNAUTHENTICATED,
} from '../common/swagger/api-error.decorator';
import { FlightQuoteDto } from './dto/flight-quote.dto';
import { FlightHoldResultDto } from './dto/flight-hold-result.dto';
import { FlightQuoteResultDto } from './dto/flight-quote-result.dto';
import { FlightHoldService } from './flight-hold.service';
import { FlightQuoteService } from './flight-quote.service';

// Flight bookings for registered users: the quote (FLT-19, FLT-21) here,
// then the hold (FLT-22) and the confirmation routes (FLT-23).
@ApiTags('Flight bookings')
@ApiCookieAuth('access_token')
@Roles(Role.USER)
@Controller('flight-bookings')
export class FlightBookingsController {
  constructor(
    private readonly quotes: FlightQuoteService,
    private readonly holds: FlightHoldService,
  ) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Booking summary: passengers, extra bags and total (FLT-19, FLT-21)',
    description:
      'Checks the flight (or both flights of a round trip), the cabin, ' +
      'each passenger (type must match the date of birth on the departure ' +
      "date) and extra bags (up to the airline's maxExtraBags, each up to " +
      "the cabin's maxKgPerBag), and returns the summary. Nothing is " +
      'reserved: send the same body to POST /flight-bookings/hold to hold ' +
      'the seats for 10 minutes at this exact price.',
  })
  @ApiOkResponse({ type: FlightQuoteResultDto })
  @ApiErrors(
    {
      status: 400,
      message: 'Validation failed',
      details: {
        'passengers.1.dateOfBirth': [
          'This date of birth makes the passenger an adult on the departure date, not a child',
        ],
      },
      description:
        'Invalid passenger, date of birth not matching the type, no adult ' +
        'or more infants than adults, too many or too heavy extra bags, a ' +
        'cabin the flight does not have, or a wrong return flight',
    },
    UNAUTHENTICATED,
    {
      ...MUST_CHANGE_PASSWORD,
      message: 'You do not have permission for this action',
      description:
        'Not a registered user (admins and moderators do not book), a ' +
        'suspended account, or a temporary password to change first',
    },
    {
      status: 404,
      message: 'Flight not found',
      description: 'Unknown or Cancelled flight, or an inactive airline',
    },
    {
      status: 409,
      message: 'Only 3 Economy seats left on flight NP101',
      description: 'Not enough free seats, or the flight has departed',
    },
  )
  quote(@Body() dto: FlightQuoteDto) {
    return this.quotes.quote(dto);
  }

  @Post('hold')
  @ApiOperation({
    summary: 'Hold the seats for 10 minutes before payment (FLT-22)',
    description:
      'Same body as POST /flight-bookings. Reserves the seats on every ' +
      'flight in one atomic step each (never more seats than exist, even ' +
      'for requests at the same moment) and creates a PendingPayment ' +
      'booking with expiresAt = now + 10 minutes and the price snapshot. ' +
      'Unpaid at expiresAt: Expired and the seats released. Then accept ' +
      'the policies and pay (PAY-01, PAY-02).',
  })
  @ApiCreatedResponse({ type: FlightHoldResultDto })
  @ApiErrors(
    {
      status: 400,
      message: 'Validation failed',
      details: {
        'passengers.0.extraBags': ['At most 2 extra bag(s) per passenger'],
      },
      description: 'The same checks as POST /flight-bookings',
    },
    UNAUTHENTICATED,
    {
      ...MUST_CHANGE_PASSWORD,
      message: 'You do not have permission for this action',
      description:
        'Not a registered user, a suspended account, or a temporary ' +
        'password to change first',
    },
    {
      status: 404,
      message: 'Flight not found',
      description: 'Unknown or Cancelled flight, or an inactive airline',
    },
    {
      status: 409,
      message: 'Not enough seats left on this flight; please search again',
      description:
        'The seats went to someone else (for a round trip, no seats are ' +
        'kept on either flight), or the flight has departed',
    },
  )
  hold(@CurrentUser() user: AuthUser, @Body() dto: FlightQuoteDto) {
    return this.holds.hold(user.id, dto);
  }
}
