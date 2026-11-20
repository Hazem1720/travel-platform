import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';
import { IsDateOnly } from '../../hotels/dto/date-only';

export const MAX_SEARCH_GUESTS = 50;
export const MAX_SEARCH_ROOMS = 20;

// HTL-11: GET /hotels/search. Give a city or a country (or both).
export class HotelSearchQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: 'cairo',
    description: 'City id from the reference data. Give city or country.',
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @MaxLength(60)
  city?: string;

  @ApiPropertyOptional({
    example: 'EG',
    description: 'ISO country code. Give city or country.',
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Length(2, 2)
  country?: string;

  @ApiProperty({
    example: '2026-12-05',
    description: 'YYYY-MM-DD, today or later',
  })
  @IsDateOnly()
  checkIn: string;

  @ApiProperty({
    example: '2026-12-07',
    description: 'YYYY-MM-DD, after checkIn',
  })
  @IsDateOnly()
  checkOut: string;

  @ApiProperty({ example: 2, minimum: 1, maximum: MAX_SEARCH_GUESTS })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_SEARCH_GUESTS)
  guests: number;

  @ApiPropertyOptional({
    example: 1,
    minimum: 1,
    maximum: MAX_SEARCH_ROOMS,
    default: 1,
  })
  @Transform(({ value }) => (value === undefined ? 1 : Number(value)))
  @IsInt()
  @Min(1)
  @Max(MAX_SEARCH_ROOMS)
  rooms: number = 1;

  @ApiPropertyOptional({
    example: 8000,
    minimum: 0,
    description:
      'HTL-12: inclusive minimum price per night of the cheapest free room, USD cents',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({
    example: 12000,
    minimum: 0,
    description:
      'HTL-12: inclusive maximum price per night of the cheapest free room, USD cents',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional({
    example: 4,
    minimum: 1,
    maximum: 5,
    description:
      'HTL-12: minimum average rating, 1 to 5. Hotels without ratings are left out.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(1)
  @Max(5)
  minRating?: number;

  @ApiPropertyOptional({
    example: 'rating:desc',
    description:
      'HTL-12: price or rating, with :asc or :desc. Default price:asc.',
  })
  @IsOptional()
  @Matches(/^(price|rating)(:(asc|desc))?$/, {
    message: 'sort must be price or rating, optionally with :asc or :desc',
  })
  declare sort?: string;
}

// Response shapes, used only for Swagger documentation.
export class HotelSearchResultDto {
  @ApiProperty({ example: '6735a1f4c1a2b3c4d5e6f801' })
  id: string;

  @ApiProperty({ example: 'Nile View Hotel' })
  name: string;

  @ApiProperty({ example: '12 Corniche El Nil, Garden City' })
  address: string;

  @ApiProperty({ example: 'cairo' })
  cityId: string;

  @ApiProperty({ example: 'EG' })
  countryCode: string;

  @ApiProperty({ example: 4, minimum: 1, maximum: 5 })
  starClass: number;

  @ApiProperty({
    example: ['/api/uploads/3f2b8c1e-4a5d-4e6f-9a7b-1c2d3e4f5a6b.png'],
  })
  images: string[];

  @ApiProperty({ example: ['wifi', 'pool'] })
  amenities: string[];

  @ApiProperty({ example: 4.5, description: '0 when the hotel has no ratings' })
  ratingAverage: number;

  @ApiProperty({ example: 12 })
  ratingCount: number;

  @ApiProperty({ example: '14:00' })
  checkInTime: string;

  @ApiProperty({ example: '12:00' })
  checkOutTime: string;

  @ApiProperty({
    example: 9000,
    description:
      'Price per night of the cheapest room free for the whole stay, in USD cents',
  })
  fromPricePerNight: number;

  @ApiProperty({
    example: 3,
    description: 'Rooms free for the whole stay',
  })
  freeRoomCount: number;
}

class SearchMetaDto {
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 10 }) limit: number;
  @ApiProperty({ example: 2 }) total: number;
  @ApiProperty({ example: 1 }) totalPages: number;
}

export class HotelSearchPageDto {
  @ApiProperty({ type: [HotelSearchResultDto] })
  data: HotelSearchResultDto[];

  @ApiProperty({ type: SearchMetaDto })
  meta: SearchMetaDto;
}
