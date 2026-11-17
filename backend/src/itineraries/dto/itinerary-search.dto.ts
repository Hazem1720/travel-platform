import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';
import { MAX_ITINERARY_DAYS } from '../schemas/itinerary.schema';

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

// ITN-26: flights from an origin airport to the city of the first day.
export class ItineraryFlightsQueryDto extends PaginationQueryDto {
  @ApiProperty({ example: 'CAI', description: 'Origin airport (IATA)' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Length(3, 3)
  origin: string;

  @ApiPropertyOptional({
    example: false,
    default: false,
    description: "true adds return flights on the last day's date",
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  roundTrip: boolean = false;
}
