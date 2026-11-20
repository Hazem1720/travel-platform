import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Types } from 'mongoose';
import {
  AuditAction,
  AuditTargetType,
} from '../audit/schemas/audit-log.schema';
import { AccountStatus, Role } from '../common/enums/role.enum';
import { AuthUser } from '../common/types/auth-user.type';
import { NotificationType } from '../notifications/schemas/notification.schema';
import { AdminAccountsService } from './admin-accounts.service';
import { CreateModeratorDto } from './dto/create-moderator.dto';
import { providerKind } from './admin-accounts.controller';

// ACC-13, ACC-15, ACC-16 with mocked models (no database).
const admin: AuthUser = {
  id: new Types.ObjectId().toHexString(),
  role: Role.ADMIN,
  assignedProviderId: null,
};
const AIRLINE = new Types.ObjectId();
const HOTEL = new Types.ObjectId();

const lean = (value: unknown) => ({ lean: async () => value });

function setup(opts: { user?: any; updatedUser?: any; provider?: any } = {}) {
  const users = {
    create: jest.fn(async (doc: any) => ({
      _id: new Types.ObjectId(),
      toObject: () => ({
        _id: new Types.ObjectId(),
        status: AccountStatus.ACTIVE,
        ...doc,
      }),
    })),
    findById: jest.fn(() => lean(opts.user ?? null)),
    findOneAndUpdate: jest.fn<any, [any, any, any]>(() =>
      lean(opts.updatedUser ?? null),
    ),
    find: jest.fn(() => ({
      select: () => lean([{ _id: new Types.ObjectId() }]),
    })),
  };
  const provider = () => ({
    exists: jest.fn(async (q: any) =>
      String(q._id) === String(opts.provider?._id) ? { _id: q._id } : null,
    ),
    findById: jest.fn(() => lean(opts.provider ?? null)),
    findOneAndUpdate: jest.fn<any, [any, any, any]>((filter, update) =>
      lean(
        opts.provider && opts.provider.isActive === filter.isActive
          ? { ...opts.provider, ...update.$set }
          : null,
      ),
    ),
  });
  const airlines = provider();
  const hotels = provider();
  const audit = { log: jest.fn(async () => ({})) };
  const notifications = { create: jest.fn<any, any[]>(async () => ({})) };
  const service = new AdminAccountsService(
    users as any,
    airlines as any,
    hotels as any,
    audit as any,
    notifications as any,
  );
  return { service, users, airlines, hotels, audit, notifications };
}

describe('ACC-13 createModerator', () => {
  const dto = (over: Partial<CreateModeratorDto> = {}): CreateModeratorDto => ({
    name: 'TEST Moderator',
    email: 'test.mod@example.com',
    role: Role.AIRLINE_MODERATOR,
    providerId: String(AIRLINE),
    temporaryPassword: 'TempPass123',
    ...over,
  });

  it('creates a moderator who must change the temporary password', async () => {
    const { service, users, audit } = setup({ provider: { _id: AIRLINE } });
    const res = await service.createModerator(admin, dto());

    const saved = users.create.mock.calls[0][0];
    expect(saved.mustChangePassword).toBe(true);
    expect(saved.role).toBe(Role.AIRLINE_MODERATOR);
    expect(String(saved.assignedProviderId)).toBe(String(AIRLINE));
    expect(saved.passwordHash).not.toBe('TempPass123');
    expect(await bcrypt.compare('TempPass123', saved.passwordHash)).toBe(true);

    expect(res).not.toHaveProperty('passwordHash');
    expect(res).toMatchObject({
      role: Role.AIRLINE_MODERATOR,
      assignedProviderId: String(AIRLINE),
      mustChangePassword: true,
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.MODERATOR_CREATED }),
    );
  });

  it('answers 404 for an airline moderator with a hotel id', async () => {
    const { service, users } = setup({ provider: { _id: AIRLINE } });
    await expect(
      service.createModerator(admin, dto({ providerId: String(HOTEL) })),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(users.create).not.toHaveBeenCalled();
  });

  it('checks a hotel moderator against the hotels', async () => {
    const { service, hotels, airlines } = setup({ provider: { _id: HOTEL } });
    await service.createModerator(
      admin,
      dto({ role: Role.HOTEL_MODERATOR, providerId: String(HOTEL) }),
    );
    expect(hotels.exists).toHaveBeenCalled();
    expect(airlines.exists).not.toHaveBeenCalled();
  });

  it.each([
    ['role', 'admin'],
    ['role', 'user'],
    ['providerId', 'abc'],
    ['temporaryPassword', 'short1'],
    ['temporaryPassword', 'nodigitshere'],
    ['email', 'not-an-email'],
  ])('rejects %s = %p', async (field, value) => {
    const body = { ...dto(), [field]: value };
    const errors = await validate(plainToInstance(CreateModeratorDto, body));
    expect(errors.map((e) => e.property)).toEqual([field]);
  });
});

