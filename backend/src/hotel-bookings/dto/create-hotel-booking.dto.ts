import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsMongoId,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsDateOnly } from '../../hotels/dto/date-only';
import { MAX_SEARCH_ROOMS } from './hotel-search.dto';

export const MAX_CHILD_AGE = 17;
// More guests than this never fit one room; the room's maxOccupancy is the
// real limit (checked in the service).
export const MAX_GUESTS_PER_ROOM = 20;

export class BookingRoomDto {
  @ApiProperty({ example: '6735a1f4c1a2b3c4d5e6f901' })
  @IsMongoId()
  roomId: string;

  @ApiProperty({ example: 2, minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_GUESTS_PER_ROOM)
  adults: number;

  @ApiProperty({
    example: [7],
    type: [Number],
    description: 'One age (0 to 17) per child in this room; [] for none',
  })
  @IsArray()
  @ArrayMaxSize(MAX_GUESTS_PER_ROOM)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(0, { each: true, message: 'Each child age must be 0 to 17' })
  @Max(MAX_CHILD_AGE, { each: true, message: 'Each child age must be 0 to 17' })
  childAges: number[];
}

// HTL-16 + HTL-18: POST /hotel-bookings. One reservation: one hotel, the
// same dates for every room.
export class CreateHotelBookingDto {
  @ApiProperty({ example: '6735a1f4c1a2b3c4d5e6f801' })
  @IsMongoId()
  hotelId: string;

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

  @ApiProperty({
    type: [BookingRoomDto],
    description: `1 to ${MAX_SEARCH_ROOMS} different rooms of this hotel`,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SEARCH_ROOMS)
  @ValidateNested({ each: true })
  @Type(() => BookingRoomDto)
  rooms: BookingRoomDto[];
}

// Response shapes, used only for Swagger documentation.
export class BookedRoomDto {
  @ApiProperty({ example: '6735a1f4c1a2b3c4d5e6f901' }) roomId: string;
  @ApiProperty({ example: '101' }) name: string;
  @ApiProperty({ example: 'Double' }) type: string;
  @ApiProperty({ example: 2 }) adults: number;
  @ApiProperty({ example: [7], type: [Number] }) childAges: number[];
  @ApiProperty({ example: 10000, description: 'USD cents, at booking time' })
  pricePerNight: number;
  @ApiProperty({ example: 30000, description: 'nights x pricePerNight' })
  subtotal: number;
}

export class HotelBookingDto {
  @ApiProperty({ example: '6736f0a1c1a2b3c4d5e6fa10' }) _id: string;
  @ApiProperty({ example: 'PendingPayment' }) status: string;
  @ApiProperty({ example: null, nullable: true, type: String })
  reference: string | null;
  @ApiProperty({ example: '6735a1f4c1a2b3c4d5e6f801' }) hotelId: string;
  @ApiProperty({ example: 'Nile View Hotel' }) hotelName: string;
  @ApiProperty({ example: '2026-12-05' }) checkIn: string;
  @ApiProperty({ example: '2026-12-08' }) checkOut: string;
  @ApiProperty({ example: 3 }) nights: number;
  @ApiProperty({ type: [BookedRoomDto] }) rooms: BookedRoomDto[];
  @ApiProperty({ example: 75000, description: 'USD cents' })
  totalAmount: number;
  @ApiProperty({ example: 'USD' }) currency: string;
  @ApiProperty({
    example: '2026-11-18T10:10:00.000Z',
    nullable: true,
    type: String,
    description: 'End of the 10-minute hold; pay before it (PAY-01)',
  })
  expiresAt: string | null;
  @ApiProperty({ example: null, nullable: true, type: String })
  policiesAcceptedAt: string | null;
  @ApiProperty({ example: '2026-11-18T10:00:00.000Z' }) createdAt: string;
}
