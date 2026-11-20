import {
  Body,
  Controller,
  Get,
  Query,
  HttpCode,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AllowPasswordChange } from '../common/decorators/allow-password-change.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import {
  ApiErrors,
  UNAUTHENTICATED,
} from '../common/swagger/api-error.decorator';
import { AuthUser } from '../common/types/auth-user.type';
import { AuthService } from './auth.service';
import { MessageDto, UserProfileDto } from './dto/auth-responses.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import {
  ForgotPasswordDto,
  ResetPasswordDto,
  VerifyEmailQueryDto,
} from './dto/password-reset.dto';
import { RegisterDto } from './dto/register.dto';

const SETS_COOKIES =
  'Sets the httpOnly, Secure, SameSite=Lax cookies access_token (15 minutes) and refresh_token (path /api/auth).';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @Public()
  @ApiOperation({ summary: 'Register a traveler account (ACC-01)' })
  @ApiCreatedResponse({ type: UserProfileDto, description: 'The new account' })
  @ApiErrors(
    {
      status: 400,
      message: 'Validation failed',
      details: {
        email: ['email must be an email'],
        password: [
          'Password must be 8-72 characters and include at least one letter and one digit',
        ],
        acceptTerms: ['You must accept the terms and privacy policy'],
      },
    },
    { status: 409, message: 'Email is already registered' },
  )
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login')
  @Public()
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Log in; sets httpOnly access and refresh cookies (ACC-04, ACC-05, ACC-19)',
  })
  @ApiOkResponse({ type: UserProfileDto, description: SETS_COOKIES })
  @ApiErrors(
    {
      status: 400,
      message: 'Validation failed',
      details: { email: ['email must be an email'] },
    },
    { status: 401, message: 'Invalid email or password' },
    { status: 403, message: 'Account is suspended' },
    {
      status: 423,
      message: 'Account temporarily locked. Try again later.',
      description:
        'Locked for 15 minutes after 5 consecutive failed logins (ACC-05)',
    },
  )
  login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    return this.auth.login(dto, res);
  }

  @Post('refresh')
  @Public()
  @HttpCode(200)
  @ApiCookieAuth('refresh_token')
  @ApiOperation({
    summary: 'Renew the access token with the refresh cookie (ACC-06, ACC-19)',
  })
  @ApiOkResponse({
    type: UserProfileDto,
    description: `${SETS_COOKIES} The refresh token is rotated.`,
  })
  @ApiErrors(
    {
      status: 401,
      message: 'Session expired. Please log in again.',
      description:
        'No refresh cookie, an unknown or revoked one, or 30 minutes idle (ACC-06)',
    },
    { status: 403, message: 'Account is suspended' },
  )
  refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.refresh(req, res);
  }

  @Post('logout')
  @Public()
  @HttpCode(200)
  // Public (works with or without a session), so no lock icon: the browser
  // still sends the cookies, which are revoked if present.
  @ApiOperation({
    summary:
      'Log out; clears cookies and revokes the refresh and access tokens (ACC-06)',
    description:
      'Public: always 200. If the request carries the session cookies, the ' +
      'refresh token and every access token issued for it are revoked.',
  })
  @ApiOkResponse({
    type: MessageDto,
    schema: { example: { message: 'Logged out' } },
  })
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.logout(req, res);
  }

  @Patch('change-password')
  @AllowPasswordChange()
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Change my password; signs out every other session (ACC-08)',
  })
  @ApiOkResponse({
    type: MessageDto,
    schema: { example: { message: 'Password changed' } },
    description: `Other sessions are revoked. ${SETS_COOKIES}`,
  })
  @ApiErrors(
    {
      status: 400,
      message: 'Current password is incorrect',
      description:
        'Wrong current password, new password equal to the current one, or validation errors',
    },
    UNAUTHENTICATED,
    { status: 403, message: 'Account is suspended' },
  )
  changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.changePassword(user.id, dto, res);
  }

  @Get('me')
  @AllowPasswordChange()
  @ApiCookieAuth('access_token')
  @ApiOperation({ summary: 'Current session user (ACC-04, ACC-11, ACC-19)' })
  @ApiOkResponse({ type: UserProfileDto })
  @ApiErrors(UNAUTHENTICATED, { status: 403, message: 'Account is suspended' })
  me(@CurrentUser() user: AuthUser) {
    return this.auth.getProfile(user.id);
  }

  @Get('verify-email')
  @Public()
  @ApiOperation({
    summary: 'Verify my email address with the emailed link (ACC-02, bonus)',
    description:
      'The link in the email sent after registration. It works once and ' +
      'expires after 24 hours. Until then, holding or paying for a booking ' +
      'answers 403. Without SMTP settings no email can be sent, so new ' +
      'accounts start verified.',
  })
  @ApiOkResponse({
    type: MessageDto,
    schema: {
      example: { message: 'Your email address is verified. You can now book.' },
    },
  })
  @ApiErrors({
    status: 400,
    message: 'This verification link is invalid or has expired',
  })
  verifyEmail(@Query() q: VerifyEmailQueryDto) {
    return this.auth.verifyEmail(q.token);
  }

  @Post('resend-verification')
  @HttpCode(200)
  @ApiCookieAuth('access_token')
  @ApiOperation({
    summary: 'Email me a new verification link (ACC-02, bonus)',
    description: 'Replaces the previous link.',
  })
  @ApiOkResponse({
    type: MessageDto,
    schema: { example: { message: 'A new verification link has been sent' } },
  })
  @ApiErrors(
    { status: 400, message: 'Your email address is already verified' },
    UNAUTHENTICATED,
  )
  resendVerification(@CurrentUser() user: AuthUser) {
    return this.auth.resendVerification(user.id);
  }

  @Post('forgot-password')
  @Public()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Email me a password reset link (ACC-07, bonus)',
    description:
      'The answer is the same whether or not the email has an account. ' +
      'The link expires after 30 minutes, works once, and a newer request ' +
      'replaces it. It opens the frontend page FRONTEND_URL/reset-password; ' +
      'in Swagger, send its token to POST /api/auth/reset-password.',
  })
  @ApiOkResponse({
    type: MessageDto,
    schema: {
      example: {
        message:
          'If an account exists for this email, a password reset link has been sent',
      },
    },
  })
  @ApiErrors({
    status: 400,
    message: 'Validation failed',
    details: { email: ['email must be an email'] },
  })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto.email);
  }

  @Post('reset-password')
  @Public()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Set a new password with the emailed link (ACC-07, bonus)',
    description:
      'Signs out every session; a lockout or a temporary password no ' +
      'longer applies. Then log in with the new password.',
  })
  @ApiOkResponse({
    type: MessageDto,
    schema: {
      example: { message: 'Your password has been reset. You can now log in.' },
    },
  })
  @ApiErrors({
    status: 400,
    message: 'This password reset link is invalid or has expired',
    description: 'Unknown, used, replaced or expired link, or a weak password',
  })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto);
  }
}
