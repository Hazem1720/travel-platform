import { BadRequestException } from '@nestjs/common';
import { createConnection, Types } from 'mongoose';
import { AuditService, dateRange } from './audit.service';
import {
  AUDIT_APPEND_ONLY,
  AuditAction,
  AuditLogSchema,
  AuditTargetType,
} from './schemas/audit-log.schema';

describe('AuditService (GEN-07)', () => {
  const ADMIN = '6735a1f4c1a2b3c4d5e6f701';
  const TARGET = '6735a1f4c1a2b3c4d5e6f702';

  function setup(total = 1) {
    const query = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn(async () => []),
    };
    const model = {
      create: jest.fn(async (doc: object) => ({ toObject: () => doc })),
      find: jest.fn(() => query),
      countDocuments: jest.fn(async () => total),
    };
    return { service: new AuditService(model as any), model, query };
  }

  it('logs an admin action', async () => {
    const { service, model } = setup();
    await service.log({
      adminId: ADMIN,
      action: AuditAction.ACCOUNT_SUSPENDED,
      targetType: AuditTargetType.USER,
      targetId: new Types.ObjectId(TARGET),
      details: { reason: 'Spam posts' },
    });
    expect(model.create).toHaveBeenCalledWith({
      adminId: new Types.ObjectId(ADMIN),
      action: AuditAction.ACCOUNT_SUSPENDED,
      targetType: AuditTargetType.USER,
      targetId: TARGET,
      details: { reason: 'Spam posts' },
    });
  });

  it('refuses an invalid admin id (a bug in the caller)', async () => {
    const { service } = setup();
    await expect(
      service.log({
        adminId: 'x',
        action: AuditAction.CONTENT_DELETED,
        targetType: AuditTargetType.POST,
        targetId: TARGET,
      }),
    ).rejects.toThrow('invalid adminId');
  });

  it('lists newest first, 10 per page, filtered by action, admin and dates', async () => {
    const { service, model, query } = setup(11);
    const res = await service.list({
      page: 2,
      limit: 10,
      action: AuditAction.ACCOUNT_SUSPENDED,
      adminId: ADMIN,
      from: '2026-11-01',
      to: '2026-11-30',
    });
    expect(model.find).toHaveBeenCalledWith({
      action: AuditAction.ACCOUNT_SUSPENDED,
      adminId: new Types.ObjectId(ADMIN),
      createdAt: {
        $gte: new Date('2026-11-01T00:00:00Z'),
        $lt: new Date('2026-12-01T00:00:00Z'),
      },
    });
    expect(query.sort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(query.skip).toHaveBeenCalledWith(10);
    expect(res.meta).toEqual({ page: 2, limit: 10, total: 11, totalPages: 2 });
  });

  it('lists everything without filters', async () => {
    const { service, model } = setup();
    await service.list({ page: 1, limit: 10 });
    expect(model.find).toHaveBeenCalledWith({});
  });

  it('has no update or delete method', () => {
    const methods = Object.getOwnPropertyNames(AuditService.prototype);
    expect(methods.sort()).toEqual(['constructor', 'list', 'log']);
  });
});

describe('dateRange (GEN-07 filter)', () => {
  it('includes the whole "to" day when only a date is given', () => {
    expect(dateRange(undefined, '2026-11-20')).toEqual({
      $lt: new Date('2026-11-21T00:00:00Z'),
    });
  });

  it('uses an exact time as given', () => {
    expect(dateRange('2026-11-20T08:00:00Z', '2026-11-20T09:00:00Z')).toEqual({
      $gte: new Date('2026-11-20T08:00:00Z'),
      $lte: new Date('2026-11-20T09:00:00Z'),
    });
  });

  it('accepts the same day for from and to', () => {
    expect(() => dateRange('2026-11-20', '2026-11-20')).not.toThrow();
  });

  it('rejects from after to', () => {
    expect(() => dateRange('2026-11-21', '2026-11-20')).toThrow(
      BadRequestException,
    );
  });

  it('returns null without dates', () => {
    expect(dateRange()).toBeNull();
  });
});

describe('AuditLog schema is append-only (GEN-07)', () => {
  // A connection that never connects: the hooks run before any database call.
  const conn = createConnection();
  const Model = conn.model('AuditLogAppendOnlyTest', AuditLogSchema);
  afterAll(() => conn.close());

  it.each([
    ['updateOne', () => Model.updateOne({}, { action: 'X' }).exec()],
    ['updateMany', () => Model.updateMany({}, { action: 'X' }).exec()],
    ['findOneAndUpdate', () => Model.findOneAndUpdate({}, {}).exec()],
    ['replaceOne', () => Model.replaceOne({}, {}).exec()],
    ['deleteOne', () => Model.deleteOne({}).exec()],
    ['deleteMany', () => Model.deleteMany({}).exec()],
    ['findOneAndDelete', () => Model.findOneAndDelete({}).exec()],
  ])('blocks %s', async (_name, run) => {
    await expect(run()).rejects.toThrow(AUDIT_APPEND_ONLY);
  });
});
