import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as bcrypt from 'bcrypt';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Types } from 'mongoose';
import {
  AuditAction,
  AuditTargetType,
} from '../audit/schemas/audit-log.schema';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { AccountStatus, Role } from '../common/enums/role.enum';
import { AuthUser } from '../common/types/auth-user.type';
import { AccountListController } from './account-list.controller';
import {
  AccountPasswordService,
  ADMIN_PASSWORD_NOT_RESETTABLE,
} from './account-password.service';
import { ACCOUNT_NOT_FOUND } from './admin-accounts.service';
import { ResetPasswordDto } from './dto/reset-password.dto';

// ACC-07a with mocked models (no database). The JWT guard's own tests cover
// "mustChangePassword allows only change-password" and "an old sessionVersion
// is 401"; here we check that the reset sets both.
describe('Admin password reset (ACC-07a)', () => {
  const admin: AuthUser = {
    id: new Types.ObjectId().toHexString(),
    role: Role.ADMIN,
    assignedProviderId: null,
  };

  const account = (over: object = {}) => ({
    _id: new Types.ObjectId(),
    name: 'TEST Sara',
    email: 'sara@example.test',
    role: Role.USER,
    status: AccountStatus.ACTIVE,
    assignedProviderId: null,
    mustChangePassword: false,
    sessionVersion: 3,
    createdAt: new Date('2026-11-01T10:00:00Z'),
    ...over,
  });

  function setup(target: any) {
    const users = {
      findById: jest.fn(() => ({ lean: async () => target })),
      findOneAndUpdate: jest.fn((_filter: any, update: any) => ({
        lean: async () =>
          target && target.role !== Role.ADMIN
            ? {
                ...target,
                ...update.$set,
                sessionVersion: target.sessionVersion + 1,
              }
            : null,
      })),
    };
    const audit = { log: jest.fn(async () => ({})) };
    const service = new AccountPasswordService(users as any, audit as any);
    return { service, users, audit };
  }

  const dto = { temporaryPassword: 'TempPass123' };

  it('resets a user: new hash, mustChangePassword, sessions revoked', async () => {
    const target = account();
    const { service, users } = setup(target);
    const res = await service.resetPassword(admin, String(target._id), dto);

    const [filter, update] = (users.findOneAndUpdate.mock.calls as any[])[0];
    expect(filter).toEqual({ _id: target._id, role: { $ne: Role.ADMIN } });
    expect(update.$set.mustChangePassword).toBe(true);
    expect(update.$set.refreshTokenHash).toBeNull();
    // A higher sessionVersion makes every old access token answer 401.
    expect(update.$inc).toEqual({ sessionVersion: 1 });
    expect(update.$set.passwordHash).not.toBe(dto.temporaryPassword);
    await expect(
      bcrypt.compare(dto.temporaryPassword, update.$set.passwordHash),
    ).resolves.toBe(true);

    expect(res).toMatchObject({
      _id: String(target._id),
      email: target.email,
      mustChangePassword: true,
    });
    expect(res).not.toHaveProperty('passwordHash');
    expect(res).not.toHaveProperty('refreshTokenHash');
    expect(res).not.toHaveProperty('sessionVersion');
  });

  it('resets airline and hotel moderators too', async () => {
    for (const role of [Role.AIRLINE_MODERATOR, Role.HOTEL_MODERATOR]) {
      const target = account({
        role,
        assignedProviderId: new Types.ObjectId(),
      });
      const { service } = setup(target);
      await expect(
        service.resetPassword(admin, String(target._id), dto),
      ).resolves.toMatchObject({ role, mustChangePassword: true });
    }
  });

  it('writes an audit-log row without the password', async () => {
    const target = account();
    const { service, audit } = setup(target);
    await service.resetPassword(admin, String(target._id), dto);
    expect(audit.log).toHaveBeenCalledWith({
      adminId: admin.id,
      action: AuditAction.PASSWORD_RESET,
      targetType: AuditTargetType.USER,
      targetId: target._id,
      details: { email: target.email, role: Role.USER },
    });
    expect(JSON.stringify((audit.log.mock.calls as any[])[0])).not.toContain(
      dto.temporaryPassword,
    );
  });

  it('unknown id: 404, nothing written', async () => {
    const { service, users, audit } = setup(null);
    await expect(
      service.resetPassword(admin, new Types.ObjectId().toHexString(), dto),
    ).rejects.toThrow(new NotFoundException(ACCOUNT_NOT_FOUND));
    expect(users.findOneAndUpdate).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('an admin account: 403, nothing written', async () => {
    const target = account({ role: Role.ADMIN });
    const { service, users, audit } = setup(target);
    await expect(
      service.resetPassword(admin, String(target._id), dto),
    ).rejects.toThrow(new ForbiddenException(ADMIN_PASSWORD_NOT_RESETTABLE));
    expect(users.findOneAndUpdate).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('the account becomes an admin between the read and the write: 404', async () => {
    const target = account();
    const { service, users, audit } = setup(target);
    users.findOneAndUpdate.mockReturnValueOnce({ lean: async () => null });
    await expect(
      service.resetPassword(admin, String(target._id), dto),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(audit.log).not.toHaveBeenCalled();
  });

  describe('temporary password rules (400)', () => {
    const failed = async (body: object) => {
      const errors = await validate(plainToInstance(ResetPasswordDto, body));
      return errors.map((e) => e.property);
    };

    it('accepts a password with 8+ characters, a letter and a digit', async () => {
      expect(await failed({ temporaryPassword: 'TempPass123' })).toEqual([]);
    });

    it('rejects abc, letters only, digits only and a missing field', async () => {
      for (const temporaryPassword of ['abc', 'abcdefgh', '12345678']) {
        expect(await failed({ temporaryPassword })).toEqual([
          'temporaryPassword',
        ]);
      }
      expect(await failed({})).toEqual(['temporaryPassword']);
    });
  });

  it('the route is admin only', () => {
    const roles = new Reflector().get<Role[]>(ROLES_KEY, AccountListController);
    expect(roles).toEqual([Role.ADMIN]);
  });
});
