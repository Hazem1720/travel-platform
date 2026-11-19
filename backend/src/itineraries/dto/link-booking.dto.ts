import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsMongoId } from 'class-validator';
import { LinkedBookingType } from '../schemas/itinerary.schema';

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
