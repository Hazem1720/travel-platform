import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { Model } from 'mongoose';
import { AuditService } from '../audit/audit.service';
import {
  AuditAction,
  AuditTargetType,
} from '../audit/schemas/audit-log.schema';
import { Role } from '../common/enums/role.enum';
import { AuthUser } from '../common/types/auth-user.type';
import { User, UserDocument } from '../users/schemas/user.schema';
import { ACCOUNT_NOT_FOUND, toManagedAccount } from './admin-accounts.service';
import { ResetPasswordDto } from './dto/reset-password.dto';

export const ADMIN_PASSWORD_NOT_RESETTABLE =
  "An admin's password cannot be reset by another admin";

// ACC-07a: an admin resets a user's or moderator's password to a temporary
// password (conventions.md, "Temporary passwords").
@Injectable()
export class AccountPasswordService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    private readonly audit: AuditService,
  ) {}

  // One update stores the new hash, sets mustChangePassword (the JWT guard
  // then allows only PATCH /auth/change-password), clears the refresh token
  // and bumps sessionVersion, so every open session of the account ends.
  // A malformed id is a cast error: 400 through the global filter.
  async resetPassword(admin: AuthUser, id: string, dto: ResetPasswordDto) {
    const target = await this.users.findById(id).lean();
    if (!target) throw new NotFoundException(ACCOUNT_NOT_FOUND);
    // The requirement covers users and moderators only.
    if (target.role === Role.ADMIN) {
      throw new ForbiddenException(ADMIN_PASSWORD_NOT_RESETTABLE);
    }

    const passwordHash = await bcrypt.hash(dto.temporaryPassword, 10);
    const updated = await this.users
      .findOneAndUpdate(
        { _id: target._id, role: { $ne: Role.ADMIN } },
        {
          $set: {
            passwordHash,
            mustChangePassword: true,
            refreshTokenHash: null,
          },
          $inc: { sessionVersion: 1 },
        },
        { new: true },
      )
      .lean();
    if (!updated) throw new NotFoundException(ACCOUNT_NOT_FOUND);

    // Never the password itself.
    await this.audit.log({
      adminId: admin.id,
      action: AuditAction.PASSWORD_RESET,
      targetType: AuditTargetType.USER,
      targetId: target._id,
      details: { email: target.email, role: target.role },
    });
    return toManagedAccount(updated);
  }
}
