import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';
import { MAX_TAG_LENGTH } from '../schemas/post.schema';

// BLG-02 and BLG-09: GET /api/posts?tag=&search=&page=&limit=
export class PostListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: 'travel',
    description: 'Only posts with this tag (BLG-02, BLG-08)',
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @MaxLength(MAX_TAG_LENGTH)
  tag?: string;

  @ApiPropertyOptional({
    example: 'Paris',
    description:
      'Keyword in the title, a tag or the author name (BLG-09). Results ' +
      'are ordered by likes + comments, newest first on ties.',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(100)
  search?: string;
}
