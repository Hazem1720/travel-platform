import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsISO8601, IsMongoId, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';
import { AuditAction } from '../schemas/audit-log.schema';

export class AuditLogQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: AuditAction,
    example: AuditAction.ACCOUNT_SUSPENDED,
  })
  @IsOptional()
  @IsEnum(AuditAction)
  action?: AuditAction;

  @ApiPropertyOptional({ example: '6735a1f4c1a2b3c4d5e6f701' })
  @IsOptional()
  @IsMongoId()
  adminId?: string;

  @ApiPropertyOptional({
    example: '2026-11-01',
    description: 'From this date or time (inclusive, UTC)',
  })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({
    example: '2026-11-30',
    description:
      'Up to this date or time (inclusive, UTC). A date alone ' +
      'includes that whole day.',
  })
  @IsOptional()
  @IsISO8601()
  to?: string;
}
