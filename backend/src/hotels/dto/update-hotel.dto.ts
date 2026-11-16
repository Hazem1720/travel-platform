import { PartialType } from '@nestjs/swagger';
import { CreateHotelDto } from './create-hotel.dto';

// HTL-01: the hotel's own moderator edits the profile. Every field is
// optional; unknown fields (isActive, ratingAverage, ...) give 400.
export class UpdateHotelDto extends PartialType(CreateHotelDto) {}
