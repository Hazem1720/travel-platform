import { PartialType } from '@nestjs/swagger';
import { CreateItineraryDto } from './create-itinerary.dto';

// ITN-01: edit the title, countries and start date; every field is optional.
// ITN-20 adds visibility to this same route.
export class UpdateItineraryDto extends PartialType(CreateItineraryDto) {}
