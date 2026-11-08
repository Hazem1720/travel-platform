import { HttpException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import type { Request, Response } from 'express';
import { AccountStatus, Role } from '../common/enums/role.enum';
import { AuthService } from './auth.service';

const SECRET = 'unit-test-secret-unit-test-secret-1234';

function fakeResponse() {
  const cookies: Record<string, { value: string; options: any }> = {};
  const cleared: string[] = [];
  const res = {
    cookie: jest.fn((name: string, value: string, options: any) => {
      cookies[name] = { value, options };
    }),
    clearCookie: jest.fn((name: string) => cleared.push(name)),
  } as unknown as Response;
  return { res, cookies, cleared };
}

function fakeRequest(cookies: Record<string, unknown> = {}) {
  return { cookies } as unknown as Request;
}

// A stored user document with the Mongoose methods AuthService uses.
function storedUser(overrides: Record<string, unknown> = {}) {
  return {
    _id: '64b000000000000000000001',
    name: 'Sara Ali',
    email: 'sara@example.com',
    passwordHash: bcrypt.hashSync('Passw0rd1', 4),
    role: Role.USER,
    status: AccountStatus.ACTIVE,
    failedLoginAttempts: 0,
    lockUntil: null as Date | null,
    sessionVersion: 0,
    refreshTokenHash: null as string | null,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeService(env: Record<string, string> = {}) {
  const userModel = {
    findOne: jest.fn(),
    findById: jest.fn(),
    findOneAndUpdate: jest.fn(),
    findByIdAndUpdate: jest.fn().mockResolvedValue(undefined),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
  };
  const jwt = new JwtService({ secret: SECRET, signOptions: { expiresIn: '15m' } });
  const config = { get: (key: string) => env[key] } as unknown as ConfigService;
  const service = new AuthService(userModel as any, jwt, config);
  return { service, userModel, jwt };
}

const withSelect = (value: unknown) => ({ select: jest.fn().mockResolvedValue(value) });

describe('AuthService', () => {
  describe('login', () => {
    it('increments the failure counter atomically with $inc (ACC-05)', async () => {
      const { service, userModel } = makeService();
      const user = storedUser();
      userModel.findOne.mockReturnValue(withSelect(user));
      userModel.findOneAndUpdate.mockResolvedValue({ failedLoginAttempts: 1 });

      await expect(
        service.login({ email: user.email, password: 'wrong-pass1' }, fakeResponse().res),
      ).rejects.toThrow('Invalid email or password');

      expect(userModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: user._id },
        { $inc: { failedLoginAttempts: 1 } },
        { new: true },
      );
      // Never a read-modify-save of the counter.
      expect(user.save).not.toHaveBeenCalled();
      expect(userModel.updateOne).not.toHaveBeenCalled();
    });

    it('locks the account for 15 minutes on the 5th failure (ACC-05)', async () => {
      const { service, userModel } = makeService();
      const user = storedUser({ failedLoginAttempts: 4 });
      userModel.findOne.mockReturnValue(withSelect(user));
      userModel.findOneAndUpdate.mockResolvedValue({ failedLoginAttempts: 5 });

      const before = Date.now();
      await expect(
        service.login({ email: user.email, password: 'wrong-pass1' }, fakeResponse().res),
      ).rejects.toThrow(UnauthorizedException);

      const [filter, update] = userModel.updateOne.mock.calls[0];
      expect(filter).toEqual({ _id: user._id, failedLoginAttempts: { $gte: 5 } });
      expect(update.$set.failedLoginAttempts).toBe(0);
      const lockMs = update.$set.lockUntil.getTime() - before;
      expect(lockMs).toBeGreaterThanOrEqual(15 * 60 * 1000 - 50);
      expect(lockMs).toBeLessThanOrEqual(15 * 60 * 1000 + 1000);
    });

    it('rejects a locked account with 423 before checking the password', async () => {
      const { service, userModel } = makeService();
      const user = storedUser({ lockUntil: new Date(Date.now() + 60_000) });
      userModel.findOne.mockReturnValue(withSelect(user));

      const err = await service
        .login({ email: user.email, password: 'Passw0rd1' }, fakeResponse().res)
        .catch((e) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect(err.getStatus()).toBe(423);
      expect(userModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('resets the counter on success and puts sessionVersion in the token', async () => {
      const { service, userModel, jwt } = makeService();
      const user = storedUser({ failedLoginAttempts: 3, sessionVersion: 7 });
      userModel.findOne.mockReturnValue(withSelect(user));
      const { res, cookies } = fakeResponse();

      await service.login({ email: user.email, password: 'Passw0rd1' }, res);

      expect(userModel.updateOne).toHaveBeenCalledWith(
        { _id: user._id },
        { $set: { failedLoginAttempts: 0, lockUntil: null } },
      );
      const payload = jwt.decode(cookies.access_token.value) as any;
      expect(payload).toMatchObject({ sub: user._id, sv: 7 });
      expect(payload.exp - payload.iat).toBe(15 * 60);
    });

    it('compares against a dummy hash when the email is unknown (MI-1)', async () => {
      const { service, userModel } = makeService();
      userModel.findOne.mockReturnValue(withSelect(null));
      const compare = jest.spyOn(bcrypt, 'compare');

      await expect(
        service.login({ email: 'nobody@example.com', password: 'Passw0rd1' }, fakeResponse().res),
      ).rejects.toThrow('Invalid email or password');

      expect(compare).toHaveBeenCalledTimes(1);
      compare.mockRestore();
    });
  });

  describe('cookies (ACC-19)', () => {
    it('are httpOnly, Secure and SameSite by default', async () => {
      const { service, userModel } = makeService();
      userModel.findOne.mockReturnValue(withSelect(storedUser()));
      const { res, cookies } = fakeResponse();

      await service.login({ email: 'sara@example.com', password: 'Passw0rd1' }, res);

      for (const name of ['access_token', 'refresh_token']) {
        expect(cookies[name].options).toMatchObject({
          httpOnly: true,
          secure: true,
          sameSite: 'lax',
        });
      }
    });

    it('drop Secure only when COOKIE_SECURE=false', async () => {
      const { service, userModel } = makeService({ COOKIE_SECURE: 'false' });
      userModel.findOne.mockReturnValue(withSelect(storedUser()));
      const { res, cookies } = fakeResponse();

      await service.login({ email: 'sara@example.com', password: 'Passw0rd1' }, res);
      expect(cookies.access_token.options.secure).toBe(false);
    });
  });

  describe('logout (ACC-06)', () => {
    it('revokes the refresh token and bumps sessionVersion', async () => {
      const { service, userModel } = makeService();
      const { res, cleared } = fakeResponse();

      await service.logout(fakeRequest({ refresh_token: 'abc' }), res);

      expect(userModel.updateOne).toHaveBeenCalledWith(
        { refreshTokenHash: expect.any(String) },
        { $set: { refreshTokenHash: null }, $inc: { sessionVersion: 1 } },
      );
      expect(cleared).toEqual(['access_token', 'refresh_token']);
    });

    it('revokes by access token when there is no refresh cookie', async () => {
      const { service, userModel, jwt } = makeService();
      const access = await jwt.signAsync({ sub: 'user-1', sv: 0 });

      await service.logout(fakeRequest({ access_token: access }), fakeResponse().res);

      expect(userModel.updateOne).toHaveBeenCalledWith(
        { _id: 'user-1' },
        { $set: { refreshTokenHash: null }, $inc: { sessionVersion: 1 } },
      );
    });

    it('ignores non-string cookies instead of crashing (MI-2)', async () => {
      const { service, userModel } = makeService();
      const req = fakeRequest({ refresh_token: { $ne: null }, access_token: { a: 1 } });

      await expect(service.logout(req, fakeResponse().res)).resolves.toEqual({
        message: 'Logged out',
      });
      expect(userModel.updateOne).not.toHaveBeenCalled();
    });
  });

  describe('refresh (ACC-06 idle expiry)', () => {
    it('ends a session idle for more than 30 minutes', async () => {
      const { service, userModel } = makeService();
      const user = storedUser({
        refreshTokenHash: 'h',
        lastActivityAt: new Date(Date.now() - 31 * 60 * 1000),
      });
      userModel.findOne.mockReturnValue(withSelect(user));
      const { res, cleared } = fakeResponse();

      await expect(
        service.refresh(fakeRequest({ refresh_token: 'tok' }), res),
      ).rejects.toThrow('Session expired. Please log in again.');
      expect(user.refreshTokenHash).toBeNull();
      expect(user.save).toHaveBeenCalled();
      expect(cleared).toEqual(['access_token', 'refresh_token']);
    });

    it('rotates the refresh token for an active session', async () => {
      const { service, userModel } = makeService();
      const user = storedUser({ lastActivityAt: new Date(Date.now() - 5 * 60 * 1000) });
      userModel.findOne.mockReturnValue(withSelect(user));
      const { res, cookies } = fakeResponse();

      await service.refresh(fakeRequest({ refresh_token: 'old-token' }), res);
      expect(cookies.refresh_token.value).not.toBe('old-token');
      expect(cookies.access_token.value).toBeTruthy();
    });

    it('treats a missing lastActivityAt as expired', async () => {
      const { service, userModel } = makeService();
      userModel.findOne.mockReturnValue(withSelect(storedUser({ lastActivityAt: null })));
      await expect(
        service.refresh(fakeRequest({ refresh_token: 'tok' }), fakeResponse().res),
      ).rejects.toThrow('Session expired');
    });
  });

  describe('refresh', () => {
    it('answers 401, not 500, for a non-string refresh cookie (MI-2)', async () => {
      const { service, userModel } = makeService();
      await expect(
        service.refresh(fakeRequest({ refresh_token: { $ne: null } }), fakeResponse().res),
      ).rejects.toThrow(UnauthorizedException);
      expect(userModel.findOne).not.toHaveBeenCalled();
    });
  });

  describe('changePassword (ACC-08)', () => {
    it('revokes other sessions and starts a new one for this device', async () => {
      const { service, userModel, jwt } = makeService();
      const user = storedUser({ sessionVersion: 2, refreshTokenHash: 'old' });
      userModel.findById.mockReturnValue(withSelect(user));
      const { res, cookies } = fakeResponse();

      await service.changePassword(
        user._id,
        { currentPassword: 'Passw0rd1', newPassword: 'NewPassw0rd2' },
        res,
      );

      expect(user.sessionVersion).toBe(3);
      expect(user.save).toHaveBeenCalled();
      expect((jwt.decode(cookies.access_token.value) as any).sv).toBe(3);
    });
  });
});