describe('ACC-15, ACC-16 suspend and reactivate', () => {
  const moderator = {
    _id: new Types.ObjectId(),
    role: Role.AIRLINE_MODERATOR,
    status: AccountStatus.ACTIVE,
  };

  it('suspends, ends the sessions, logs and notifies', async () => {
    const { service, users, audit, notifications } = setup({
      user: moderator,
      updatedUser: { ...moderator, status: AccountStatus.SUSPENDED },
    });
    const res = await service.suspend(admin, 'id', 'Spam');

    const [filter, update] = users.findOneAndUpdate.mock.calls[0];
    expect(filter.status).toBe(AccountStatus.ACTIVE);
    expect(update.$set.status).toBe(AccountStatus.SUSPENDED);
    expect(update.$inc).toEqual({ sessionVersion: 1 });
    expect(res.status).toBe(AccountStatus.SUSPENDED);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.ACCOUNT_SUSPENDED,
        targetType: AuditTargetType.USER,
        details: { role: Role.AIRLINE_MODERATOR, reason: 'Spam' },
      }),
    );
    expect(notifications.create).toHaveBeenCalledWith(
      moderator._id,
      NotificationType.ACCOUNT_SUSPENDED,
      expect.stringContaining('Spam'),
      undefined,
    );
  });

  it('suspends a normal user the same way (ACC-16)', async () => {
    const user = { ...moderator, role: Role.USER };
    const { service } = setup({
      user,
      updatedUser: { ...user, status: AccountStatus.SUSPENDED },
    });
    await expect(service.suspend(admin, 'id')).resolves.toMatchObject({
      status: AccountStatus.SUSPENDED,
    });
  });

  it('refuses to suspend an admin', async () => {
    const { service } = setup({ user: { ...moderator, role: Role.ADMIN } });
    await expect(service.suspend(admin, 'id')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('answers 404 if unknown and 409 if already suspended', async () => {
    await expect(setup().service.suspend(admin, 'id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const suspended = { ...moderator, status: AccountStatus.SUSPENDED };
    const { service, notifications } = setup({ user: suspended });
    await expect(service.suspend(admin, 'id')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('reactivates only a suspended account', async () => {
    const suspended = { ...moderator, status: AccountStatus.SUSPENDED };
    const { service, users, audit } = setup({
      user: suspended,
      updatedUser: { ...moderator },
    });
    await service.reactivate(admin, 'id');
    expect(users.findOneAndUpdate.mock.calls[0][0].status).toBe(
      AccountStatus.SUSPENDED,
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditAction.ACCOUNT_REACTIVATED }),
    );

    const active = setup({ user: moderator });
    await expect(active.service.reactivate(admin, 'id')).rejects.toThrow(
      ConflictException,
    );
  });
});

describe('ACC-15 provider deactivation', () => {
  it('deactivates an airline, notifies and logs', async () => {
    const airline = { _id: AIRLINE, name: 'TEST Nile Air', isActive: true };
    const { service, airlines, users, audit, notifications } = setup({
      provider: airline,
    });
    const res = await service.setProviderActive(admin, 'airline', 'id', false);
    expect(res).toMatchObject({ isActive: false, notified: 1 });
    expect(airlines.findOneAndUpdate.mock.calls[0][1]).toEqual({
      $set: { isActive: false },
    });
    expect(users.find).toHaveBeenCalledWith({
      assignedProviderId: AIRLINE,
      role: Role.AIRLINE_MODERATOR,
    });
    expect(notifications.create.mock.calls[0][1]).toBe(
      NotificationType.PROVIDER_SUSPENDED,
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.PROVIDER_DEACTIVATED,
        targetType: AuditTargetType.AIRLINE,
      }),
    );
  });

  it('reactivates a hotel without notifying anyone', async () => {
    const hotel = { _id: HOTEL, name: 'TEST Hotel', isActive: false };
    const { service, hotels, notifications, audit } = setup({
      provider: hotel,
    });
    const res = await service.setProviderActive(admin, 'hotel', 'id', true);
    expect(res.isActive).toBe(true);
    expect(hotels.findOneAndUpdate).toHaveBeenCalled();
    expect(notifications.create).not.toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.PROVIDER_REACTIVATED,
        targetType: AuditTargetType.HOTEL,
      }),
    );
  });

  it('answers 409 if unchanged and 404 if unknown', async () => {
    const active = { _id: AIRLINE, name: 'TEST Nile Air', isActive: true };
    await expect(
      setup({ provider: active }).service.setProviderActive(
        admin,
        'airline',
        'id',
        true,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      setup().service.setProviderActive(admin, 'hotel', 'id', false),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ACC-15: /admin/providers/:type/:id (project description 8.2)', () => {
  it('accepts hotel or airline as :type, anything else is 400', () => {
    expect(providerKind('hotel')).toBe('hotel');
    expect(providerKind('airline')).toBe('airline');
    expect(() => providerKind('hotels')).toThrow(
      'type must be hotel or airline',
    );
  });
});
