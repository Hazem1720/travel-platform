import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  Matches,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';
import { CabinCategory } from '../flight-booking.rules';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const IATA = /^[A-Z]{3}$/;
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

// GET /api/flights/search (FLT-11, FLT-12, FLT-15). Rules that involve two
// fields (from != to, returnDate, passenger mix, minPrice <= maxPrice) are in
// assertSearchCriteria().
export class FlightSearchQueryDto extends PaginationQueryDto {
  @ApiProperty({ example: 'CAI', description: 'Departure airport (IATA)' })
  @Transform(upper)
  @Matches(IATA, { message: 'from must be a 3-letter airport code' })
  from: string;

  @ApiProperty({ example: 'DXB', description: 'Arrival airport (IATA)' })
  @Transform(upper)
  @Matches(IATA, { message: 'to must be a 3-letter airport code' })
  to: string;

  @ApiProperty({
    example: '2026-12-02',
    description: 'Departure date, local date at the departure airport',
  })
  @Matches(DATE, { message: 'date must look like 2026-12-02' })
  @IsISO8601({ strict: true }, { message: 'date must be a real date' })
  date: string;

  @ApiPropertyOptional({
    example: '2026-12-09',
    description:
      'Round trip (FLT-12): return date, local date at the arrival airport',
  })
  @IsOptional()
  @Matches(DATE, { message: 'returnDate must look like 2026-12-09' })
  @IsISO8601({ strict: true }, { message: 'returnDate must be a real date' })
  returnDate?: string;

  @ApiPropertyOptional({ default: 1, minimum: 0, description: 'Age 12+' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  adults: number = 1;

  @ApiPropertyOptional({ default: 0, minimum: 0, description: 'Age 2-11' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  children: number = 0;

  @ApiPropertyOptional({
    default: 0,
    minimum: 0,
    description: 'Under 2: no seat, 10% of the fare',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  infants: number = 0;

  @ApiPropertyOptional({ enum: CabinCategory, description: 'FLT-12 filter' })
  @IsOptional()
  @IsEnum(CabinCategory)
  cabin?: CabinCategory;

  @ApiPropertyOptional({ example: 10000, description: 'USD cents, inclusive' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({ example: 50000, description: 'USD cents, inclusive' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional({
    example: 'price:asc',
    description: 'price, duration or departure, with :asc or :desc',
  })
  declare sort?: string;
}
