import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { PASSWORD_MESSAGE } from '../auth/dto/register.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import {
  ApiErrors,
  UNAUTHENTICATED,
} from '../common/swagger/api-error.decorator';
import { AuthUser } from '../common/types/auth-user.type';
import { AccountListService } from './account-list.service';
import {
  AccountPasswordService,
  ADMIN_PASSWORD_NOT_RESETTABLE,
} from './account-password.service';
import { ACCOUNT_NOT_FOUND } from './admin-accounts.service';
import { AccountPageDto } from './dto/account.dto';
import { AccountQueryDto } from './dto/account-query.dto';
import { ManagedAccountDto } from './dto/admin-responses.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

// Memo's admin routes (ACC-14, ACC-07a). Admin only.
@ApiTags('Admin: accounts')
@ApiCookieAuth('access_token')
@Roles(Role.ADMIN)
@Controller('admin/accounts')
export class AccountListController {
  constructor(
    private readonly accounts: AccountListService,
    private readonly passwords: AccountPasswordService,
  ) {}

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

  @Post(':id/reset-password')
  @HttpCode(200)
  @ApiParam({ name: 'id', example: '6736e5f4c1a2b3c4d5e6fc01' })
  @ApiOperation({
    summary: "Reset a user's or moderator's password, admin only (ACC-07a)",
    description:
      'Sets a temporary password. Every session of the account ends at ' +
      'once. At its next login the account can only call PATCH ' +
      '/api/auth/change-password (every other route answers 403 "You ' +
      'must change your temporary password first") until it sets a new ' +
      'password that follows the password rules. Admin accounts cannot ' +
      'be reset here. Written to the audit log (GEN-07).',
  })
  @ApiOkResponse({
    type: ManagedAccountDto,
    description: 'The account, with mustChangePassword: true',
  })
  @ApiErrors(
    {
      status: 400,
      message: 'Validation failed',
      details: {
        temporaryPassword: [PASSWORD_MESSAGE],
      },
      description: 'Weak temporary password, or a malformed id',
    },
    UNAUTHENTICATED,
    {
      status: 403,
      message: ADMIN_PASSWORD_NOT_RESETTABLE,
      description:
        'The target is an admin account, or the caller is not an admin ' +
        '("You do not have permission for this action")',
    },
    { status: 404, message: ACCOUNT_NOT_FOUND },
  )
  resetPassword(
    @CurrentUser() admin: AuthUser,
    @Param('id') id: string,
    @Body() dto: ResetPasswordDto,
  ) {
    return this.passwords.resetPassword(admin, id, dto);
  }
}
