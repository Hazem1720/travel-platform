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
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import {
  EMAIL_NOT_VERIFIED,
  REQUIRE_VERIFIED_EMAIL_KEY,
} from '../../common/decorators/verified-email.decorator';
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
    // GEN-13: registered globally (APP_GUARD), so only @Public() routes skip it.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      // GEN-10: a public route still learns who is asking when a valid
      // session is present (the author of hidden content, an admin), and
      // never refuses the request because of the cookie.
      await this.attachIfLoggedIn(context.switchToHttp().getRequest()).catch(
        () => undefined,
      );
      return true;
    }

    const req = context.switchToHttp().getRequest();
    const token = req.cookies?.['access_token'];
    // cookie-parser turns "j:{...}" cookies into objects; only a string is a token.
    if (typeof token !== 'string' || !token) {
      throw new UnauthorizedException('Authentication required');
    }

    let payload: { sub: string; sv?: number };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired session');
    }

    const user = await this.userModel.findById(payload.sub).lean();
    if (!user) {
      throw new UnauthorizedException('Account not found');
    }
    // ACC-06: tokens issued before logout or a password change are revoked.
    if (payload.sv !== (user.sessionVersion ?? 0)) {
      throw new UnauthorizedException('Session expired. Please log in again.');
    }
    if (user.status !== AccountStatus.ACTIVE) {
      throw new ForbiddenException(`Account is ${user.status}`);
    }

    // ACC-06: idle for more than 30 minutes means the session is over.
    const now = Date.now();
    const last = user.lastActivityAt
      ? new Date(user.lastActivityAt).getTime()
      : null;
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
      throw new ForbiddenException(
        'You must change your temporary password first',
      );
    }

    // ACC-02 (bonus): no booking until the email address is verified.
    const needsVerified = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_VERIFIED_EMAIL_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (needsVerified && user.emailVerified === false) {
      throw new ForbiddenException(EMAIL_NOT_VERIFIED);
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

  // For @Public() routes: sets req.user only for a valid, current, active,
  // non-idle session with no pending temporary password; otherwise leaves
  // the request anonymous. Does not count as activity (ACC-06).
  private async attachIfLoggedIn(req: {
    cookies?: Record<string, unknown>;
    user?: AuthUser;
  }): Promise<void> {
    const token = req.cookies?.['access_token'];
    if (typeof token !== 'string' || !token) return;
    const payload = await this.jwt.verifyAsync<{ sub: string; sv?: number }>(
      token,
    );
    const user = await this.userModel.findById(payload.sub).lean();
    if (!user || payload.sv !== (user.sessionVersion ?? 0)) return;
    if (user.status !== AccountStatus.ACTIVE || user.mustChangePassword) return;
    const last = user.lastActivityAt
      ? new Date(user.lastActivityAt).getTime()
      : null;
    if (last !== null && Date.now() - last > SESSION_IDLE_MS) return;
    req.user = {
      id: String(user._id),
      role: user.role,
      assignedProviderId: user.assignedProviderId
        ? String(user.assignedProviderId)
        : null,
    };
  }
}
