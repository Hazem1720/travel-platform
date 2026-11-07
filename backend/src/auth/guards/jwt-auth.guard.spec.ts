import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AccountStatus, Role } from '../../common/enums/role.enum';
import { JwtAuthGuard } from './jwt-auth.guard';

const SECRET = 'unit-test-secret-unit-test-secret-1234';

function setup(user: Record<string, unknown> | null) {
  const jwt = new JwtService({ secret: SECRET, signOptions: { expiresIn: '15m' } });
  const userModel = {
    findById: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(user) }),
    updateOne: jest.fn().mockResolvedValue(undefined),
  };
  const guard = new JwtAuthGuard(jwt, new Reflector(), userModel as any);
  const contextFor = (cookies: Record<string, unknown>) => {
    const req: any = { cookies };
    return {
      req,
      ctx: {
        switchToHttp: () => ({ getRequest: () => req }),
        getHandler: () => function handler() {},
        getClass: () => class Controller {},
      } as unknown as ExecutionContext,
    };
  };
  return { guard, jwt, userModel, contextFor };
}

const activeUser = (overrides: Record<string, unknown> = {}) => ({
  _id: 'user-1',
  role: Role.USER,
  status: AccountStatus.ACTIVE,
  sessionVersion: 0,
  lastActivityAt: new Date(),
  assignedProviderId: null,
  ...overrides,
});

describe('JwtAuthGuard', () => {
  it('accepts a token whose sessionVersion matches', async () => {
    const { guard, jwt, contextFor } = setup(activeUser({ sessionVersion: 4 }));
    const token = await jwt.signAsync({ sub: 'user-1', sv: 4 });
    const { ctx, req } = contextFor({ access_token: token });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.user).toEqual({ id: 'user-1', role: Role.USER, assignedProviderId: null });
  });

  it('rejects a token issued before logout or a password change (ACC-06)', async () => {
    const { guard, jwt, contextFor } = setup(activeUser({ sessionVersion: 5 }));
    const token = await jwt.signAsync({ sub: 'user-1', sv: 4 });

    await expect(guard.canActivate(contextFor({ access_token: token }).ctx)).rejects.toThrow(
      'Session expired',
    );
  });

  it('rejects a token without a sessionVersion', async () => {
    const { guard, jwt, contextFor } = setup(activeUser());
    const token = await jwt.signAsync({ sub: 'user-1' });

    await expect(guard.canActivate(contextFor({ access_token: token }).ctx)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('answers 401, not 500, for a non-string cookie (MI-2)', async () => {
    const { guard, contextFor, userModel } = setup(activeUser());
    await expect(
      guard.canActivate(contextFor({ access_token: { $ne: null } }).ctx),
    ).rejects.toThrow('Authentication required');
    expect(userModel.findById).not.toHaveBeenCalled();
  });
});
