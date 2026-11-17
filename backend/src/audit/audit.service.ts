import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, isValidObjectId, Model, Types } from 'mongoose';
import {
  buildSort,
  paginated,
  PaginatedResult,
} from '../common/pagination/pagination.helper';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';
import {
  AuditAction,
  AuditLog,
  AuditLogDocument,
  AuditTargetType,
} from './schemas/audit-log.schema';

export interface AuditEntry {
  adminId: Types.ObjectId | string;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: Types.ObjectId | string;
  details?: Record<string, unknown>;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// GEN-07: audit log of admin actions. Append-only: there is a log() and a
// list(), and no update or delete method.
@Injectable()
export class AuditService {
  constructor(
    @InjectModel(AuditLog.name)
    private readonly logs: Model<AuditLogDocument>,
  ) {}

  // For admin actions, after the action succeeded:
  //   await this.audit.log({ adminId: admin.id,
  //     action: AuditAction.ACCOUNT_SUSPENDED,
  //     targetType: AuditTargetType.USER, targetId: user._id,
  //     details: { reason } });
  async log(entry: AuditEntry): Promise<AuditLog> {
    if (!isValidObjectId(entry.adminId)) {
      throw new Error(`AuditService.log: invalid adminId ${entry.adminId}`);
    }
    const doc = await this.logs.create({
      adminId: new Types.ObjectId(String(entry.adminId)),
      action: entry.action,
      targetType: entry.targetType,
      targetId: String(entry.targetId),
      details: entry.details ?? null,
    });
    return doc.toObject();
  }

  // Newest first, filtered by action, admin and date range, 10 per page.
  async list(q: AuditLogQueryDto): Promise<PaginatedResult<AuditLog>> {
    const filter: FilterQuery<AuditLogDocument> = {};
    if (q.action) filter.action = q.action;
    if (q.adminId) filter.adminId = new Types.ObjectId(q.adminId);

    const range = dateRange(q.from, q.to);
    if (range) filter.createdAt = range;

    const { page, limit } = q;
    const [data, total] = await Promise.all([
      this.logs
        .find(filter)
        .sort(buildSort(q.sort, [], 'createdAt:desc'))
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<AuditLog[]>(),
      this.logs.countDocuments(filter),
    ]);
    return paginated(data, total, page, limit);
  }
}

// from and to are inclusive. A date without a time ("2026-11-20") as `to`
// covers that whole day.
export function dateRange(
  from?: string,
  to?: string,
): { $gte?: Date; $lt?: Date; $lte?: Date } | null {
  if (!from && !to) return null;
  const range: { $gte?: Date; $lt?: Date; $lte?: Date } = {};
  if (from) range.$gte = new Date(from);
  if (to) {
    if (DATE_ONLY.test(to)) {
      range.$lt = new Date(new Date(to).getTime() + ONE_DAY_MS);
    } else {
      range.$lte = new Date(to);
    }
  }
  // The first moment after the range, to compare with `from`.
  const after = range.$lt ?? (range.$lte && range.$lte.getTime() + 1);
  if (range.$gte && after && range.$gte.getTime() >= after.valueOf()) {
    throw new BadRequestException('"from" must not be after "to"');
  }
  return range;
}
