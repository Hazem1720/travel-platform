import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { RolesGuard } from './roles.guard';

function contextWith(meta: Record<string, unknown>, user?: { role: Role }) {
  const handler = () => undefined;
  for (const [k, v] of Object.entries(meta))
    Reflect.defineMetadata(k, v, handler);
  return {
    getHandler: () => handler,
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  it('lets any logged-in user through when no @Roles() is set', () => {
    expect(guard.canActivate(contextWith({}, { role: Role.USER }))).toBe(true);
  });

  it('allows a listed role', () => {
    const ctx = contextWith(
      { [ROLES_KEY]: [Role.ADMIN] },
      { role: Role.ADMIN },
    );
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('rejects a role that is not listed', () => {
    const ctx = contextWith({ [ROLES_KEY]: [Role.ADMIN] }, { role: Role.USER });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('rejects when there is no user', () => {
    const ctx = contextWith({ [ROLES_KEY]: [Role.ADMIN] });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('skips @Public() routes', () => {
    expect(guard.canActivate(contextWith({ [IS_PUBLIC_KEY]: true }))).toBe(
      true,
    );
  });
});
