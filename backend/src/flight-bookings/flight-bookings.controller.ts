import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireVerifiedEmail } from '../common/decorators/verified-email.decorator';
import { Role } from '../common/enums/role.enum';
import { AuthUser } from '../common/types/auth-user.type';
import {
  ApiErrors,
  MUST_CHANGE_PASSWORD,
  UNAUTHENTICATED,
} from '../common/swagger/api-error.decorator';
import { FlightQuoteDto } from './dto/flight-quote.dto';
import {
  FlightBookingViewDto,
  FlightHoldResultDto,
} from './dto/flight-hold-result.dto';
import { renderETicket } from './e-ticket.pdf';
import {
  BOOKING_NOT_FOUND,
  ETICKET_NOT_CONFIRMED,
  FlightConfirmationService,
} from './flight-confirmation.service';
import { FlightQuoteResultDto } from './dto/flight-quote-result.dto';
import { FlightHoldService } from './flight-hold.service';
import { FlightQuoteService } from './flight-quote.service';
import { PaymentBookingType } from '../payments/payment-handler';
import { PaymentsService } from '../payments/payments.service';

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
    private readonly confirmations: FlightConfirmationService,
    private readonly payments: PaymentsService,
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
  // ACC-02 (bonus): 403 until the account's email is verified.
  @RequireVerifiedEmail()
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

  @Get(':id')
  @ApiParam({ name: 'id', example: '6737b2f4c1a2b3c4d5e6f201' })
  @ApiOperation({
    summary: 'My flight booking: the confirmation page (FLT-23)',
    description:
      'The reference, status, every flight with local departure and ' +
      'arrival times, cabin, passengers, baggage and the price paid. Only ' +
      "the owner sees it; another user's booking answers 404.",
  })
  @ApiOkResponse({ type: FlightBookingViewDto })
  @ApiErrors(
    UNAUTHENTICATED,
    {
      ...MUST_CHANGE_PASSWORD,
      message: 'You do not have permission for this action',
      description: 'Not a registered user, or the account must act first',
    },
    {
      status: 404,
      message: BOOKING_NOT_FOUND,
      description: "Unknown id, or another user's booking",
    },
  )
  async findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const booking = await this.confirmations.getForOwner(user.id, id);
    // PAY-03 (added by Memo): the booking's refunds and their status.
    const refunds = await this.payments.refundsFor(
      PaymentBookingType.FLIGHT,
      id,
    );
    return { ...booking, refunds };
  }

  @Get(':id/e-ticket')
  @ApiParam({ name: 'id', example: '6737b2f4c1a2b3c4d5e6f201' })
  @ApiOperation({
    summary: 'Download the e-ticket PDF of my Confirmed booking (FLT-23)',
    description:
      'Reference, flights with local times, passenger names and the total.',
  })
  // The PDF type on the 200 response only, so the error examples stay JSON.
  @ApiOkResponse({
    description: 'The e-ticket as a PDF file',
    content: {
      'application/pdf': { schema: { type: 'string', format: 'binary' } },
    },
  })
  @ApiErrors(
    {
      status: 400,
      message: ETICKET_NOT_CONFIRMED,
      description: 'The booking is not Confirmed (for example PendingPayment)',
    },
    UNAUTHENTICATED,
    {
      ...MUST_CHANGE_PASSWORD,
      message: 'You do not have permission for this action',
      description: 'Not a registered user, or the account must act first',
    },
    {
      status: 404,
      message: BOOKING_NOT_FOUND,
      description: "Unknown id, or another user's booking",
    },
  )
  async eTicket(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const booking = await this.confirmations.getTicketData(user.id, id);
    const pdf = await renderETicket(booking);
    res
      .status(200)
      .set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="e-ticket-${booking.reference}.pdf"`,
        'Content-Length': String(pdf.length),
      })
      .end(pdf);
  }
}
