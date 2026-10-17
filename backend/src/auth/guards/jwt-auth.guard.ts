import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SESSION_IDLE_MS } from '../../common/constants/session.constants';
import { ALLOW_PASSWORD_CHANGE_KEY } from '../../common/decorators/allow-password-change.decorator';
import { AccountStatus } from '../../common/enums/role.enum';
import { AuthUser } from '../../common/types/auth-user.type';
import { User, UserDocument } from '../../users/schemas/user.schema';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const token = req.cookies?.['access_token'];
    if (!token) {
      throw new UnauthorizedException('Authentication required');
    }

    let payload: { sub: string };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired session');
    }

    const user = await this.userModel.findById(payload.sub).lean();
    if (!user) {
      throw new UnauthorizedException('Account not found');
    }
    if (user.status !== AccountStatus.ACTIVE) {
      throw new ForbiddenException(`Account is ${user.status}`);
    }

    // ACC-06: idle for more than 30 minutes means the session is over.
    const now = Date.now();
    const last = user.lastActivityAt ? new Date(user.lastActivityAt).getTime() : null;
    if (last !== null && now - last > SESSION_IDLE_MS) {
      throw new UnauthorizedException('Session expired. Please log in again.');
    }
    if (last === null || now - last > 60_000) {
      await this.userModel.updateOne(
        { _id: user._id },
        { $set: { lastActivityAt: new Date(now) } },
      );
    }

    // ACC-07a / ACC-13: a temporary password must be changed before anything else.
    const allowed = this.reflector.getAllAndOverride<boolean>(
      ALLOW_PASSWORD_CHANGE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (user.mustChangePassword && !allowed) {
      throw new ForbiddenException('You must change your temporary password first');
    }

    const authUser: AuthUser = {
      id: String(user._id),
      role: user.role,
      assignedProviderId: user.assignedProviderId
        ? String(user.assignedProviderId)
        : null,
    };
    req.user = authUser;
    return true;
  }
}