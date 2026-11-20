import { ApiProperty } from '@nestjs/swagger';
import { AuditAction, AuditTargetType } from '../schemas/audit-log.schema';

// Response shapes, used only for Swagger documentation (GEN-07).

export class AuditLogDto {
  @ApiProperty({ example: '6736c3f4c1a2b3c4d5e6fa01' })
  _id: string;

  @ApiProperty({ example: '6735a1f4c1a2b3c4d5e6f701' })
  adminId: string;

  @ApiProperty({ enum: AuditAction, example: AuditAction.ACCOUNT_SUSPENDED })
  action: AuditAction;

  @ApiProperty({ enum: AuditTargetType, example: AuditTargetType.USER })
  targetType: AuditTargetType;

  @ApiProperty({ example: '6735a1f4c1a2b3c4d5e6f702' })
  targetId: string;

  @ApiProperty({
    example: { reason: 'Spam posts' },
    nullable: true,
    type: Object,
  })
  details: Record<string, unknown> | null;

  @ApiProperty({ example: '2026-11-16T09:30:00.000Z' })
  createdAt: Date;
}

class PageMetaDto {
  @ApiProperty({ example: 1 }) page: number;
  @ApiProperty({ example: 10 }) limit: number;
  @ApiProperty({ example: 1 }) total: number;
  @ApiProperty({ example: 1 }) totalPages: number;
}

export class AuditLogPageDto {
  @ApiProperty({ type: [AuditLogDto] })
  data: AuditLogDto[];

  @ApiProperty({ type: PageMetaDto })
  meta: PageMetaDto;
}
