import { RequestMethod, Type } from '@nestjs/common';
import {
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import * as bcrypt from 'bcrypt';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { getMetadataStorage } from 'class-validator';
import { AppModule } from '../app.module';
import { UserSchema } from '../users/schemas/user.schema';
import { createValidationPipe } from './pipes/validation.pipe';

// GEN-13: "All validation, business rules and authorisation shall be enforced
// by the backend regardless of frontend checks, and passwords shall be stored
// only as salted hashes." These checks run over the whole application, so a
// new route that skips validation fails CI. Authorisation on every route is
// checked in auth/route-guards.spec.ts; ownership (ACC-11) and provider
// (assertOwnsProvider) checks in each module's tests.

function controllersOf(root: unknown): Type[] {
  const seen = new Set<unknown>();
  const out: Type[] = [];
  const visit = (mod: any) => {
    if (!mod || seen.has(mod)) return;
    seen.add(mod);
    const cls = typeof mod === 'function' ? mod : mod.module;
    const meta = (key: string) => [
      ...(cls ? (Reflect.getMetadata(key, cls) ?? []) : []),
      ...(typeof mod === 'object' ? (mod[key] ?? []) : []),
    ];
    out.push(...meta(MODULE_METADATA.CONTROLLERS));
    meta(MODULE_METADATA.IMPORTS).forEach(visit);
  };
  visit(root);
  return [...new Set(out)];
}

interface Input {
  route: string;
  source: 'body' | 'query';
  type: unknown;
  field?: string;
}

// Every @Body() and @Query() parameter of every route, with its declared type.
function inputs(): Input[] {
  const found: Input[] = [];
  for (const ctrl of controllersOf(AppModule)) {
    const proto = ctrl.prototype;
    for (const name of Object.getOwnPropertyNames(proto)) {
      const handler = proto[name];
      if (name === 'constructor' || typeof handler !== 'function') continue;
      const verb = Reflect.getMetadata(METHOD_METADATA, handler);
      if (verb === undefined) continue;
      const route = `${RequestMethod[verb as RequestMethod]} ${
        Reflect.getMetadata(PATH_METADATA, ctrl) ?? ''
      }/${Reflect.getMetadata(PATH_METADATA, handler) ?? ''} (${ctrl.name}.${name})`;
      const args: Record<string, { index: number; data?: string }> =
        Reflect.getMetadata(ROUTE_ARGS_METADATA, ctrl, name) ?? {};
      const types: unknown[] =
        Reflect.getMetadata('design:paramtypes', proto, name) ?? [];
      for (const [key, arg] of Object.entries(args)) {
        const kind = Number(key.split(':')[0]);
        if (kind !== RouteParamtypes.BODY && kind !== RouteParamtypes.QUERY) {
          continue;
        }
        found.push({
          route,
          source: kind === RouteParamtypes.BODY ? 'body' : 'query',
          type: types[arg.index],
          field: arg.data,
        });
      }
    }
  }
  return found;
}

const hasRules = (type: unknown) =>
  typeof type === 'function' &&
  getMetadataStorage().getTargetValidationMetadatas(
    type as new () => object,
    '',
    true,
    false,
  ).length > 0;

describe('GEN-13: the backend enforces validation and stores only salted hashes', () => {
  const all = inputs();

  it('finds the request bodies and queries of the application', () => {
    expect(all.filter((i) => i.source === 'body').length).toBeGreaterThan(30);
    expect(all.filter((i) => i.source === 'query').length).toBeGreaterThan(10);
  });

  it('validates every request body and query with a DTO class', () => {
    const unchecked = all
      .filter((i) => i.field !== undefined || !hasRules(i.type))
      .map((i) => `${i.source} of ${i.route}`);
    expect(unchecked).toEqual([]);
  });

  it('rejects unknown fields and converts types before the handler runs', async () => {
    const pipe = createValidationPipe();
    expect((pipe as any).validatorOptions).toMatchObject({
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect((pipe as any).isTransformEnabled).toBe(true);

    const { RegisterDto } = await import('../auth/dto/register.dto');
    await expect(
      pipe.transform(
        {
          name: 'A',
          email: 'a@b.co',
          password: 'Passw0rd1',
          acceptTerms: true,
          role: 'admin',
        },
        { type: 'body', metatype: RegisterDto },
      ),
    ).rejects.toMatchObject({
      response: {
        message: 'Validation failed',
        details: { role: expect.any(Array) },
      },
    });
  });

  it('never returns password or refresh-token hashes in queries', () => {
    expect(UserSchema.path('passwordHash').options.select).toBe(false);
    expect(UserSchema.path('refreshTokenHash').options.select).toBe(false);
    expect(UserSchema.path('password')).toBeUndefined();
  });

  it('writes a password only as a bcrypt hash, everywhere in the code', () => {
    const root = join(__dirname, '..');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const path = join(dir, f);
        if (statSync(path).isDirectory()) walk(path);
        else if (f.endsWith('.ts') && !f.endsWith('.spec.ts')) files.push(path);
      }
    };
    walk(root);

    const problems: string[] = [];
    let writes = 0;
    for (const file of files) {
      if (file.endsWith(join('users', 'schemas', 'user.schema.ts'))) continue;
      const lines = readFileSync(file, 'utf8').split('\n');
      const hashedLocal = lines.some((l) =>
        /const passwordHash = await bcrypt\.hash\(/.test(l),
      );
      lines.forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, '');
        const where = `${relative(root, file)}:${i + 1}`;
        const assigned = code.match(/passwordHash\s*(?::|=(?!=))\s*(.+)$/);
        if (assigned) {
          writes++;
          if (!/^await bcrypt\.hash\(/.test(assigned[1].trim())) {
            problems.push(where);
          }
        } else if (/^\s*passwordHash,\s*$/.test(code)) {
          writes++;
          if (!hashedLocal) problems.push(where);
        }
      });
    }
    expect(writes).toBeGreaterThanOrEqual(5);
    expect(problems).toEqual([]);
  });

  it('hashes with bcrypt, a fresh salt every time', async () => {
    const a = await bcrypt.hash('Passw0rd1', 10);
    const b = await bcrypt.hash('Passw0rd1', 10);
    expect(a).toMatch(/^\$2[aby]\$10\$/);
    expect(a).not.toBe(b);
    expect(await bcrypt.compare('Passw0rd1', a)).toBe(true);
  });
});
