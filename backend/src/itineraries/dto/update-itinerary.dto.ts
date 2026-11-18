import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { ItineraryVisibility } from '../schemas/itinerary.schema';
import { CreateItineraryDto } from './create-itinerary.dto';

// ITN-01: edit the title, countries and start date; every field is optional.
// ITN-20: the same route sets the visibility to Public or Private.
export class UpdateItineraryDto extends PartialType(CreateItineraryDto) {
  @ApiPropertyOptional({
    enum: ItineraryVisibility,
    example: ItineraryVisibility.PUBLIC,
    description:
      'Public: shown in shared search, read-only to others. ' +
      'Private: removed from search at once (ITN-20)',
  })
  @IsOptional()
  @IsEnum(ItineraryVisibility)
  visibility?: ItineraryVisibility;
}
