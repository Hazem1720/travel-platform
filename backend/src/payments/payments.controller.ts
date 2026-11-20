import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseEnumPipe,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireVerifiedEmail } from '../common/decorators/verified-email.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import {
  ApiErrors,
  UNAUTHENTICATED,
} from '../common/swagger/api-error.decorator';
import { AuthUser } from '../common/types/auth-user.type';
import {
  CreatedPaymentDto,
  WebhookReceivedDto,
} from './dto/created-payment.dto';
import { CreatePaymentDto, PaymentDto } from './dto/create-payment.dto';
import { RefundDto } from './dto/refund.dto';
import { PaymentBookingType } from './payment-handler';
import {
  ALREADY_PAID,
  BOOKING_NOT_FOUND,
  HOLD_EXPIRED,
  NOT_PENDING_PAYMENT,
  PAYMENT_NOT_FOUND,
  PaymentsService,
  POLICIES_NOT_ACCEPTED,
  REFUND_NOT_FOUND,
} from './payments.service';
import {
  INVALID_SIGNATURE,
  PAYMENTS_NOT_CONFIGURED,
  PROVIDER_ERROR,
  StripeGateway,
  WEBHOOK_NOT_CONFIGURED,
} from './stripe.gateway';

// PAY-01 (Memo): paying for a PendingPayment flight booking or hotel
// reservation within its hold.
@ApiTags('Payments')
@ApiCookieAuth('access_token')
@Roles(Role.USER)
@Controller('bookings')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post(':type/:id/pay')
  // ACC-02 (bonus): 403 until the account's email is verified.
  @RequireVerifiedEmail()
  @ApiParam({
    name: 'type',
    enum: PaymentBookingType,
    example: PaymentBookingType.FLIGHT,
  })
  @ApiParam({ name: 'id', example: '6737b2f4c1a2b3c4d5e6f201' })
  @ApiOperation({
    summary: 'Start paying for your booking with Stripe (PAY-01)',
    description:
      'Your own PendingPayment booking, within its 10-minute hold, after ' +
      'accepting the policies (PAY-02). Creates a Stripe PaymentIntent (test ' +
      'mode) for the booking total and returns its clientSecret for Stripe ' +
      'Elements. The booking is confirmed only when Stripe tells the ' +
      'backend the payment succeeded (webhook), so poll the booking ' +
      'afterwards. After a declined card, call this again to retry: it ' +
      'returns the same PaymentIntent until the hold ends.',
  })
  @ApiCreatedResponse({ type: CreatedPaymentDto })
  @ApiErrors(
    {
      status: 400,
      message: POLICIES_NOT_ACCEPTED,
      description:
        'The policies are not accepted yet (PAY-02), or type is not flight or hotel',
    },
    UNAUTHENTICATED,
    {
      status: 403,
      message: 'You do not have permission for this action',
      description: 'Not a registered user',
    },
    {
      status: 404,
      message: BOOKING_NOT_FOUND,
      description: "No such booking, or another user's booking",
    },
    {
      status: 409,
      message: HOLD_EXPIRED,
      description: `The hold has run out, or "${NOT_PENDING_PAYMENT}"`,
    },
    {
      status: 502,
      message: PROVIDER_ERROR,
      description: 'Stripe could not be reached or refused the request',
    },
    { status: 503, message: PAYMENTS_NOT_CONFIGURED },
  )
  pay(
    @CurrentUser() user: AuthUser,
    @Param('type', new ParseEnumPipe(PaymentBookingType))
    type: PaymentBookingType,
    @Param('id') id: string,
  ) {
    return this.payments.createPayment(type, id, user.id);
  }
}

