import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import {
  ApiErrors,
  UNAUTHENTICATED,
} from '../common/swagger/api-error.decorator';
import { AuditService } from './audit.service';
import { AuditLogPageDto } from './dto/audit-log.dto';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';

// GEN-07. Read-only on purpose: no POST, PATCH or DELETE route.
@ApiTags('Admin: audit log')
@ApiCookieAuth('access_token')
@Controller('admin/audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Audit log of admin actions, newest first, admin only (GEN-07)',
    description:
      'Filter by ?action, ?adminId and a ?from / ?to date range (inclusive). ' +
      '10 rows per page.',
  })
  @ApiOkResponse({ type: AuditLogPageDto })
  @ApiErrors(
    {
      status: 400,
      message: 'Validation failed',
      details: { action: ['action must be one of the following values: ...'] },
      description: 'Invalid filter, or "from" after "to"',
    },
    UNAUTHENTICATED,
    {
      status: 403,
      message: 'You do not have permission for this action',
      description: 'Not an admin, or the account is suspended',
    },
  )
  list(@Query() q: AuditLogQueryDto) {
    return this.audit.list(q);
  }
}
