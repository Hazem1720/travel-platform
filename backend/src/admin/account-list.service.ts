import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import {
  buildSort,
  paginated,
  PaginatedResult,
} from '../common/pagination/pagination.helper';
import { User, UserDocument } from '../users/schemas/user.schema';
import { ACCOUNT_SORT_FIELDS, AccountQueryDto } from './dto/account-query.dto';

// Only these fields leave the server. passwordHash and refreshTokenHash are
// also select: false in the schema; listing the fields keeps lockout and
// session details (failedLoginAttempts, sessionVersion, ...) out as well.
export const ACCOUNT_FIELDS = {
  name: 1,
  email: 1,
  role: 1,
  status: 1,
  assignedProviderId: 1,
  createdAt: 1,
} as const;

export type AccountRow = Pick<
  User,
  'name' | 'email' | 'role' | 'status' | 'assignedProviderId'
> & { _id: unknown; createdAt: Date };

export const escapeRegex = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ACC-14: the admin's list of every account. Hazem's suspend and reactivate
// routes (ACC-15, ACC-16) and Memo's password reset (ACC-07a) use the ids
// it returns.
@Injectable()
export class AccountListService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
  ) {}

  async list(q: AccountQueryDto): Promise<PaginatedResult<AccountRow>> {
    const filter: FilterQuery<UserDocument> = {};
    if (q.role) filter.role = q.role;
    if (q.status) filter.status = q.status;
    if (q.search) {
      const re = new RegExp(escapeRegex(q.search), 'i');
      filter.$or = [{ name: re }, { email: re }];
    }
    // _id last, so accounts with the same name or date keep a stable order
    // across pages.
    const sort = {
      ...buildSort(q.sort, ACCOUNT_SORT_FIELDS, 'createdAt:desc'),
      _id: -1 as const,
    };
    const { page, limit } = q;
    const [data, total] = await Promise.all([
      this.users
        .find(filter, ACCOUNT_FIELDS)
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<AccountRow[]>(),
      this.users.countDocuments(filter),
    ]);
    return paginated(data, total, page, limit);
  }
}
