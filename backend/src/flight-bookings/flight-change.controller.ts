import { Body, Controller, Param, Patch } from '@nestjs/common';
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
import { ChangeFlightDto } from './dto/change-flight.dto';
import { BOOKING_NOT_FOUND } from './flight-confirmation.service';
import {
  CHANGE_DEPARTED,
  CHANGE_NOT_CONFIRMED,
  CHANGE_PENDING,
  FLIGHT_FULL,
  FlightChangeService,
  NOTHING_CHANGED,
} from './flight-change.service';

// FLT-27 (bonus): change a Confirmed flight booking's flight or date.
@ApiTags('Flight Bookings')
@ApiCookieAuth('access_token')
@Roles(Role.USER)
@Controller('flight-bookings')
export class FlightChangeController {
  constructor(private readonly changes: FlightChangeService) {}

  @Patch(':id/change-flight')
  @ApiParam({ name: 'id', example: '6737b2f4c1a2b3c4d5e6f201' })
  @ApiOperation({
    summary: 'Move your booking to another flight or date (FLT-27)',
    description:
      'Your own Confirmed booking, before departure: the same route, cabin ' +
      'and passengers on other flights (for a round trip give both; repeat ' +
      'the current one to keep it). The new seats are held first. If the ' +
      'new fare is the same or lower, the change is applied now and the ' +
      'difference refunded (status Confirmed, refund). If it is higher, ' +
      'the change waits 10 minutes (status PendingPayment): pay amountDue ' +
      'with POST /api/payments { bookingType: "flight-change", bookingId: ' +
      'changeId }; Stripe confirming the payment applies it. Seats chosen ' +
      'on a changed flight (FLT-28) are freed. You are notified.',
  })
  @ApiOkResponse({
    schema: {
      example: {
        changeId: '6737c3f4c1a2b3c4d5e6f301',
        bookingId: '6737b2f4c1a2b3c4d5e6f201',
        reference: 'FL-7K2M9Q4X',
        status: 'PendingPayment',
        segments: [
          {
            flightId: '6737a1f4c1a2b3c4d5e6f103',
            flightNumber: 'MS777',
            from: 'CAI',
            to: 'LHR',
            departureAt: '2026-12-21T08:00:00.000Z',
            arrivalAt: '2026-12-21T13:00:00.000Z',
            cabin: 'Economy',
            subtotal: 60000,
          },
        ],
        changedSegments: [0],
        oldTotal: 50000,
        newTotal: 60000,
        difference: 10000,
        currency: 'USD',
        amountDue: 10000,
        expiresAt: '2026-11-19T12:10:00.000Z',
        payWith: {
          method: 'POST',
          path: '/api/payments',
          body: {
            bookingType: 'flight-change',
            bookingId: '6737c3f4c1a2b3c4d5e6f301',
          },
        },
      },
    },
  })
  @ApiErrors(
    {
      status: 400,
      message: NOTHING_CHANGED,
      description:
        'Or Validation failed: another route, a missing or extra ' +
        'returnFlightId, or passengers/bags the new flight does not allow',
    },
    UNAUTHENTICATED,
    { status: 403, message: 'You do not have permission for this action' },
    {
      status: 404,
      message: BOOKING_NOT_FOUND,
      description: "No such booking, another user's booking, or no such flight",
    },
    {
      status: 409,
      message: FLIGHT_FULL,
      description:
        `Or "${CHANGE_NOT_CONFIRMED}", "${CHANGE_DEPARTED}", ` +
        `"${CHANGE_PENDING}", or the new flight has departed`,
    },
  )
  change(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ChangeFlightDto,
  ) {
    return this.changes.request(user, id, dto);
  }
}
