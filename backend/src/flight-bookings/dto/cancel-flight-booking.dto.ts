import { ApiProperty } from '@nestjs/swagger';
import { IsCents } from '../../common/helpers/money';

// FLT-26: POST /flight-bookings/:id/cancel. The user confirms the refund
// they were shown by GET /flight-bookings/:id/cancellation; if it is no
// longer right (the airline changed its tiers, or a day passed), 409.
export class CancelFlightBookingDto {
  @ApiProperty({
    example: 31200,
    description:
      'The refundAmount shown by GET /flight-bookings/:id/cancellation, USD cents',
  })
  @IsCents()
  refundAmount: number;
}

class TierDto {
  @ApiProperty({ example: 7 }) daysBefore: number;
  @ApiProperty({ example: 50 }) refundPercent: number;
}

class SegmentDto {
  @ApiProperty({ example: 'MS777' }) flightNumber: string;
  @ApiProperty({ example: 'CAI' }) from: string;
  @ApiProperty({ example: 'CDG' }) to: string;
  @ApiProperty({ example: '2026-12-05T08:00:00.000Z' }) departureAt: string;
}

// FLT-26: GET /flight-bookings/:id/cancellation
export class FlightCancellationQuoteDto {
  @ApiProperty({ example: '6736f0a1c1a2b3c4d5e6fb10' }) bookingId: string;
  @ApiProperty({ example: 'FL-7K2M9QX4' }) reference: string;
  @ApiProperty({
    type: [SegmentDto],
    description: 'Outbound, then the return of a round trip',
  })
  segments: SegmentDto[];
  @ApiProperty({ example: 62400, description: 'USD cents' })
  totalAmount: number;
  @ApiProperty({
    example: 10,
    description:
      "Days until the outbound departure, in its airport's local date",
  })
  daysBeforeDeparture: number;
  @ApiProperty({ example: 50 }) refundPercent: number;
  @ApiProperty({
    example: 31200,
    description: 'USD cents; send it back to POST /flight-bookings/:id/cancel',
  })
  refundAmount: number;
  @ApiProperty({ example: 'USD' }) currency: string;
  @ApiProperty({
    type: [TierDto],
    description: "The airline's tiers, most days first",
  })
  cancellationTiers: TierDto[];
}

class RefundDto {
  @ApiProperty({ example: '6736f0a1c1a2b3c4d5e6fc01' }) refundId: string;
  @ApiProperty({ example: 31200 }) amount: number;
  @ApiProperty({ example: 'USD' }) currency: string;
  @ApiProperty({
    example: 'Pending',
    description: 'Pending, Refunded or Failed',
  })
  status: string;
}

// FLT-26: POST /flight-bookings/:id/cancel
export class FlightCancellationResultDto {
  @ApiProperty({ example: '6736f0a1c1a2b3c4d5e6fb10' }) bookingId: string;
  @ApiProperty({ example: 'FL-7K2M9QX4' }) reference: string;
  @ApiProperty({ example: 'Cancelled' }) status: string;
  @ApiProperty({ example: '2026-11-25T10:00:00.000Z' }) cancelledAt: string;
  @ApiProperty({ example: 50 }) refundPercent: number;
  @ApiProperty({ example: 31200, description: 'USD cents' })
  refundAmount: number;
  @ApiProperty({
    type: RefundDto,
    nullable: true,
    description: 'null when the refund is 0',
  })
  refund: RefundDto | null;
}
