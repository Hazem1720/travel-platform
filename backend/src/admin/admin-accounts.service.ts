import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { Model, Types } from 'mongoose';
import { Airline, AirlineDocument } from '../airlines/schemas/airline.schema';
import { AuditService } from '../audit/audit.service';
import {
  AuditAction,
  AuditTargetType,
} from '../audit/schemas/audit-log.schema';
import { AccountStatus, Role } from '../common/enums/role.enum';
import { AuthUser } from '../common/types/auth-user.type';
import { Hotel, HotelDocument } from '../hotels/schemas/hotel.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/schemas/notification.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { CreateModeratorDto } from './dto/create-moderator.dto';

export const ACCOUNT_NOT_FOUND = 'Account not found';
export const AIRLINE_NOT_FOUND = 'Airline not found';
export const HOTEL_NOT_FOUND = 'Hotel not found';
export const ADMIN_NOT_SUSPENDABLE = 'An admin account cannot be suspended';

export type ProviderKind = 'airline' | 'hotel';

// What an admin route returns for an account: never a password or token hash.
export function toManagedAccount(u: any) {
  return {
    _id: String(u._id),
    name: u.name,
    email: u.email,
    role: u.role,
    status: u.status,
    assignedProviderId: u.assignedProviderId
      ? String(u.assignedProviderId)
      : null,
    mustChangePassword: !!u.mustChangePassword,
    createdAt: u.createdAt,
  };
}

