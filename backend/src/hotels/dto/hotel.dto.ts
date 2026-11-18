import { ApiProperty } from '@nestjs/swagger';
import { CancellationTierDto } from '../../common/helpers/cancellation-tiers';

// Response shapes, used only for Swagger documentation.
export class HotelDto {
  @ApiProperty({ example: '6735a1f4c1a2b3c4d5e6f801' })
  _id: string;

  @ApiProperty({ example: 'TEST Nile View Hotel' })
  name: string;

  @ApiProperty({ example: '12 Corniche El Nil St' })
  address: string;

  @ApiProperty({ example: 'cairo' })
  cityId: string;

  @ApiProperty({ example: 'EG' })
  countryCode: string;

  @ApiProperty({ example: 'A quiet riverside hotel.' })
  description: string;

  @ApiProperty({ type: [String], example: [] })
  images: string[];

  @ApiProperty({ example: 4 })
  starClass: number;

  @ApiProperty({ type: [String], example: ['wifi', 'pool'] })
  amenities: string[];

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({ example: '14:00' })
  checkInTime: string;

  @ApiProperty({ example: '12:00' })
  checkOutTime: string;

  @ApiProperty({ type: [CancellationTierDto], example: [] })
  cancellationTiers: CancellationTierDto[];

  @ApiProperty({ example: 0 })
  ratingAverage: number;

  @ApiProperty({ example: 0 })
  ratingCount: number;

  @ApiProperty({ example: '2026-11-16T10:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: '2026-11-16T10:00:00.000Z' })
  updatedAt: string;
}

class BookableRangeDto {
  @ApiProperty({ example: '2026-12-01' })
  from: string;

  @ApiProperty({ example: '2027-01-01' })
  to: string;
}

export class RoomDto {
  @ApiProperty({ example: '6735a1f4c1a2b3c4d5e6f901' })
  _id: string;

  @ApiProperty({ example: '6735a1f4c1a2b3c4d5e6f801' })
  hotelId: string;

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

  @ApiProperty({
    type: [BookableRangeDto],
    example: [{ from: '2026-12-01', to: '2027-01-01' }],
  })
  bookableRanges: BookableRangeDto[];

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({ example: '2026-11-16T10:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: '2026-11-16T10:00:00.000Z' })
  updatedAt: string;
}
