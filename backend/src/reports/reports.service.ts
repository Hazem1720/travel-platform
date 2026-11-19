import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, isValidObjectId, Model, Types } from 'mongoose';

import { AuditService } from '../audit/audit.service';
import {
  AuditAction,
  AuditTargetType,
} from '../audit/schemas/audit-log.schema';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto';
import { paginated } from '../common/pagination/pagination.helper';
import { AuthUser } from '../common/types/auth-user.type';
import { UploadsService } from '../uploads/uploads.service';
import { CreateReportDto } from './dto/create-report.dto';
import { ResolveReportDto } from './dto/resolve-report.dto';
import {
  Report,
  ReportDocument,
  ReportStatus,
  ReportTargetType,
} from './schemas/report.schema';

const COLLECTIONS: Record<ReportTargetType, string> = {
  [ReportTargetType.POST]: 'posts',
  [ReportTargetType.COMMENT]: 'comments',
  [ReportTargetType.REVIEW]: 'reviews',
  [ReportTargetType.ITINERARY]: 'itineraries',
};

@Injectable()
export class ReportsService {
  constructor(
    @InjectModel(Report.name)
    private readonly reports: Model<ReportDocument>,
    @InjectConnection()
    private readonly connection: Connection,
    private readonly audit: AuditService,
    private readonly uploads: UploadsService,
  ) {}

