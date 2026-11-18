import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';
import { IsDateOnly } from '../../hotels/dto/date-only';
import { MAX_TITLE_LENGTH } from '../schemas/itinerary.schema';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const trimUpperEach = ({ value }: { value: unknown }) =>
  Array.isArray(value)
    ? value.map((v) => (typeof v === 'string' ? v.trim().toUpperCase() : v))
    : value;

// ITN-01: a new itinerary. Visibility, days and the clone credit are not
// accepted here (unknown fields give 400): it always starts Private and empty.
export class CreateItineraryDto {
  @ApiProperty({ example: 'TEST Egypt in winter', maxLength: MAX_TITLE_LENGTH })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_TITLE_LENGTH)
  title: string;

  @ApiProperty({
    type: [String],
    example: ['EG'],
    description: 'One or more seeded country codes, such as EG or AE',
  })
  @Transform(trimUpperEach)
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  countries: string[];

  @ApiProperty({ example: '2026-12-01', description: 'YYYY-MM-DD' })
  @IsDateOnly()
  startDate: string;
}