// ACC-13 (moderator accounts), ACC-15 (suspend moderators, deactivate
// providers) and ACC-16 (suspend users). Every action writes an audit-log
// row (GEN-07) and notifies the affected account(s) (GEN-01).
@Injectable()
export class AdminAccountsService {
  private readonly logger = new Logger(AdminAccountsService.name);

  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Airline.name)
    private readonly airlines: Model<AirlineDocument>,
    @InjectModel(Hotel.name) private readonly hotels: Model<HotelDocument>,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  private providerModel(kind: ProviderKind): Model<any> {
    return kind === 'airline' ? this.airlines : this.hotels;
  }

  // ACC-13. A duplicate email is a duplicate-key error: 409 through the
  // global filter.
  async createModerator(admin: AuthUser, dto: CreateModeratorDto) {
    const kind: ProviderKind =
      dto.role === Role.AIRLINE_MODERATOR ? 'airline' : 'hotel';
    const exists = await this.providerModel(kind).exists({
      _id: dto.providerId,
    });
    if (!exists) {
      throw new NotFoundException(
        kind === 'airline' ? AIRLINE_NOT_FOUND : HOTEL_NOT_FOUND,
      );
    }

    const user = await this.users.create({
      name: dto.name,
      email: dto.email,
      passwordHash: await bcrypt.hash(dto.temporaryPassword, 10),
      role: dto.role,
      assignedProviderId: new Types.ObjectId(dto.providerId),
      mustChangePassword: true,
    });
    await this.log(admin, AuditAction.MODERATOR_CREATED, AuditTargetType.USER, {
      targetId: user._id,
      details: { email: dto.email, role: dto.role, providerId: dto.providerId },
    });
    return toManagedAccount(user.toObject());
  }

  // ACC-15 (moderators), ACC-16 (users). The account's sessions end at once
  // (sessionVersion), and login answers "Account is suspended" (ACC-04).
  // Bookings and content are not touched.
  async suspend(admin: AuthUser, id: string, reason?: string) {
    const target = await this.users.findById(id).lean();
    if (!target) throw new NotFoundException(ACCOUNT_NOT_FOUND);
    if (target.role === Role.ADMIN) {
      throw new ForbiddenException(ADMIN_NOT_SUSPENDABLE);
    }
    const updated = await this.users
      .findOneAndUpdate(
        { _id: target._id, status: AccountStatus.ACTIVE },
        {
          $set: { status: AccountStatus.SUSPENDED, refreshTokenHash: null },
          $inc: { sessionVersion: 1 },
        },
        { new: true },
      )
      .lean();
    if (!updated) {
      throw new ConflictException(`Account is already ${target.status}`);
    }
    await this.log(admin, AuditAction.ACCOUNT_SUSPENDED, AuditTargetType.USER, {
      targetId: target._id,
      details: { role: target.role, reason: reason ?? null },
    });
    await this.notify(
      [target._id],
      NotificationType.ACCOUNT_SUSPENDED,
      'Your account has been suspended by an administrator' +
        (reason ? `: ${reason}` : ''),
    );
    return toManagedAccount(updated);
  }

  async reactivate(admin: AuthUser, id: string, reason?: string) {
    const target = await this.users.findById(id).lean();
    if (!target) throw new NotFoundException(ACCOUNT_NOT_FOUND);
    const updated = await this.users
      .findOneAndUpdate(
        { _id: target._id, status: AccountStatus.SUSPENDED },
        { $set: { status: AccountStatus.ACTIVE } },
        { new: true },
      )
      .lean();
    if (!updated) {
      throw new ConflictException(
        `Only a suspended account can be reactivated (it is ${target.status})`,
      );
    }
    await this.log(
      admin,
      AuditAction.ACCOUNT_REACTIVATED,
      AuditTargetType.USER,
      {
        targetId: target._id,
        details: { role: target.role, reason: reason ?? null },
      },
    );
    return toManagedAccount(updated);
  }

  // ACC-15: a deactivated airline or hotel is hidden from search and cannot
  // be booked (search filters isActive: true); Confirmed bookings stay.
  async setProviderActive(
    admin: AuthUser,
    kind: ProviderKind,
    id: string,
    active: boolean,
    reason?: string,
  ) {
    const model = this.providerModel(kind);
    const current = await model.findById(id).lean<any>();
    if (!current) {
      throw new NotFoundException(
        kind === 'airline' ? AIRLINE_NOT_FOUND : HOTEL_NOT_FOUND,
      );
    }
    const updated = await model
      .findOneAndUpdate(
        { _id: current._id, isActive: !active },
        { $set: { isActive: active } },
        { new: true },
      )
      .lean<any>();
    if (!updated) {
      throw new ConflictException(
        `This ${kind} is already ${active ? 'active' : 'deactivated'}`,
      );
    }

    await this.log(
      admin,
      active
        ? AuditAction.PROVIDER_REACTIVATED
        : AuditAction.PROVIDER_DEACTIVATED,
      kind === 'airline' ? AuditTargetType.AIRLINE : AuditTargetType.HOTEL,
      {
        targetId: current._id,
        details: { name: current.name, reason: reason ?? null },
      },
    );

    let notified = 0;
    if (!active) {
      const moderators = await this.users
        .find({
          assignedProviderId: current._id,
          role:
            kind === 'airline' ? Role.AIRLINE_MODERATOR : Role.HOTEL_MODERATOR,
        })
        .select('_id')
        .lean();
      notified = await this.notify(
        moderators.map((m) => m._id),
        NotificationType.PROVIDER_SUSPENDED,
        `${current.name} has been deactivated by an administrator: it is ` +
          'hidden from search and cannot be booked' +
          (reason ? ` (${reason})` : ''),
        { providerType: kind, providerId: String(current._id) },
      );
    }
    return {
      _id: String(updated._id),
      name: updated.name,
      isActive: updated.isActive,
      notified,
    };
  }

  private async log(
    admin: AuthUser,
    action: AuditAction,
    targetType: AuditTargetType,
    entry: {
      targetId: Types.ObjectId | string;
      details: Record<string, unknown>;
    },
  ) {
    await this.audit.log({
      adminId: admin.id,
      action,
      targetType,
      targetId: entry.targetId,
      details: entry.details,
    });
  }

  // A failed notification never undoes the admin action.
  private async notify(
    userIds: Array<Types.ObjectId | string>,
    type: NotificationType,
    message: string,
    data?: Record<string, unknown>,
  ): Promise<number> {
    const results = await Promise.all(
      userIds.map((id) =>
        this.notifications.create(id, type, message, data).then(
          () => true,
          (err: Error) => {
            this.logger.error(`Notification failed: ${err.message}`);
            return false;
          },
        ),
      ),
    );
    return results.filter(Boolean).length;
  }
}