  async create(user: AuthUser, dto: CreateReportDto) {
    if (!isValidObjectId(dto.targetId)) {
      throw new NotFoundException('Reported content not found');
    }

    const targetId = new Types.ObjectId(dto.targetId);
    const collection = this.connection.collection(COLLECTIONS[dto.targetType]);

    const target = await collection.findOne({ _id: targetId });

    if (
      !target ||
      !(await this.isVisibleToReporter(dto.targetType, target, user.id))
    ) {
      throw new NotFoundException('Reported content not found');
    }

    try {
      const report = await this.reports.create({
        reporterId: new Types.ObjectId(user.id),
        targetType: dto.targetType,
        targetId: String(targetId),
        reason: dto.reason.trim(),
      });

      return report.toObject();
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw new ConflictException('You have already reported this item');
      }

      throw error;
    }
  }

  async listOpen(query: PaginationQueryDto) {
    const [data, total] = await Promise.all([
      this.reports
        .find({ status: ReportStatus.OPEN })
        .sort({ createdAt: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      this.reports.countDocuments({
        status: ReportStatus.OPEN,
      }),
    ]);

    return paginated(data, total, query.page, query.limit);
  }

  async resolve(admin: AuthUser, id: string, dto: ResolveReportDto) {
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid report id');
    }

    const report = await this.reports.findById(id);

    if (!report || report.status !== ReportStatus.OPEN) {
      throw new NotFoundException('Open report not found');
    }

    if (dto.action === 'dismiss') {
      report.status = ReportStatus.DISMISSED;
      report.resolution = 'dismissed';
      report.resolvedBy = new Types.ObjectId(admin.id);
      report.resolvedAt = new Date();
      await report.save();

      await this.audit.log({
        adminId: admin.id,
        action: AuditAction.REPORT_DISMISSED,
        targetType: AuditTargetType.REPORT,
        targetId: id,
        details: {
          targetType: report.targetType,
          targetId: report.targetId,
        },
      });

      return report.toObject();
    }

    await this.moderateContent(
      admin,
      report.targetType,
      report.targetId,
      dto.action,
    );

    // moderateContent() has closed every open report on this item,
    // this one included.
    const closed = await this.reports.findById(id).lean();
    return closed ?? report.toObject();
  }

  async moderateContent(
    admin: AuthUser,
    type: string,
    id: string,
    action: 'hide' | 'delete',
  ) {
    const targetType = this.parseTargetType(type);

    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid content id');
    }

    const collection = this.connection.collection(COLLECTIONS[targetType]);
    const objectId = new Types.ObjectId(id);

    const target = await collection.findOne({ _id: objectId });

    if (!target) {
      throw new NotFoundException('Content not found');
    }

    if (action === 'hide') {
      const result = await collection.updateOne(
        { _id: objectId },
        { $set: { hidden: true } },
      );

      if (result.matchedCount !== 1) {
        throw new NotFoundException('Content not found');
      }
    } else {
      const result = await collection.deleteOne({
        _id: objectId,
      });

      if (result.deletedCount !== 1) {
        throw new NotFoundException('Content not found');
      }
      await this.afterDelete(targetType, target);
    }

    await this.closeReports(
      admin,
      targetType,
      id,
      action === 'hide' ? 'hidden' : 'deleted',
    );

    await this.audit.log({
      adminId: admin.id,
      action:
        action === 'hide'
          ? AuditAction.CONTENT_HIDDEN
          : AuditAction.CONTENT_DELETED,
      targetType: this.auditTarget(targetType),
      targetId: id,
      details: {
        action,
        hidden: action === 'hide' ? true : undefined,
        authorId: String(
          target.authorId ?? target.userId ?? target.ownerId ?? '',
        ),
      },
    });

    return {
      success: true,
      action,
      targetType,
      targetId: id,
    };
  }

  async hideContent(
    admin: AuthUser,
    type: string,
    id: string,
    hidden: boolean,
  ) {
    const targetType = this.parseTargetType(type);

    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid content id');
    }

    const collection = this.connection.collection(COLLECTIONS[targetType]);
    const objectId = new Types.ObjectId(id);

    const result = await collection.updateOne(
      { _id: objectId },
      { $set: { hidden } },
    );

    if (result.matchedCount !== 1) {
      throw new NotFoundException('Content not found');
    }

    if (hidden) {
      await this.closeReports(admin, targetType, id, 'hidden');
    }

    // Both hiding and unhiding must be recorded.
    await this.audit.log({
      adminId: admin.id,
      action: AuditAction.CONTENT_HIDDEN,
      targetType: this.auditTarget(targetType),
      targetId: id,
      details: { hidden },
    });

    return { success: true, hidden };
  }

  // GEN-10: an admin can read any post, comment, review or itinerary,
  // hidden ones included, to decide on a report.
  async getContent(type: string, id: string) {
    const targetType = this.parseTargetType(type);
    if (!isValidObjectId(id)) {
      throw new BadRequestException('Invalid content id');
    }
    const content = await this.connection
      .collection(COLLECTIONS[targetType])
      .findOne({ _id: new Types.ObjectId(id) });
    if (!content) throw new NotFoundException('Content not found');
    const openReports = await this.reports.countDocuments({
      targetType,
      targetId: id,
      status: ReportStatus.OPEN,
    });
    return { targetType, content, openReports };
  }

  // Hiding or deleting an item settles every open report on it.
  private async closeReports(
    admin: AuthUser,
    targetType: ReportTargetType,
    targetId: string,
    resolution: 'hidden' | 'deleted',
  ) {
    await this.reports.updateMany(
      { targetType, targetId, status: ReportStatus.OPEN },
      {
        $set: {
          status: ReportStatus.RESOLVED,
          resolution,
          resolvedBy: new Types.ObjectId(admin.id),
          resolvedAt: new Date(),
        },
      },
    );
  }

  // What has to change with a deleted item: a comment lowers its post's
  // comment count; a post takes its comments, likes and images with it; a
  // review's hotel gets its average rating recalculated (HTL-23).
  private async afterDelete(
    targetType: ReportTargetType,
    target: Record<string, any>,
  ) {
    if (targetType === ReportTargetType.COMMENT && target.postId) {
      await this.decrementCommentCount(target.postId);
    }
    if (targetType === ReportTargetType.POST) {
      await Promise.all([
        this.connection
          .collection('comments')
          .deleteMany({ postId: target._id }),
        this.connection.collection('likes').deleteMany({ postId: target._id }),
        ...((target.images ?? []) as string[]).map((url) =>
          this.uploads.remove(url),
        ),
      ]);
    }
    if (targetType === ReportTargetType.REVIEW && target.hotelId) {
      await this.recalculateHotelRating(target.hotelId);
    }
  }

  // Average of the hotel's remaining reviews (hidden ones still count, as
  // in review.schema.ts), rounded to one decimal; 0 with no reviews.
  private async recalculateHotelRating(hotelId: Types.ObjectId) {
    const [stats] = await this.connection
      .collection('reviews')
      .aggregate([
        { $match: { hotelId } },
        {
          $group: {
            _id: null,
            average: { $avg: '$rating' },
            count: { $sum: 1 },
          },
        },
      ])
      .toArray();
    await this.connection.collection('hotels').updateOne(
      { _id: hotelId },
      {
        $set: {
          ratingAverage: stats ? Math.round(stats.average * 10) / 10 : 0,
          ratingCount: stats?.count ?? 0,
        },
      },
    );
  }

  private async decrementCommentCount(postId: Types.ObjectId) {
    await this.connection.collection('posts').updateOne(
      {
        _id: postId,
        commentCount: { $gt: 0 },
      },
      {
        $inc: { commentCount: -1 },
      },
    );
  }

  private parseTargetType(type: string): ReportTargetType {
    if (!Object.values(ReportTargetType).includes(type as ReportTargetType)) {
      throw new BadRequestException('Unsupported content type');
    }

    return type as ReportTargetType;
  }

  private auditTarget(type: ReportTargetType): AuditTargetType {
    return {
      post: AuditTargetType.POST,
      comment: AuditTargetType.COMMENT,
      review: AuditTargetType.REVIEW,
      itinerary: AuditTargetType.ITINERARY,
    }[type];
  }

  private async isVisibleToReporter(
    type: ReportTargetType,
    target: Record<string, any>,
    userId: string,
  ) {
    const owner = String(
      target.authorId ?? target.userId ?? target.ownerId ?? '',
    );

    if (target.hidden && owner !== userId) {
      return false;
    }

    if (type === ReportTargetType.POST) {
      return (
        target.status === 'Published' && (!target.hidden || owner === userId)
      );
    }

    if (type === ReportTargetType.ITINERARY) {
      return (
        (target.visibility === 'Public' && !target.hidden) || owner === userId
      );
    }

    if (type === ReportTargetType.COMMENT) {
      if (target.hidden && owner !== userId) {
        return false;
      }

      const parent = await this.connection
        .collection('posts')
        .findOne({ _id: target.postId });

      return (
        !!parent &&
        parent.status === 'Published' &&
        (!parent.hidden || String(parent.authorId) === userId)
      );
    }

    return !target.hidden || owner === userId;
  }
}
