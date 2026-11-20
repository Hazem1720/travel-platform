import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { CabinCategory } from '../../flight-bookings/flight-booking.rules';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';
import { MAX_ITINERARY_DAYS } from '../schemas/itinerary.schema';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// ITN-25: hotels for one city group of the itinerary.
export class ItineraryHotelsQueryDto extends PaginationQueryDto {
  @ApiProperty({
    example: 0,
    minimum: 0,
    description: 'Index in cityGroups (0 = the first group)',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_ITINERARY_DAYS - 1)
  groupIndex: number;

  @ApiProperty({ example: 2, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  guests: number;

  @ApiPropertyOptional({ example: 1, minimum: 1, default: 1 })
  @Transform(({ value }) => (value === undefined ? 1 : Number(value)))
  @IsInt()
  @Min(1)
  @Max(20)
  rooms: number = 1;
}

// ITN-26: flights from an origin airport to the city of the first day,
// reusing the FLT-11/FLT-12 search. The dates default to the itinerary's
// start date and last day; the passenger and cabin filters are FLT-12's.
export class ItineraryFlightsQueryDto extends PaginationQueryDto {
  @ApiProperty({ example: 'CAI', description: 'Origin airport (IATA)' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z]{3}$/, { message: 'origin must be a 3-letter airport code' })
  origin: string;

  @ApiPropertyOptional({
    example: false,
    default: false,
    description:
      "true adds return flights (on the last day's date unless returnDate is given)",
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  roundTrip: boolean = false;

  @ApiPropertyOptional({
    example: '2026-12-01',
    description: "Outbound date; default the itinerary's start date",
  })
  @IsOptional()
  @Matches(DATE, { message: 'date must look like 2026-12-01' })
  @IsISO8601({ strict: true }, { message: 'date must be a real date' })
  date?: string;

  @ApiPropertyOptional({
    example: '2026-12-05',
    description:
      "Return date (implies roundTrip); default the itinerary's last day",
  })
  @IsOptional()
  @Matches(DATE, { message: 'returnDate must look like 2026-12-05' })
  @IsISO8601({ strict: true }, { message: 'returnDate must be a real date' })
  returnDate?: string;

  @ApiPropertyOptional({
    default: 1,
    minimum: 1,
    description: 'Page of returnFlights (?page pages the outbound flights)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  returnPage: number = 1;

  @ApiPropertyOptional({ minimum: 0, description: 'Age 12+ (default 1)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  adults?: number;

  @ApiPropertyOptional({ minimum: 0, description: 'Age 2-11 (default 0)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  children?: number;

  @ApiPropertyOptional({ minimum: 0, description: 'Under 2 (default 0)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  infants?: number;

  @ApiPropertyOptional({ enum: CabinCategory })
  @IsOptional()
  @IsEnum(CabinCategory)
  cabin?: CabinCategory;
}
