import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';

import { ReportsService } from './reports.service';
import { ReportSchema, ReportTargetType } from './schemas/report.schema';

describe('ReportsService (GEN-09 and GEN-10)', () => {
  let reports: any;
  let collections: Record<string, any>;
  let connection: any;
  let audit: any;
  let service: ReportsService;

  const reporterId = new Types.ObjectId().toString();
  const adminId = new Types.ObjectId().toString();
  const targetId = new Types.ObjectId().toString();

  const reporter = {
    id: reporterId,
    role: 'user' as any,
    assignedProviderId: null,
  };

  const admin = {
    id: adminId,
    role: 'admin' as any,
    assignedProviderId: null,
  };

  const makeCollection = () => ({
    findOne: jest.fn(),
    updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
  });

  beforeEach(() => {
    collections = {
      posts: makeCollection(),
      comments: makeCollection(),
      reviews: makeCollection(),
      itineraries: makeCollection(),
    };

    collections.posts.findOne.mockResolvedValue({
      _id: new Types.ObjectId(targetId),
      status: 'Published',
      hidden: false,
      authorId: new Types.ObjectId(),
      commentCount: 1,
    });

    collections.comments.findOne.mockResolvedValue({
      _id: new Types.ObjectId(targetId),
      postId: new Types.ObjectId(),
      hidden: false,
      authorId: new Types.ObjectId(),
    });

    connection = {
      collection: jest.fn((name: string) => collections[name]),
    };

    reports = {
      create: jest.fn().mockResolvedValue({
        toObject: () => ({ status: 'open' }),
      }),
      find: jest.fn(),
      countDocuments: jest.fn(),
      findById: jest.fn(),
    };

    audit = {
      log: jest.fn().mockResolvedValue({}),
    };

    service = new ReportsService(reports, connection, audit);
  });

  it('creates a report for a published post', async () => {
    await service.create(reporter, {
      targetType: ReportTargetType.POST,
      targetId,
      reason: 'Spam',
    });

    expect(reports.create).toHaveBeenCalledWith(
      expect.objectContaining({
        targetType: ReportTargetType.POST,
        targetId,
        reason: 'Spam',
      }),
    );
  });

  it('returns 409 for a duplicate report', async () => {
    reports.create.mockRejectedValue({ code: 11000 });

    await expect(
      service.create(reporter, {
        targetType: ReportTargetType.POST,
        targetId,
        reason: 'Spam',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects an invalid target ID', async () => {
    await expect(
      service.create(reporter, {
        targetType: ReportTargetType.POST,
        targetId: 'invalid-id',
        reason: 'Spam',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not allow reporting a draft post', async () => {
    collections.posts.findOne.mockResolvedValue({
      _id: new Types.ObjectId(targetId),
      status: 'Draft',
      hidden: false,
    });

    await expect(
      service.create(reporter, {
        targetType: ReportTargetType.POST,
        targetId,
        reason: 'Spam',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('does not allow reporting another user hidden content', async () => {
    collections.posts.findOne.mockResolvedValue({
      _id: new Types.ObjectId(targetId),
      status: 'Published',
      hidden: true,
      authorId: new Types.ObjectId(),
    });

    await expect(
      service.create(reporter, {
        targetType: ReportTargetType.POST,
        targetId,
        reason: 'Spam',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects unsupported content types during moderation', async () => {
    await expect(
      service.moderateContent(admin, 'invalid', targetId, 'hide'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('audits direct content hiding', async () => {
    await service.moderateContent(admin, 'post', targetId, 'hide');

    expect(collections.posts.updateOne).toHaveBeenCalledWith(
      { _id: new Types.ObjectId(targetId) },
      { $set: { hidden: true } },
    );

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CONTENT_HIDDEN',
        targetType: 'post',
        details: expect.objectContaining({
          hidden: true,
        }),
      }),
    );
  });

  it('audits direct content unhiding', async () => {
    await service.hideContent(admin, 'post', targetId, false);

    expect(collections.posts.updateOne).toHaveBeenCalledWith(
      { _id: new Types.ObjectId(targetId) },
      { $set: { hidden: false } },
    );

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CONTENT_HIDDEN',
        targetType: 'post',
        details: { hidden: false },
      }),
    );
  });

  it('audits direct content deletion', async () => {
    await service.moderateContent(admin, 'post', targetId, 'delete');

    expect(collections.posts.deleteOne).toHaveBeenCalledWith({
      _id: new Types.ObjectId(targetId),
    });

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CONTENT_DELETED',
        targetType: 'post',
      }),
    );
  });

  it('decrements comment count without allowing a negative value', async () => {
    const postId = new Types.ObjectId();

    collections.comments.findOne.mockResolvedValue({
      _id: new Types.ObjectId(targetId),
      postId,
      authorId: new Types.ObjectId(),
    });

    await service.moderateContent(admin, 'comment', targetId, 'delete');

    expect(collections.comments.deleteOne).toHaveBeenCalledWith({
      _id: new Types.ObjectId(targetId),
    });

    expect(collections.posts.updateOne).toHaveBeenCalledWith(
      {
        _id: postId,
        commentCount: { $gt: 0 },
      },
      {
        $inc: { commentCount: -1 },
      },
    );
  });

  it('does not decrement comment count when deletion fails', async () => {
    const postId = new Types.ObjectId();

    collections.comments.findOne.mockResolvedValue({
      _id: new Types.ObjectId(targetId),
      postId,
      authorId: new Types.ObjectId(),
    });

    collections.comments.deleteOne.mockResolvedValue({
      deletedCount: 0,
    });

    await expect(
      service.moderateContent(admin, 'comment', targetId, 'delete'),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(collections.posts.updateOne).not.toHaveBeenCalled();
  });

  it('enforces a unique report per reporter and target', () => {
    expect(ReportSchema.indexes()).toContainEqual([
      {
        reporterId: 1,
        targetType: 1,
        targetId: 1,
      },
      {
        unique: true,
        background: true,
      },
    ]);
  });
});
