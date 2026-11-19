import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';
import { IsDateOnly } from '../../hotels/dto/date-only';

// Reservations a hotel moderator sees: paid ones, staying, stayed or
// cancelled. Holds that were never paid (PendingPayment, Expired) are not
// reservations yet.
export const MODERATOR_VISIBLE = [
  BookingStatus.CONFIRMED,
  BookingStatus.COMPLETED,
  BookingStatus.CANCELLED,
];

// HTL-22: GET /hotels/:id/reservations. Always sorted by check-in date.
export class HotelReservationsQueryDto extends OmitType(PaginationQueryDto, [
  'sort',
] as const) {
  @ApiPropertyOptional({ enum: MODERATOR_VISIBLE, example: 'Confirmed' })
  @IsOptional()
  @IsIn(MODERATOR_VISIBLE)
  status?: BookingStatus;

  @ApiPropertyOptional({
    example: '2026-12-01',
    description: 'Only stays with a night on or after this date',
  })
  @IsOptional()
  @IsDateOnly()
  from?: string;

  @ApiPropertyOptional({
    example: '2026-12-31',
    description: 'Only stays with a night on or before this date',
  })
  @IsOptional()
  @IsDateOnly()
  to?: string;
}

class GuestDto {
  @ApiProperty({ example: '6735a1f4c1a2b3c4d5e6f003' }) _id: string;
  @ApiProperty({ example: 'Sara Ali' }) name: string;
  @ApiProperty({ example: 'sara@example.com' }) email: string;
}

class GuestCountDto {
  @ApiProperty({ example: 2 }) adults: number;
  @ApiProperty({ example: 1 }) children: number;
}

class RoomNameDto {
  @ApiProperty({ example: 'Deluxe 204' }) name: string;
  @ApiProperty({ example: 'Double' }) type: string;
}

class HotelReservationRowDto {
  @ApiProperty({ example: '6736f0a1c1a2b3c4d5e6fb20' }) _id: string;
  @ApiProperty({ example: 'HT-7K2M9QX4' }) reference: string;
  @ApiProperty({
    example: 'Confirmed',
    description: 'Confirmed, Completed or Cancelled',
  })
  status: string;
  @ApiProperty({ type: GuestDto, description: 'The user who booked' })
  guest: GuestDto;
  @ApiProperty({ type: GuestCountDto }) guests: GuestCountDto;
  @ApiProperty({ example: '2026-12-05' }) checkIn: string;
  @ApiProperty({ example: '2026-12-08' }) checkOut: string;
  @ApiProperty({ example: 3 }) nights: number;
  @ApiProperty({ type: [RoomNameDto] }) rooms: RoomNameDto[];
  @ApiProperty({ example: 45000, description: 'USD cents' })
  totalAmount: number;
  @ApiProperty({ example: 'USD' }) currency: string;
  @ApiProperty({ example: null, nullable: true }) cancelledAt: string | null;
}

class PageMetaDto {
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 10 }) limit: number;
  @ApiProperty({ example: 1 }) total: number;
  @ApiProperty({ example: 1 }) totalPages: number;
}

export class HotelReservationsPageDto {
  @ApiProperty({
    type: [HotelReservationRowDto],
    description: 'By check-in date, earliest first',
  })
  data: HotelReservationRowDto[];
  @ApiProperty({ type: PageMetaDto }) meta: PageMetaDto;
}
