import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  MAX_POST_TAGS,
  MAX_TAG_LENGTH,
  PostStatus,
} from '../schemas/post.schema';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// BLG-08: tags are trimmed, lower-cased and de-duplicated, so "Paris" and
// "paris " are the same tag and searching or clicking one finds both.
const normalizeTags = ({ value }: { value: unknown }) =>
  Array.isArray(value)
    ? [
        ...new Set(
          value.map((tag) =>
            typeof tag === 'string' ? tag.trim().toLowerCase() : tag,
          ),
        ),
      ]
    : value;

// BLG-01. Images are not part of this body: they are uploaded with
// POST /api/posts/:id/images (BLG-10, GEN-08).
export class CreatePostDto {
  @ApiProperty({ example: 'My Trip to Paris' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ example: 'I had an amazing experience visiting Paris...' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  body: string;

  @ApiPropertyOptional({
    example: ['travel', 'france'],
    type: [String],
    maxItems: MAX_POST_TAGS,
    description: `Up to ${MAX_POST_TAGS} tags, ${MAX_TAG_LENGTH} characters each (BLG-08)`,
  })
  @IsOptional()
  @Transform(normalizeTags)
  @IsArray()
  @ArrayMaxSize(MAX_POST_TAGS)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(MAX_TAG_LENGTH, { each: true })
  tags?: string[];

  @ApiPropertyOptional({ enum: PostStatus, default: PostStatus.DRAFT })
  @IsOptional()
  @IsEnum(PostStatus)
  status?: PostStatus;
}
