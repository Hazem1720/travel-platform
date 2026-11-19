import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId, ValidateIf } from 'class-validator';

// BLG-13 (bonus): PATCH /api/posts/:id/itinerary. null detaches it.
export class AttachItineraryDto {
  @ApiProperty({
    example: '6736a1f4c1a2b3c4d5e6f301',
    nullable: true,
    description: 'One of your own public itineraries, or null to detach',
  })
  @ValidateIf((o: AttachItineraryDto) => o.itineraryId !== null)
  @IsMongoId({ message: 'itineraryId must be an itinerary id or null' })
  itineraryId: string | null;
}
