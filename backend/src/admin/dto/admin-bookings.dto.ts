import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { BookingStatus } from '../../common/enums/booking-status.enum';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';
import { IsDateOnly } from '../../hotels/dto/date-only';

export enum AdminBookingType {
  FLIGHT = 'flight',
  HOTEL = 'hotel',
}

// ACC-17: GET /admin/bookings?type&status&from&to&page&limit
export class AdminBookingsQueryDto extends OmitType(PaginationQueryDto, [
  'sort',
] as const) {
  @ApiPropertyOptional({
    enum: AdminBookingType,
    description: 'Both when left out',
  })
  @IsOptional()
  @IsEnum(AdminBookingType)
  type?: AdminBookingType;

  @ApiPropertyOptional({
    enum: BookingStatus,
    description: 'All when left out',
  })
  @IsOptional()
  @IsEnum(BookingStatus)
  status?: BookingStatus;

  @ApiPropertyOptional({
    example: '2026-12-01',
    description:
      'YYYY-MM-DD: travel date on or after (flight departure, hotel check-in; UTC date)',
  })
  @IsOptional()
  @IsDateOnly()
  from?: string;

  @ApiPropertyOptional({
    example: '2026-12-31',
    description: 'YYYY-MM-DD: travel date on or before',
  })
  @IsOptional()
  @IsDateOnly()
  to?: string;
}

class BookingUserDto {
  @ApiProperty({
    example: '6735a1f4c1a2b3c4d5e6f001',
    nullable: true,
    type: String,
  })
  id: string | null;
  @ApiProperty({ example: 'Sara Ali' }) name: string;
  @ApiProperty({ example: 'sara@example.com' }) email: string;
}

class BookingProviderDto {
  @ApiProperty({
    example: '6735a1f4c1a2b3c4d5e6f601',
    nullable: true,
    type: String,
  })
  id: string | null;
  @ApiProperty({ example: 'EgyptAir', description: 'Airline or hotel name' })
  name: string;
}

export class AdminBookingDto {
  @ApiProperty({ example: '6736f0a1c1a2b3c4d5e6fb10' }) _id: string;
  @ApiProperty({ enum: AdminBookingType }) type: AdminBookingType;
  @ApiProperty({ example: 'FL-7K2M9QX4', nullable: true, type: String })
  reference: string | null;
  @ApiProperty({ example: 'Confirmed' }) status: string;
  @ApiProperty({ type: BookingUserDto }) user: BookingUserDto;
  @ApiProperty({ type: BookingProviderDto }) provider: BookingProviderDto;
  @ApiProperty({
    example: 'CAI-CDG',
    description: 'Flight route(s), or the hotel name for a hotel',
  })
  summary: string;
  @ApiProperty({
    example: '2026-12-05',
    description: 'Flight departure date (UTC) or hotel check-in',
  })
  startDate: string;
  @ApiProperty({
    example: '2026-12-12',
    description: 'Last flight arrival date (UTC) or hotel check-out',
  })
  endDate: string;
  @ApiProperty({ example: 52000, description: 'USD cents' }) amount: number;
  @ApiProperty({ example: 'USD' }) currency: string;
  @ApiProperty({ example: '2026-11-18T10:00:00.000Z' }) createdAt: string;
}

class PageMetaDto {
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 10 }) limit: number;
  @ApiProperty({ example: 1 }) total: number;
  @ApiProperty({ example: 1 }) totalPages: number;
}

export class AdminBookingsPageDto {
  @ApiProperty({ type: [AdminBookingDto], description: 'Newest first' })
  data: AdminBookingDto[];
  @ApiProperty({ type: PageMetaDto }) meta: PageMetaDto;
}
