import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// GET /api/reference/cities?country=EG
export class CityQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'EG', description: 'Country code' })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z]{2}$/, { message: 'country must be a 2-letter country code' })
  country?: string;
}

// GET /api/reference/attractions?city=cairo
export class AttractionQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'cairo', description: 'City id' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(50)
  city?: string;
}
