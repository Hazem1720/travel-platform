import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const trimLower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export const MAX_DAY_NOTES_LENGTH = 2000;

// ITN-05: a new day at the end of the itinerary. Every day needs a city
// (ITN-09); its number and date are computed by the server.
export class CreateDayDto {
  @ApiProperty({
    example: 'cairo',
    description: 'A seeded city id, such as cairo or luxor',
  })
  @Transform(trimLower)
  @IsString()
  @IsNotEmpty()
  cityId: string;

  @ApiPropertyOptional({
    example: 'Pyramids in the morning',
    maxLength: MAX_DAY_NOTES_LENGTH,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(MAX_DAY_NOTES_LENGTH)
  notes?: string;
}

// ITN-05: change a day's city or notes.
export class UpdateDayDto extends PartialType(CreateDayDto) {}

// ITN-08: move a day to a new position, 1 being the first day.
export class ReorderDayDto {
  @ApiProperty({ example: '6735a1f4c1a2b3c4d5e6fa03' })
  @IsMongoId()
  dayId: string;

  @ApiProperty({ example: 1, minimum: 1, description: '1 = first day' })
  @IsInt()
  @Min(1)
  newPosition: number;
}
