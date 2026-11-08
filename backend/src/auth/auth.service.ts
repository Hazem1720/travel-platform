import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import type { Request, Response } from 'express';
import { Model } from 'mongoose';
import { SESSION_IDLE_MS } from '../common/constants/session.constants';
import { AccountStatus, Role } from '../common/enums/role.enum';
import { UpdateProfileDto } from '../users/dto/update-profile.dto';
import { User, UserDocument } from '../users/schemas/user.schema';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

// ACC-05: after 5 consecutive failures the account is locked for 15 minutes.
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const REFRESH_DAYS = 7;

// MI-1: compared against when the email is unknown, so a missing account
// takes as long as a wrong password and the timing reveals nothing.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(
  'timing-equaliser-not-a-password',
  10,
);

// cookie-parser turns "j:{...}" cookies into objects; only a string is a token.
function readCookie(req: Request, name: string): string | null {
  const value = req.cookies?.[name];
  return typeof value === 'string' && value ? value : null;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  private toProfile(user: any) {
    return {
      id: String(user._id),
      name: user.name,
      email: user.email,
      phone: user.phone ?? '',
      role: user.role,
      status: user.status,
      preferredCurrency: user.preferredCurrency,
      mustChangePassword: !!user.mustChangePassword,
      assignedProviderId: user.assignedProviderId
        ? String(user.assignedProviderId)
        : null,
    };
  }

  private hash(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  // ACC-19: httpOnly, Secure and SameSite cookies. Secure is on unless
  // COOKIE_SECURE=false, which env validation refuses in production.
  private cookieBase() {
    return {
      httpOnly: true,
      secure: this.config.get<string>('COOKIE_SECURE') !== 'false',
      sameSite: 'lax' as const,
    };
  }

  clearCookies(res: Response) {
    res.clearCookie('access_token', { ...this.cookieBase(), path: '/' });
    res.clearCookie('refresh_token', {
      ...this.cookieBase(),
      path: '/api/auth',
    });
  }

  // Issues a short-lived access token and a rotating refresh token.
  // The access token carries the user's sessionVersion ("sv"), which the
  // guard compares on every request (ACC-06).
  private async startSession(
    res: Response,
    userId: string,
    sessionVersion: number,
  ) {
    const accessToken = await this.jwt.signAsync({
      sub: userId,
      sv: sessionVersion,
    });
    const { exp } = this.jwt.decode(accessToken) as { exp: number };
    const refreshToken = randomBytes(48).toString('hex');

    await this.userModel.updateOne(
      { _id: userId },
      {
        $set: {
          refreshTokenHash: this.hash(refreshToken),
          lastActivityAt: new Date(),
        },
      },
    );

    res.cookie('access_token', accessToken, {
      ...this.cookieBase(),
      path: '/',
      maxAge: exp * 1000 - Date.now(),
    });
    res.cookie('refresh_token', refreshToken, {
      ...this.cookieBase(),
      path: '/api/auth',
      maxAge: REFRESH_DAYS * 24 * 60 * 60 * 1000,
    });
  }

  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase().trim();
    if (await this.userModel.exists({ email })) {
      throw new ConflictException('Email is already registered');
    }
    const passwordHash = await bcrypt.hash(dto.password, 10);
    try {
      const user = await this.userModel.create({
        name: dto.name,
        email,
        passwordHash,
        role: Role.USER, // self-registration can only create travelers
        acceptedTermsAt: new Date(),
      });
      return this.toProfile(user);
    } catch (e: any) {
      if (e?.code === 11000) {
        throw new ConflictException('Email is already registered');
      }
      throw e;
    }
  }

  async login(dto: LoginDto, res: Response) {
    const email = dto.email.toLowerCase().trim();
    const user = await this.userModel
      .findOne({ email })
      .select('+passwordHash');
    const invalid = new UnauthorizedException('Invalid email or password');
    if (!user) {
      await bcrypt.compare(dto.password, DUMMY_PASSWORD_HASH);
      throw invalid;
    }

    if (user.lockUntil && user.lockUntil.getTime() > Date.now()) {
      throw new HttpException(
        'Account temporarily locked. Try again later.',
        423,
      );
    }

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      await this.recordFailedLogin(user._id);
      throw invalid;
    }

    if (user.status !== AccountStatus.ACTIVE) {
      throw new ForbiddenException(`Account is ${user.status}`);
    }

    await this.userModel.updateOne(
      { _id: user._id },
      { $set: { failedLoginAttempts: 0, lockUntil: null } },
    );

    await this.startSession(res, String(user._id), user.sessionVersion ?? 0);
    return this.toProfile(user);
  }

  // ACC-05: the counter is incremented atomically, so parallel wrong guesses
  // cannot all read the same old value and slip past the limit.
  private async recordFailedLogin(userId: unknown) {
    const updated = await this.userModel.findOneAndUpdate(
      { _id: userId },
      { $inc: { failedLoginAttempts: 1 } },
      { new: true },
    );
    if (updated && updated.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
      await this.userModel.updateOne(
        { _id: userId, failedLoginAttempts: { $gte: MAX_FAILED_ATTEMPTS } },
        {
          $set: {
            lockUntil: new Date(Date.now() + LOCK_MINUTES * 60 * 1000),
            failedLoginAttempts: 0,
          },
        },
      );
    }
  }

  async refresh(req: Request, res: Response) {
    const token = readCookie(req, 'refresh_token');
    if (!token) throw new UnauthorizedException('No refresh token');

    const user = await this.userModel
      .findOne({ refreshTokenHash: this.hash(token) })
      .select('+refreshTokenHash');
    if (!user) {
      this.clearCookies(res);
      throw new UnauthorizedException('Invalid session');
    }
    if (user.status !== AccountStatus.ACTIVE) {
      this.clearCookies(res);
      throw new ForbiddenException(`Account is ${user.status}`);
    }

    const last = user.lastActivityAt ? user.lastActivityAt.getTime() : 0;
    if (Date.now() - last > SESSION_IDLE_MS) {
      user.refreshTokenHash = null;
      await user.save();
      this.clearCookies(res);
      throw new UnauthorizedException('Session expired. Please log in again.');
    }

    // Rotates the refresh token; the session version stays the same.
    await this.startSession(res, String(user._id), user.sessionVersion ?? 0);
    return this.toProfile(user);
  }

  // ACC-06: revokes the refresh token and every access token already issued.
  // Logout is a public route, so the user is found from either cookie.
  async logout(req: Request, res: Response) {
    const revoke = {
      $set: { refreshTokenHash: null },
      $inc: { sessionVersion: 1 },
    };
    const refreshToken = readCookie(req, 'refresh_token');
    const accessToken = readCookie(req, 'access_token');

    let revoked = false;
    if (refreshToken) {
      const r = await this.userModel.updateOne(
        { refreshTokenHash: this.hash(refreshToken) },
        revoke,
      );
      revoked = r.modifiedCount > 0;
    }
    if (!revoked && accessToken) {
      const payload = await this.jwt
        .verifyAsync<{ sub: string }>(accessToken)
        .catch(() => null);
      if (payload?.sub) {
        await this.userModel.updateOne({ _id: payload.sub }, revoke);
      }
    }
    this.clearCookies(res);
    return { message: 'Logged out' };
  }

  async getProfile(userId: string) {
    const user = await this.userModel.findById(userId).lean();
    if (!user) throw new NotFoundException('User not found');
    return this.toProfile(user);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.userModel.findByIdAndUpdate(
      userId,
      { $set: dto },
      { new: true },
    );
    if (!user) throw new NotFoundException('User not found');
    return this.toProfile(user);
  }

  // ACC-08: every other session is revoked; this device gets a fresh session.
  async changePassword(userId: string, dto: ChangePasswordDto, res: Response) {
    const user = await this.userModel.findById(userId).select('+passwordHash');
    if (!user) throw new NotFoundException('User not found');
    if (!(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
      throw new BadRequestException('Current password is incorrect');
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('New password must be different');
    }
    user.passwordHash = await bcrypt.hash(dto.newPassword, 10);
    user.mustChangePassword = false;
    user.refreshTokenHash = null;
    user.sessionVersion = (user.sessionVersion ?? 0) + 1;
    await user.save();
    await this.startSession(res, String(user._id), user.sessionVersion);
    return { message: 'Password changed' };
  }

  async deactivate(userId: string) {
    // ACC-12: blocked while the user has upcoming Confirmed bookings.
    // TODO: add that check once the booking modules exist.
    await this.userModel.findByIdAndUpdate(userId, {
      $set: { status: AccountStatus.DEACTIVATED, refreshTokenHash: null },
      $inc: { sessionVersion: 1 },
    });
    return { message: 'Account deactivated' };
  }
}
