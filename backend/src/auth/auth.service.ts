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
import type { Response } from 'express';
import { Model } from 'mongoose';
import { AccountStatus, Role } from '../common/enums/role.enum';
import { UpdateProfileDto } from '../users/dto/update-profile.dto';
import { User, UserDocument } from '../users/schemas/user.schema';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

// TODO: confirm these numbers in the Excel sheet (ACC-05).
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

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
      role: user.role,
      status: user.status,
      preferredCurrency: user.preferredCurrency,
      assignedProviderId: user.assignedProviderId
        ? String(user.assignedProviderId)
        : null,
    };
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
    const user = await this.userModel.findOne({ email }).select('+passwordHash');
    const invalid = new UnauthorizedException('Invalid email or password');
    if (!user) throw invalid;

    if (user.lockUntil && user.lockUntil.getTime() > Date.now()) {
      throw new HttpException('Account temporarily locked. Try again later.', 423);
    }

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      user.failedLoginAttempts += 1;
      if (user.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
        user.lockUntil = new Date(Date.now() + LOCK_MINUTES * 60 * 1000);
        user.failedLoginAttempts = 0;
      }
      await user.save();
      throw invalid;
    }

    if (user.status !== AccountStatus.ACTIVE) {
      throw new ForbiddenException(`Account is ${user.status}`);
    }

    user.failedLoginAttempts = 0;
    user.lockUntil = null;
    await user.save();

    await this.issueCookie(res, String(user._id));
    return this.toProfile(user);
  }

  private async issueCookie(res: Response, userId: string) {
    const token = await this.jwt.signAsync({ sub: userId });
    const { exp } = this.jwt.decode(token) as { exp: number };
    res.cookie('access_token', token, {
      httpOnly: true,
      secure: this.config.get<string>('COOKIE_SECURE') === 'true',
      sameSite: 'lax',
      path: '/',
      maxAge: exp * 1000 - Date.now(),
    });
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

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.userModel.findById(userId).select('+passwordHash');
    if (!user) throw new NotFoundException('User not found');
    if (!(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
      throw new BadRequestException('Current password is incorrect');
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('New password must be different');
    }
    user.passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await user.save();
    return { message: 'Password changed' };
  }

  async deactivate(userId: string) {
    await this.userModel.findByIdAndUpdate(userId, {
      status: AccountStatus.DEACTIVATED,
    });
    return { message: 'Account deactivated' };
  }
}