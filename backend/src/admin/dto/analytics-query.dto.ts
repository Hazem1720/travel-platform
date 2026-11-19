import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, Matches } from 'class-validator';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// BON-01 (bonus): GET /api/admin/analytics?from=&to=
export class AnalyticsQueryDto {
  @ApiPropertyOptional({
    example: '2026-11-01',
    description: 'First day (UTC) of the period; default 30 days before "to"',
  })
  @IsOptional()
  @Matches(DATE, { message: 'from must look like 2026-11-01' })
  @IsISO8601({ strict: true }, { message: 'from must be a real date' })
  from?: string;

  @ApiPropertyOptional({
    example: '2026-11-30',
    description: 'Last day (UTC) of the period, included; default today',
  })
  @IsOptional()
  @Matches(DATE, { message: 'to must look like 2026-11-30' })
  @IsISO8601({ strict: true }, { message: 'to must be a real date' })
  to?: string;
}
