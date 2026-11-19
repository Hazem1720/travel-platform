import {
  BadRequestException,
  Body,
  Controller,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import {
  ApiErrors,
  UNAUTHENTICATED,
} from '../common/swagger/api-error.decorator';
import { AuthUser } from '../common/types/auth-user.type';
import {
  ACCOUNT_NOT_FOUND,
  ADMIN_NOT_SUSPENDABLE,
  AdminAccountsService,
  AIRLINE_NOT_FOUND,
  HOTEL_NOT_FOUND,
  ProviderKind,
} from './admin-accounts.service';
import { ManagedAccountDto, ProviderStateDto } from './dto/admin-responses.dto';
import { CreateModeratorDto } from './dto/create-moderator.dto';
import { ReasonDto } from './dto/suspend-account.dto';

const NOT_ADMIN = {
  status: 403,
  message: 'You do not have permission for this action',
  description: 'Not an admin, or the account is suspended',
};
const ID = { name: 'id', example: '6736e5f4c1a2b3c4d5e6fc01' };
const PROVIDER_ID = { name: 'id', example: '6735a1f4c1a2b3c4d5e6f701' };
const PROVIDER_TYPE = { name: 'type', enum: ['hotel', 'airline'] };

// :type of the provider routes; anything else is 400.
export function providerKind(type: string): ProviderKind {
  if (type === 'hotel' || type === 'airline') return type;
  throw new BadRequestException({
    error: 'Bad Request',
    message: 'type must be hotel or airline',
    details: { type: ['type must be hotel or airline'] },
  });
}

// Hazem's admin routes (team plan, B4): moderators, account suspension and
// provider deactivation. Memo's admin/accounts list and password reset and
// Hasan's admin/bookings live in their own controllers under the same prefix.
@ApiTags('Admin: moderators and suspensions')
@ApiCookieAuth('access_token')
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminAccountsController {
  constructor(private readonly admin: AdminAccountsService) {}

  @Post('moderators')
  @ApiOperation({
    summary: 'Create a hotel or airline moderator account (ACC-13)',
    description:
      'Linked to exactly one airline or hotel, with a temporary password. ' +
      'The moderator must change it on first login: until then every ' +
      'route except change-password answers 403.',
  })
  @ApiCreatedResponse({ type: ManagedAccountDto })
  @ApiErrors(
    {
      status: 400,
      message: 'Validation failed',
      details: {
        role: ['role must be one of: airline_moderator, hotel_moderator'],
      },
    },
    UNAUTHENTICATED,
    NOT_ADMIN,
    {
      status: 404,
      message: AIRLINE_NOT_FOUND,
      description:
        `Or "${HOTEL_NOT_FOUND}": no airline or hotel with that ` +
        'providerId for the role',
    },
    {
      status: 409,
      message: 'A record with this email already exists',
      details: { email: ['must be unique'] },
    },
  )
  createModerator(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateModeratorDto,
  ) {
    return this.admin.createModerator(user, dto);
  }

  @Patch('accounts/:id/suspend')
  @ApiParam(ID)
  @ApiOperation({
    summary: 'Suspend a moderator or user account (ACC-15, ACC-16)',
    description:
      'Their sessions end at once and login answers "Account is ' +
      'suspended". Bookings stay valid and content stays visible.',
  })
  @ApiOkResponse({ type: ManagedAccountDto })
  @ApiErrors(
    {
      status: 400,
      message: 'Invalid value for "_id"',
      details: { _id: ['"abc" is not valid'] },
    },
    UNAUTHENTICATED,
    {
      ...NOT_ADMIN,
      description: `Not an admin, or "${ADMIN_NOT_SUSPENDABLE}"`,
    },
    { status: 404, message: ACCOUNT_NOT_FOUND },
    { status: 409, message: 'Account is already suspended' },
  )
  suspend(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.admin.suspend(user, id, dto.reason);
  }

  @Patch('accounts/:id/reactivate')
  @ApiParam(ID)
  @ApiOperation({
    summary: 'Reactivate a suspended account (ACC-15, ACC-16)',
  })
  @ApiOkResponse({ type: ManagedAccountDto })
  @ApiErrors(
    UNAUTHENTICATED,
    NOT_ADMIN,
    { status: 404, message: ACCOUNT_NOT_FOUND },
    {
      status: 409,
      message: 'Only a suspended account can be reactivated (it is active)',
    },
  )
  reactivate(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.admin.reactivate(user, id, dto.reason);
  }

  // ACC-15, as section 8.2 of the project description lists it:
  // PATCH /api/admin/providers/:type/:id/deactivate and .../reactivate,
  // where :type is hotel or airline.
  @Patch('providers/:type/:id/deactivate')
  @ApiParam(PROVIDER_TYPE)
  @ApiParam(PROVIDER_ID)
  @ApiOperation({
    summary: 'Deactivate a hotel or an airline (ACC-15)',
    description:
      'Separate from suspending its moderator accounts. Its listings are ' +
      'hidden from search and cannot be booked; existing Confirmed ' +
      "bookings stay valid. The provider's moderators get an in-app " +
      'notification.',
  })
  @ApiOkResponse({ type: ProviderStateDto })
  @ApiErrors(
    { status: 400, message: 'type must be hotel or airline' },
    UNAUTHENTICATED,
    NOT_ADMIN,
    { status: 404, message: `${AIRLINE_NOT_FOUND} / ${HOTEL_NOT_FOUND}` },
    { status: 409, message: 'This hotel is already deactivated' },
  )
  deactivateProvider(
    @CurrentUser() user: AuthUser,
    @Param('type') type: string,
    @Param('id') id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.setProvider(user, providerKind(type), id, false, dto);
  }

  @Patch('providers/:type/:id/reactivate')
  @ApiParam(PROVIDER_TYPE)
  @ApiParam(PROVIDER_ID)
  @ApiOperation({ summary: 'Reactivate a hotel or an airline (ACC-15)' })
  @ApiOkResponse({ type: ProviderStateDto })
  @ApiErrors(
    { status: 400, message: 'type must be hotel or airline' },
    UNAUTHENTICATED,
    NOT_ADMIN,
    { status: 404, message: `${AIRLINE_NOT_FOUND} / ${HOTEL_NOT_FOUND}` },
    { status: 409, message: 'This airline is already active' },
  )
  reactivateProvider(
    @CurrentUser() user: AuthUser,
    @Param('type') type: string,
    @Param('id') id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.setProvider(user, providerKind(type), id, true, dto);
  }

  private setProvider(
    user: AuthUser,
    kind: ProviderKind,
    id: string,
    active: boolean,
    dto: ReasonDto,
  ) {
    return this.admin.setProviderActive(user, kind, id, active, dto.reason);
  }
}
