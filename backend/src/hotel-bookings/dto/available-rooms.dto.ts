import { ApiProperty } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';
import { IsDateOnly } from '../../hotels/dto/date-only';

// HTL-15: GET /hotels/:id/rooms/available?checkIn&checkOut. The same date
// rules as the hotel search (HTL-11).
export class AvailableRoomsQueryDto extends PaginationQueryDto {
  @ApiProperty({
    example: '2026-12-05',
    description: "YYYY-MM-DD, today or later in the hotel's city",
  })
  @IsDateOnly()
  checkIn: string;

  @ApiProperty({
    example: '2026-12-08',
    description: 'YYYY-MM-DD, after checkIn',
  })
  @IsDateOnly()
  checkOut: string;
}

// Response shapes, used only for Swagger documentation.
export class AvailableRoomDto {
  @ApiProperty({
    example: '6735a1f4c1a2b3c4d5e6f901',
    description: 'The roomId to send when booking (HTL-16)',
  })
  id: string;

  @ApiProperty({ example: '101' })
  name: string;

  @ApiProperty({ example: 'Double' })
  type: string;

  @ApiProperty({ example: 1 })
  beds: number;

  @ApiProperty({ example: 2 })
  maxOccupancy: number;

  @ApiProperty({ example: 10000, description: 'USD cents' })
  pricePerNight: number;

  @ApiProperty({ example: 3 })
  nights: number;

  @ApiProperty({
    example: 30000,
    description: 'nights x pricePerNight, USD cents',
  })
  totalPrice: number;
}

class AvailableRoomsHotelDto {
  @ApiProperty({ example: '6735a1f4c1a2b3c4d5e6f801' })
  id: string;

  @ApiProperty({ example: 'Nile View Hotel' })
  name: string;

  @ApiProperty({ example: '14:00' })
  checkInTime: string;

  @ApiProperty({ example: '12:00' })
  checkOutTime: string;
}

class AvailableRoomsMetaDto {
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 10 }) limit: number;
  @ApiProperty({ example: 1 }) total: number;
  @ApiProperty({ example: 1 }) totalPages: number;
}

export class AvailableRoomsPageDto {
  @ApiProperty({ type: AvailableRoomsHotelDto })
  hotel: AvailableRoomsHotelDto;

  @ApiProperty({ example: '2026-12-05' })
  checkIn: string;

  @ApiProperty({ example: '2026-12-08' })
  checkOut: string;

  @ApiProperty({ example: 3 })
  nights: number;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({ type: [AvailableRoomDto] })
  data: AvailableRoomDto[];

  @ApiProperty({ type: AvailableRoomsMetaDto })
  meta: AvailableRoomsMetaDto;
}
