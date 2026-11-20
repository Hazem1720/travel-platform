import { ApiProperty, OmitType } from '@nestjs/swagger';
import { IsEnum, IsMongoId } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';
import { LinkedBookingType } from '../schemas/itinerary.schema';

// GEN-05: GET /api/itineraries/:id/bookings?page=&limit= (page size 10).
// The links keep the order they were added in, so there is no sort.
export class LinkedBookingsQueryDto extends OmitType(PaginationQueryDto, [
  'sort',
] as const) {}

// ITN-27 (bonus): POST /api/itineraries/:id/bookings
export class LinkBookingDto {
  @ApiProperty({ enum: LinkedBookingType, example: LinkedBookingType.HOTEL })
  @IsEnum(LinkedBookingType)
  type: LinkedBookingType;

  @ApiProperty({
    example: '6737b2f4c1a2b3c4d5e6f201',
    description: 'Your own Confirmed or Completed flight or hotel booking',
  })
  @IsMongoId()
  bookingId: string;

  @ApiProperty({
    example: '6736a1f4c1a2b3c4d5e6f311',
    description: 'The day of this itinerary to link it to',
  })
  @IsMongoId()
  dayId: string;
}
