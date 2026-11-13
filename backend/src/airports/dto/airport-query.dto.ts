import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';

export class AirportQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: 'cairo',
    description: 'Part of the IATA code, airport name or city id',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(50)
  search?: string;
}
