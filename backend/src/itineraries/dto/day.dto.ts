import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

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
