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
import { AccountListService } from './account-list.service';
import { AccountPageDto } from './dto/account.dto';
import { AccountQueryDto } from './dto/account-query.dto';

// Memo's admin routes (ACC-14; ACC-07a comes next). Admin only.
@ApiTags('Admin: accounts')
@ApiCookieAuth('access_token')
@Roles(Role.ADMIN)
@Controller('admin/accounts')
export class AccountListController {
  constructor(private readonly accounts: AccountListService) {}

  @Get()
  @ApiOperation({
    summary: 'List all accounts, admin only (ACC-14)',
    description:
      'Name, email, role, status and registration date of every account, ' +
      '10 per page, newest first. ?search matches part of the name or ' +
      'email (case-insensitive); ?role and ?status filter. Sort by name, ' +
      'email or createdAt.',
  })
  @ApiOkResponse({ type: AccountPageDto, description: 'One page of accounts' })
  @ApiErrors(
    {
      status: 400,
      message: 'Validation failed',
      details: {
        role: [
          'role must be one of the following values: user, admin, airline_moderator, hotel_moderator',
        ],
      },
      description: 'Unknown role or status, limit above 10, or a bad sort',
    },
    UNAUTHENTICATED,
    {
      status: 403,
      message: 'You do not have permission for this action',
      description: 'Not an admin, or the account is suspended',
    },
  )
  list(@Query() q: AccountQueryDto) {
    return this.accounts.list(q);
  }
}
