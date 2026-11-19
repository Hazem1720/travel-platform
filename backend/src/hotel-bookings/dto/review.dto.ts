import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  MAX_RATING,
  MAX_REVIEW_TEXT,
  MIN_RATING,
} from '../schemas/review.schema';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// HTL-23: POST /hotel-bookings/:id/review
export class CreateReviewDto {
  @ApiProperty({ example: 5, minimum: MIN_RATING, maximum: MAX_RATING })
  @IsInt()
  @Min(MIN_RATING)
  @Max(MAX_RATING)
  rating: number;

  @ApiPropertyOptional({
    example: 'Great view of the Nile and very helpful staff.',
    maxLength: MAX_REVIEW_TEXT,
    description: 'Optional; leave it out to only rate',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(MAX_REVIEW_TEXT)
  text?: string;
}

// HTL-23: PATCH /reviews/:id, change the rating, the text or both.
export class UpdateReviewDto extends PartialType(CreateReviewDto) {}

class ReviewAuthorDto {
  @ApiProperty({
    example: '6735a1f4c1a2b3c4d5e6f001',
    nullable: true,
    type: String,
    description: 'null for a deactivated user',
  })
  id: string | null;

  @ApiProperty({
    example: 'Sara Ali',
    description: '"Deleted user" for a deactivated user (ACC-12)',
  })
  name: string;
}

// A review as the author gets it back after writing or editing it.
export class ReviewDto {
  @ApiProperty({ example: '6737a1f4c1a2b3c4d5e6f101' }) _id: string;
  @ApiProperty({ example: '6735a1f4c1a2b3c4d5e6f801' }) hotelId: string;
  @ApiProperty({ example: '6736f0a1c1a2b3c4d5e6fa10' }) bookingId: string;
  @ApiProperty({ example: 5 }) rating: number;
  @ApiProperty({ example: 'Great view of the Nile and very helpful staff.' })
  text: string;
  @ApiProperty({ example: '2026-12-09T10:00:00.000Z' }) createdAt: string;
  @ApiProperty({ example: '2026-12-09T10:00:00.000Z' }) updatedAt: string;
}

// One row of a hotel's public review list (HTL-24).
export class HotelReviewDto {
  @ApiProperty({ example: '6737a1f4c1a2b3c4d5e6f101' }) _id: string;
  @ApiProperty({ example: 5 }) rating: number;
  @ApiProperty({ example: 'Great view of the Nile and very helpful staff.' })
  text: string;
  @ApiProperty({ type: ReviewAuthorDto }) author: ReviewAuthorDto;
  @ApiProperty({ example: '2026-12-09T10:00:00.000Z' }) createdAt: string;
  @ApiProperty({ example: '2026-12-09T10:00:00.000Z' }) updatedAt: string;
}

class PageMetaDto {
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 10 }) limit: number;
  @ApiProperty({ example: 1 }) total: number;
  @ApiProperty({ example: 1 }) totalPages: number;
}

// HTL-24: GET /hotels/:id/reviews
export class HotelReviewsPageDto {
  @ApiProperty({
    example: 4.5,
    description: 'Average of all ratings, 1 decimal; 0 with none',
  })
  ratingAverage: number;
  @ApiProperty({ example: 2, description: 'Number of ratings' })
  ratingCount: number;
  @ApiProperty({ type: [HotelReviewDto], description: 'Newest first' })
  data: HotelReviewDto[];
  @ApiProperty({ type: PageMetaDto }) meta: PageMetaDto;
}

// HTL-24: ?page&limit only; reviews are always newest first.
export class HotelReviewsQueryDto extends OmitType(PaginationQueryDto, [
  'sort',
] as const) {}
