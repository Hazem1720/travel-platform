import { Body, Controller, Delete, Get, Patch, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { MessageDto, UserProfileDto } from '../auth/dto/auth-responses.dto';
import { AuthService } from '../auth/auth.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  ApiErrors,
  MUST_CHANGE_PASSWORD,
  UNAUTHENTICATED,
} from '../common/swagger/api-error.decorator';
import { AuthUser } from '../common/types/auth-user.type';
import { UpdateProfileDto } from './dto/update-profile.dto';

@ApiTags('Users')
@ApiCookieAuth('access_token')
@ApiErrors(UNAUTHENTICATED, MUST_CHANGE_PASSWORD)
@Controller('users/me')
export class UsersController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  @ApiOperation({ summary: 'Get my profile (ACC-11)' })
  @ApiOkResponse({ type: UserProfileDto })
  get(@CurrentUser() user: AuthUser) {
    return this.auth.getProfile(user.id);
  }

  @Patch()
  @ApiOperation({ summary: 'Update my name, phone and preferred currency (ACC-09)' })
  @ApiOkResponse({ type: UserProfileDto, description: 'The updated profile' })
  @ApiErrors({
    status: 400,
    message: 'Validation failed',
    details: {
      preferredCurrency: ['preferredCurrency must be one of: AED, EGP, EUR, GBP, JPY, SAR, USD'],
    },
  })
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.auth.updateProfile(user.id, dto);
  }

  @Delete()
  @ApiOperation({ summary: 'Deactivate my account; signs out every session (ACC-12)' })
  @ApiOkResponse({
    type: MessageDto,
    schema: { example: { message: 'Account deactivated' } },
  })
  async deactivate(
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.deactivate(user.id);
    this.auth.clearCookies(res);
    return result;
  }
}
