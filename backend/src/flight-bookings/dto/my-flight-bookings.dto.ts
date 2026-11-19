import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';

// FLT-25: the three tabs of "My flight bookings".
export enum FlightBookingGroup {
  UPCOMING = 'upcoming',
  PAST = 'past',
  CANCELLED = 'cancelled',
}

// GET /flight-bookings?group=upcoming&page=1&limit=10
// No `sort`: each group has its own natural order.
export class MyFlightBookingsQueryDto extends OmitType(PaginationQueryDto, [
  'sort',
] as const) {
  @ApiPropertyOptional({
    enum: FlightBookingGroup,
    default: FlightBookingGroup.UPCOMING,
    description:
      'upcoming: Confirmed bookings with a flight that has not landed yet ' +
      '(soonest departure first), plus bookings still waiting for payment. ' +
      'past: bookings whose flights have all landed (most recent first). ' +
      'cancelled: Cancelled bookings (most recently cancelled first).',
  })
  @IsOptional()
  @IsEnum(FlightBookingGroup)
  group: FlightBookingGroup = FlightBookingGroup.UPCOMING;
}

class FlightSummaryDto {
  @ApiProperty({ example: 'MS777' }) flightNumber: string;
  @ApiProperty({ example: 'CAI' }) from: string;
  @ApiProperty({ example: 'CDG' }) to: string;
  @ApiProperty({ example: '2026-12-05T08:00:00.000Z', description: 'UTC' })
  departureAt: string;
  @ApiProperty({ example: '2026-12-05T13:00:00.000Z', description: 'UTC' })
  arrivalAt: string;
  @ApiProperty({ example: 'Economy' }) cabin: string;
}

class PassengerSummaryDto {
  @ApiProperty({ example: 'Sara Ali' }) fullName: string;
  @ApiProperty({ example: 'adult' }) type: string;
}

// One row of the list. The full details are GET /flight-bookings/:id.
export class FlightBookingSummaryDto {
  @ApiProperty({ example: '6736f0a1c1a2b3c4d5e6fb10' }) _id: string;
  @ApiProperty({
    example: 'FL-7K2M9QX4',
    nullable: true,
    type: String,
    description: 'null while the booking is waiting for payment',
  })
  reference: string | null;
  @ApiProperty({ example: 'Confirmed' }) status: string;
  @ApiProperty({
    type: [FlightSummaryDto],
    description: 'Outbound, then the return flight of a round trip',
  })
  segments: FlightSummaryDto[];
  @ApiProperty({ type: [PassengerSummaryDto] })
  passengers: PassengerSummaryDto[];
  @ApiProperty({ example: 52000, description: 'USD cents' })
  totalAmount: number;
  @ApiProperty({ example: 'USD' }) currency: string;
  @ApiProperty({
    example: null,
    nullable: true,
    type: String,
    description: 'End of the payment hold, only while PendingPayment',
  })
  expiresAt: string | null;
  @ApiProperty({ example: null, nullable: true, type: String })
  cancelledAt: string | null;
  @ApiProperty({ example: '2026-11-18T10:00:00.000Z' }) createdAt: string;
}

class PageMetaDto {
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 10 }) limit: number;
  @ApiProperty({ example: 1 }) total: number;
  @ApiProperty({ example: 1 }) totalPages: number;
}

export class MyFlightBookingsPageDto {
  @ApiProperty({ type: [FlightBookingSummaryDto] })
  data: FlightBookingSummaryDto[];

  @ApiProperty({ type: PageMetaDto })
  meta: PageMetaDto;
}
