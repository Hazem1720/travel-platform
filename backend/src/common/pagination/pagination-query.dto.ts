import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export const PAGE_SIZE = 10;

export class PaginationQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  // GEN-05: lists are paginated with a page size of 10. A smaller page is
  // allowed, a larger one is not.
  @ApiPropertyOptional({ default: PAGE_SIZE, minimum: 1, maximum: PAGE_SIZE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PAGE_SIZE)
  limit: number = PAGE_SIZE;

  @ApiPropertyOptional({ example: 'createdAt:desc', description: 'field:asc or field:desc' })
  @IsOptional()
  @IsString()
  sort?: string;
}