import { PartialType } from '@nestjs/swagger';
import { CreateAirlineDto } from './create-airline.dto';

// FLT-01: the airline's own moderator edits the name and code (the logo has
// its own upload route). Every field is optional; unknown fields give 400.
export class UpdateAirlineDto extends PartialType(CreateAirlineDto) {}
