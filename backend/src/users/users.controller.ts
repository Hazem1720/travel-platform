import { Body, Controller, Delete, Get, Patch, Res, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../common/types/auth-user.type';
import { UpdateProfileDto } from './dto/update-profile.dto';

@ApiTags('Users')
@ApiCookieAuth('access_token')
@UseGuards(JwtAuthGuard)
@Controller('users/me')
export class UsersController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  @ApiOperation({ summary: 'Get my profile (ACC-11)' })
  get(@CurrentUser() user: AuthUser) {
    return this.auth.getProfile(user.id);
  }

  @Patch()
  @ApiOperation({ summary: 'Update my profile (ACC-09)' })
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateProfileDto) {
    return this.auth.updateProfile(user.id, dto);
  }

  @Delete()
  @ApiOperation({ summary: 'Deactivate my account (ACC-12)' })
  async deactivate(
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.deactivate(user.id);
    res.clearCookie('access_token', { path: '/' });
    return result;
  }
}