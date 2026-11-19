import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';
import { IsDateOnly } from './date-only';
import { HotelDto } from './hotel.dto';

// HTL-02: GET /hotels/:id?checkIn&checkOut. Both dates or neither.
export class HotelDetailsQueryDto {
  @ApiPropertyOptional({
    example: '2026-12-05',
    description:
      "YYYY-MM-DD, today or later in the hotel's city. With checkOut, the " +
      'page lists the rooms free for the stay.',
  })
  @IsOptional()
  @IsDateOnly()
  checkIn?: string;

  @ApiPropertyOptional({
    example: '2026-12-08',
    description: 'YYYY-MM-DD, after checkIn',
  })
  @IsOptional()
  @IsDateOnly()
  checkOut?: string;
}

// Response shapes, used only for Swagger documentation.
export class HotelReviewDto {
  @ApiProperty({ example: '6735a1f4c1a2b3c4d5e6fb01' })
  id: string;

  @ApiProperty({ example: 5, description: '1 to 5' })
  rating: number;

  @ApiProperty({ example: 'Lovely view of the Nile.' })
  text: string;

  @ApiProperty({ example: '2026-11-16T10:00:00.000Z' })
  createdAt: string;
}

export class HotelDetailsRoomDto {
  @ApiProperty({
    example: '6735a1f4c1a2b3c4d5e6f901',
    description: 'The roomId to send when booking (HTL-16)',
  })
  id: string;

  @ApiProperty({ example: '101' })
  name: string;

  @ApiProperty({ example: 'Double' })
  type: string;

  @ApiProperty({ example: 2 })
  beds: number;

  @ApiProperty({ example: 3 })
  maxOccupancy: number;

  @ApiProperty({ example: 12000, description: 'USD cents' })
  pricePerNight: number;

  @ApiProperty({ example: 3 })
  nights: number;

  @ApiProperty({
    example: 36000,
    description: 'nights x pricePerNight, USD cents',
  })
  totalPrice: number;
}

export class HotelDetailsDto extends HotelDto {
  @ApiProperty({
    type: [HotelReviewDto],
    description: 'The newest 10 visible reviews, newest first',
  })
  reviews: HotelReviewDto[];

  @ApiProperty({
    type: [HotelDetailsRoomDto],
    description:
      'The rooms free for every night of the stay, cheapest first; empty ' +
      'when no dates are given',
  })
  availableRooms: HotelDetailsRoomDto[];

  @ApiPropertyOptional({ example: '2026-12-05', nullable: true })
  checkIn: string | null;

  @ApiPropertyOptional({ example: '2026-12-08', nullable: true })
  checkOut: string | null;
}