// PAY-01, as section 8.7 of the project description lists it: POST
// /api/payments, POST /api/payments/:id/retry and GET /api/payments/:id.
// POST /api/payments does the same as POST /api/bookings/:type/:id/pay.
@ApiTags('Payments')
@ApiCookieAuth('access_token')
@Roles(Role.USER)
@Controller('payments')
export class PaymentsResourceController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  // ACC-02 (bonus): 403 until the account's email is verified.
  @RequireVerifiedEmail()
  @ApiOperation({
    summary: 'Start paying for your booking with Stripe (PAY-01)',
    description:
      'Same as POST /api/bookings/{type}/{id}/pay: your own PendingPayment ' +
      'booking, within its hold, after accepting the policies (PAY-02). ' +
      'Returns the clientSecret for Stripe Elements; the booking is ' +
      'confirmed only when Stripe reports success (webhook).',
  })
  @ApiCreatedResponse({ type: CreatedPaymentDto })
  @ApiErrors(
    { status: 400, message: POLICIES_NOT_ACCEPTED },
    UNAUTHENTICATED,
    {
      status: 403,
      message: 'You do not have permission for this action',
      description: 'Not a registered user',
    },
    { status: 404, message: BOOKING_NOT_FOUND },
    { status: 409, message: HOLD_EXPIRED },
    { status: 502, message: PROVIDER_ERROR },
    { status: 503, message: PAYMENTS_NOT_CONFIGURED },
  )
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePaymentDto) {
    return this.payments.createPayment(dto.bookingType, dto.bookingId, user.id);
  }

  @Post(':id/retry')
  @HttpCode(200)
  @RequireVerifiedEmail()
  @ApiParam({ name: 'id', example: '6737c0a1c1a2b3c4d5e6fc01' })
  @ApiOperation({
    summary: 'Retry a payment after a declined card (PAY-01)',
    description:
      'Pays the same booking again while its hold lasts, with the same ' +
      'rules as paying. A payment that already succeeded is 409.',
  })
  @ApiOkResponse({ type: CreatedPaymentDto })
  @ApiErrors(
    UNAUTHENTICATED,
    {
      status: 404,
      message: PAYMENT_NOT_FOUND,
      description: "Unknown id, or another user's payment",
    },
    {
      status: 409,
      message: ALREADY_PAID,
      description: `Or the hold has run out: "${HOLD_EXPIRED}"`,
    },
  )
  retry(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.payments.retryPayment(user, id);
  }

  @Get(':id')
  @ApiParam({ name: 'id', example: '6737c0a1c1a2b3c4d5e6fc01' })
  @ApiOperation({ summary: 'Your payment and its status (PAY-01)' })
  @ApiOkResponse({ type: PaymentDto })
  @ApiErrors(UNAUTHENTICATED, {
    status: 404,
    message: PAYMENT_NOT_FOUND,
    description: "Unknown id, or another user's payment",
  })
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.payments.getPayment(user, id);
  }
}

// PAY-01: Stripe calls this, not the frontend. Public because Stripe has no
// session; the Stripe-Signature header (checked against the raw body with
// STRIPE_WEBHOOK_SECRET) is what proves the event is real.
@ApiTags('Payments')
@Controller('payments')
export class StripeWebhookController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly stripe: StripeGateway,
  ) {}

  @Public()
  @Post('webhook')
  @HttpCode(200)
  @ApiHeader({
    name: 'stripe-signature',
    required: true,
    description: 'Set by Stripe; checked with STRIPE_WEBHOOK_SECRET',
  })
  @ApiOperation({
    summary: 'Stripe webhook: payment events (PAY-01)',
    description:
      'For Stripe only. Verifies the signature, then: ' +
      'payment_intent.succeeded confirms the booking (FLT-23, HTL-17); ' +
      'payment_intent.payment_failed marks the payment Failed (the user may ' +
      'retry until the hold ends); payment_intent.canceled marks it ' +
      'Expired. refund.created, refund.updated, refund.failed and ' +
      'charge.refund.updated update the refund status (PAY-03). Other ' +
      'events are acknowledged and ignored. Locally, run ' +
      '`stripe listen --forward-to localhost:3000/api/payments/webhook ' +
      '--events payment_intent.succeeded,payment_intent.payment_failed,' +
      'payment_intent.canceled,refund.created,refund.updated,' +
      'refund.failed,charge.refund.updated`.',
  })
  @ApiOkResponse({ type: WebhookReceivedDto })
  @ApiErrors(
    {
      status: 400,
      message: INVALID_SIGNATURE,
      description: 'Missing or wrong Stripe-Signature, or a changed body',
    },
    {
      status: 500,
      message: 'Internal server error',
      description: 'Confirming failed; Stripe sends the event again later',
    },
    { status: 503, message: WEBHOOK_NOT_CONFIGURED },
  )
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    const event = this.stripe.verifyEvent(req.rawBody, signature);
    await this.payments.handleStripeEvent(
      event.type,
      event.intent,
      event.refund,
    );
    return { received: true };
  }
}

// PAY-03 (Memo): a user's own refund. The booking details
// (GET /flight-bookings/:id, GET /hotel-bookings/:id) list them too.
@ApiTags('Payments')
@ApiCookieAuth('access_token')
@Roles(Role.USER)
@Controller('refunds')
export class RefundsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get(':id')
  @ApiParam({ name: 'id', example: '6737d1a2c1a2b3c4d5e6fd01' })
  @ApiOperation({
    summary: 'Your refund and its status (PAY-03)',
    description:
      'A refund made through Stripe when a booking was cancelled with a ' +
      'positive refund amount: amount in cents and status Pending, ' +
      "Refunded or Failed. Another user's refund answers 404.",
  })
  @ApiOkResponse({ type: RefundDto })
  @ApiErrors(
    UNAUTHENTICATED,
    {
      status: 403,
      message: 'You do not have permission for this action',
      description: 'Not a registered user',
    },
    {
      status: 404,
      message: REFUND_NOT_FOUND,
      description: "No such refund, or another user's refund",
    },
  )
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.payments.getRefundFor(user, id);
  }
}
