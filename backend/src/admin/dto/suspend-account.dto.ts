import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

// ACC-15, ACC-16: an optional reason, kept in the audit log (GEN-07).
export class ReasonDto {
  @ApiPropertyOptional({ example: 'Abusive posts', maxLength: 500 })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(500)
  reason?: string;
}
