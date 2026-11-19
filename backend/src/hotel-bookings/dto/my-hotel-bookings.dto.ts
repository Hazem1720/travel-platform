import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';

// HTL-20: the three tabs of "My reservations".
export enum ReservationGroup {
  UPCOMING = 'upcoming',
  PAST = 'past',
  CANCELLED = 'cancelled',
}

// GET /hotel-bookings?group=upcoming&page=1&limit=10
// No `sort`: each group has its own natural order (see MyHotelBookingsService).
export class MyHotelBookingsQueryDto extends OmitType(PaginationQueryDto, [
  'sort',
] as const) {
  @ApiPropertyOptional({
    enum: ReservationGroup,
    default: ReservationGroup.UPCOMING,
    description:
      'upcoming: Confirmed stays whose check-out date has not passed yet ' +
      '(soonest check-in first), plus reservations still waiting for ' +
      'payment. past: stays whose check-out date has passed (most recent ' +
      'first). cancelled: Cancelled ' +
      'reservations (most recently cancelled first).',
  })
  @IsOptional()
  @IsEnum(ReservationGroup)
  group: ReservationGroup = ReservationGroup.UPCOMING;
}

class ReservationRoomSummaryDto {
  @ApiProperty({ example: '101' }) name: string;
  @ApiProperty({ example: 'Double' }) type: string;
}

class ReservationGuestsDto {
  @ApiProperty({ example: 2 }) adults: number;
  @ApiProperty({ example: 1 }) children: number;
}

// One row of the list. The full details are GET /hotel-bookings/:id.
export class HotelBookingSummaryDto {
  @ApiProperty({ example: '6736f0a1c1a2b3c4d5e6fa10' }) _id: string;
  @ApiProperty({
    example: 'HT-7K2M9QX4',
    nullable: true,
    type: String,
    description: 'null while the reservation is waiting for payment',
  })
  reference: string | null;
  @ApiProperty({ example: 'Confirmed' }) status: string;
  @ApiProperty({ example: '6735a1f4c1a2b3c4d5e6f801' }) hotelId: string;
  @ApiProperty({ example: 'Nile View Hotel' }) hotelName: string;
  @ApiProperty({ example: '2026-12-05' }) checkIn: string;
  @ApiProperty({ example: '2026-12-08' }) checkOut: string;
  @ApiProperty({ example: 3 }) nights: number;
  @ApiProperty({ type: [ReservationRoomSummaryDto] })
  rooms: ReservationRoomSummaryDto[];
  @ApiProperty({ type: ReservationGuestsDto }) guests: ReservationGuestsDto;
  @ApiProperty({ example: 75000, description: 'USD cents' })
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

export class MyHotelBookingsPageDto {
  @ApiProperty({ type: [HotelBookingSummaryDto] })
  data: HotelBookingSummaryDto[];

  @ApiProperty({ type: PageMetaDto })
  meta: PageMetaDto;
}
