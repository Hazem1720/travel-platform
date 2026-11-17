import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
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
