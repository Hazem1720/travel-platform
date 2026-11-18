import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseEnumPipe,
  Post,
} from '@nestjs/common';
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
import {
  AcceptPoliciesDto,
  BookingPoliciesDto,
  PoliciesAcceptedDto,
} from './dto/booking-policies.dto';
import { PaymentBookingType } from './payment-handler';
import {
  BOOKING_NOT_FOUND,
  HOLD_EXPIRED,
  NOT_PENDING_PAYMENT,
  PaymentsService,
} from './payments.service';

const TYPE_PARAM = {
  name: 'type',
  enum: PaymentBookingType,
  example: PaymentBookingType.HOTEL,
};
const ID_PARAM = { name: 'id', example: '6736f0a1c1a2b3c4d5e6fa10' };
const typePipe = new ParseEnumPipe(PaymentBookingType);
const NOT_FOUND = {
  status: 404,
  message: BOOKING_NOT_FOUND,
  description: "No such booking, or another user's booking",
};
const NOT_A_USER = {
  status: 403,
  message: 'You do not have permission for this action',
  description: 'Not a registered user',
};

// PAY-02 (Memo): the provider's policies before payment and the acceptance
// checkbox. The same routes for flight bookings and hotel reservations; each
// booking module answers through its PaymentHandler.
@ApiTags('Payments')
@ApiCookieAuth('access_token')
@Roles(Role.USER)
@Controller('bookings')
export class BookingPoliciesController {
  constructor(private readonly payments: PaymentsService) {}

  @Get(':type/:id/policies')
  @ApiParam(TYPE_PARAM)
  @ApiParam(ID_PARAM)
  @ApiOperation({
    summary: "The provider's policies to accept before paying (PAY-02)",
    description:
      'Your own booking only. Hotel: the cancellation tiers and the ' +
      "check-in and check-out times. Flight: the airline's cancellation " +
      'tiers and baggage policy (free bags per cabin, extra-bag price and ' +
      'limit). accepted and policiesAcceptedAt say whether you already ' +
      'accepted them.',
  })
  @ApiOkResponse({ type: BookingPoliciesDto })
  @ApiErrors(
    {
      status: 400,
      message: 'Validation failed (enum string is expected)',
      description: 'type is not flight or hotel',
    },
    UNAUTHENTICATED,
    NOT_A_USER,
    NOT_FOUND,
  )
  policies(
    @CurrentUser() user: AuthUser,
    @Param('type', typePipe) type: PaymentBookingType,
    @Param('id') id: string,
  ) {
    return this.payments.getPolicies(type, id, user.id);
  }

  @Post(':type/:id/accept-policies')
  @HttpCode(200)
  @ApiParam(TYPE_PARAM)
  @ApiParam(ID_PARAM)
  @ApiOperation({
    summary: 'Accept the policies; payment is blocked until then (PAY-02)',
    description:
      'Send { "accepted": true } (the ticked checkbox). Stores ' +
      'policiesAcceptedAt with the current time on your PendingPayment ' +
      'booking; payment (PAY-01) answers 400 until it is set. Accepting ' +
      'again keeps the first timestamp.',
  })
  @ApiOkResponse({ type: PoliciesAcceptedDto })
  @ApiErrors(
    {
      status: 400,
      message: 'Validation failed',
      details: { accepted: ['You must accept the policies to continue'] },
      description: 'accepted is missing or not true, or an unknown type',
    },
    UNAUTHENTICATED,
    NOT_A_USER,
    NOT_FOUND,
    {
      status: 409,
      message: NOT_PENDING_PAYMENT,
      description: `The booking is no longer waiting for payment, or "${HOLD_EXPIRED}"`,
    },
  )
  accept(
    @CurrentUser() user: AuthUser,
    @Param('type', typePipe) type: PaymentBookingType,
    @Param('id') id: string,
    @Body() dto: AcceptPoliciesDto,
  ) {
    // The ValidationPipe already refuses anything but accepted: true; this
    // keeps the rule even if the route is ever called without it.
    if (dto.accepted !== true) {
      throw new BadRequestException({
        error: 'Bad Request',
        message: 'Validation failed',
        details: { accepted: ['You must accept the policies to continue'] },
      });
    }
    return this.payments.acceptPolicies(type, id, user.id);
  }
}
