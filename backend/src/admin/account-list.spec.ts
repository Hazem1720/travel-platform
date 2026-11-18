import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AccountStatus, Role } from '../common/enums/role.enum';
import {
  ACCOUNT_FIELDS,
  AccountListService,
  escapeRegex,
} from './account-list.service';
import { AccountQueryDto } from './dto/account-query.dto';

// ACC-14: the admin's account list.
describe('Admin account list (ACC-14)', () => {
  // The query the global ValidationPipe builds, or the fields that fail.
  async function parse(query: Record<string, unknown>) {
    const dto = plainToInstance(AccountQueryDto, query, {
      enableImplicitConversion: false,
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    return { dto, failed: errors.map((e) => e.property) };
  }

  function setup(total = 0) {
    const query = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn(async () => []),
    };
    const model = {
      find: jest.fn(() => query),
      countDocuments: jest.fn(async () => total),
    };
    return {
      service: new AccountListService(model as any),
      model,
      query,
    };
  }

  const q = (over: Partial<AccountQueryDto> = {}) =>
    ({ page: 1, limit: 10, ...over }) as AccountQueryDto;

  describe('query validation', () => {
    it('accepts no filters, and every role and status', async () => {
      expect((await parse({})).failed).toEqual([]);
      for (const role of Object.values(Role)) {
        expect((await parse({ role })).failed).toEqual([]);
      }
      for (const status of Object.values(AccountStatus)) {
        expect((await parse({ status })).failed).toEqual([]);
      }
    });

    it('rejects role=pilot and an unknown status (400 with the field)', async () => {
      expect((await parse({ role: 'pilot' })).failed).toEqual(['role']);
      expect((await parse({ status: 'banned' })).failed).toEqual(['status']);
    });

    it('rejects limit=11 (GEN-05) and a search over 100 characters', async () => {
      expect((await parse({ limit: '11' })).failed).toEqual(['limit']);
      expect((await parse({ search: 'a'.repeat(101) })).failed).toEqual([
        'search',
      ]);
    });

    it('trims the search text', async () => {
      expect((await parse({ search: '  sara ' })).dto.search).toBe('sara');
    });
  });

  describe('list', () => {
    it('returns only the public account fields, newest first, 10 per page', async () => {
      const { service, model, query } = setup(23);
      const page = await service.list(q({ page: 3 }));
      expect(model.find).toHaveBeenCalledWith({}, ACCOUNT_FIELDS);
      expect(Object.keys(ACCOUNT_FIELDS).sort()).toEqual(
        [
          'assignedProviderId',
          'createdAt',
          'email',
          'name',
          'role',
          'status',
        ].sort(),
      );
      expect(query.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
      expect(query.skip).toHaveBeenCalledWith(20);
      expect(query.limit).toHaveBeenCalledWith(10);
      expect(page.meta).toEqual({
        page: 3,
        limit: 10,
        total: 23,
        totalPages: 3,
      });
    });

    it('search=sara matches name or email, case-insensitive', async () => {
      const { service, model } = setup();
      await service.list(q({ search: 'sara' }));
      const filter = (model.find.mock.calls[0] as unknown[])[0] as {
        $or: { name?: RegExp; email?: RegExp }[];
      };
      const [byName, byEmail] = filter.$or;
      expect(byName.name!.test('Sara Ahmed')).toBe(true);
      expect(byEmail.email!.test('SARA@example.com')).toBe(true);
      expect(byName.name!.flags).toContain('i');
    });

    it('treats the search text literally (no regex injection)', async () => {
      expect(escapeRegex('a.b*(c)')).toBe('a\\.b\\*\\(c\\)');
      const { service, model } = setup();
      await service.list(q({ search: '.*' }));
      const filter = (model.find.mock.calls[0] as unknown[])[0] as {
        $or: { name: RegExp }[];
      };
      expect(filter.$or[0].name.test('anything')).toBe(false);
      expect(filter.$or[0].name.test('a.*b')).toBe(true);
    });

    it('role=airline_moderator&status=active applies both filters', async () => {
      const { service, model } = setup();
      await service.list(
        q({ role: Role.AIRLINE_MODERATOR, status: AccountStatus.ACTIVE }),
      );
      expect(model.find).toHaveBeenCalledWith(
        { role: Role.AIRLINE_MODERATOR, status: AccountStatus.ACTIVE },
        ACCOUNT_FIELDS,
      );
    });

    it('sorts by name, email or createdAt only', async () => {
      const { service, query } = setup();
      await service.list(q({ sort: 'name:asc' }));
      expect(query.sort).toHaveBeenCalledWith({ name: 1, _id: -1 });
      await expect(
        service.list(q({ sort: 'passwordHash:asc' })),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
