import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';
import { MAX_ITINERARY_DAYS } from '../schemas/itinerary.schema';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const trimLower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
const trimUpper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

// ITN-21: search public itineraries.
export class PublicSearchQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: 'luxor',
    description: 'Matches the title, a country (name or code) or a city name',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  keyword?: string;

  @ApiPropertyOptional({ example: 2, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_ITINERARY_DAYS)
  minDays?: number;

  @ApiPropertyOptional({ example: 7, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_ITINERARY_DAYS)
  maxDays?: number;

  @ApiPropertyOptional({ example: 'EG', description: 'A country code' })
  @IsOptional()
  @Transform(trimUpper)
  @IsString()
  country?: string;

  @ApiPropertyOptional({ example: 'luxor', description: 'A city id' })
  @IsOptional()
  @Transform(trimLower)
  @IsString()
  city?: string;
}
