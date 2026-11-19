import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { Types } from 'mongoose';
import { REQUIRE_VERIFIED_EMAIL_KEY } from '../common/decorators/verified-email.decorator';
import { AccountStatus, Role } from '../common/enums/role.enum';
import {
  AuthService,
  FORGOT_PASSWORD_MESSAGE,
  INVALID_RESET_LINK,
} from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const tokenFrom = (link: string) => link.split('token=')[1];

// An in-memory users collection with the queries AuthService sends.
function memoryUsers() {
  const docs: any[] = [];
  const matches = (d: any, f: any) =>
    Object.entries(f).every(([k, v]: [string, any]) => {
      if (v && typeof v === 'object' && '$gt' in v) {
        return d[k] instanceof Date && d[k] > v.$gt;
      }
      if (v && typeof v === 'object' && '$ne' in v) return d[k] !== v.$ne;
      return String(d[k]) === String(v);
    });
  const apply = (d: any, u: any) => {
    Object.assign(d, u.$set ?? {});
    for (const [k, n] of Object.entries(u.$inc ?? {})) {
      d[k] = (d[k] ?? 0) + (n as number);
    }
  };
  return {
    docs,
    exists: jest.fn(async (f: any) => docs.find((d) => matches(d, f)) ?? null),
    create: jest.fn(async (d: any) => {
      const doc = {
        _id: new Types.ObjectId(),
        status: AccountStatus.ACTIVE,
        ...d,
      };
      docs.push(doc);
      return doc;
    }),
    findOne: jest.fn((f: any) => ({
      lean: async () => docs.find((d) => matches(d, f)) ?? null,
    })),
    findById: jest.fn(
      async (id: any) => docs.find((d) => String(d._id) === String(id)) ?? null,
    ),
    updateOne: jest.fn(async (f: any, u: any) => {
      const d = docs.find((x) => matches(x, f));
      if (d) apply(d, u);
      return { modifiedCount: d ? 1 : 0 };
    }),
    findOneAndUpdate: jest.fn(async (f: any, u: any) => {
      const d = docs.find((x) => matches(x, f));
      if (!d) return null;
      apply(d, u);
      return d;
    }),
  };
}

function setup(emailOn = true) {
  const users = memoryUsers();
  const sent: { kind: string; to: string; link: string }[] = [];
  const email = {
    enabled: emailOn,
    sendEmailVerification: jest.fn(
      async (to: string, _n: string, link: string) => {
        sent.push({ kind: 'verify', to, link });
        return null;
      },
    ),
    sendPasswordReset: jest.fn(async (to: string, _n: string, link: string) => {
      sent.push({ kind: 'reset', to, link });
      return null;
    }),
  };
  const env: Record<string, string> = {
    APP_URL: 'http://api.test',
    FRONTEND_URL: 'http://web.test/',
  };
  const config = { get: (k: string) => env[k] } as unknown as ConfigService;
  const service = new AuthService(
    users as any,
    new JwtService({ secret: 'x'.repeat(40) }),
    config,
    // ACC-12's booking readers; not used by these tests.
    { hasUpcomingConfirmed: async () => false } as any,
    { hasUpcomingConfirmed: async () => false } as any,
    email as any,
  );
  return { service, users, sent, email };
}

const register = (service: AuthService, email = 'sara@example.com') =>
  service.register({
    name: 'Sara',
    email,
    password: 'Passw0rd1',
    acceptTerms: true,
  } as any);

describe('ACC-02: email verification', () => {
  it('a new account is unverified and gets a single-use link by email', async () => {
    const { service, users, sent } = setup();
    const profile = await register(service);
    expect(profile.emailVerified).toBe(false);
    expect(sent).toEqual([
      expect.objectContaining({ kind: 'verify', to: 'sara@example.com' }),
    ]);
    expect(sent[0].link).toMatch(
      /^http:\/\/api\.test\/api\/auth\/verify-email\?token=[0-9a-f]{64}$/,
    );
    const doc = users.docs[0];
    expect(doc.emailVerificationTokenHash).toBe(sha(tokenFrom(sent[0].link)));
    expect(doc.emailVerificationTokenHash).not.toBe(tokenFrom(sent[0].link));

    await expect(service.verifyEmail(tokenFrom(sent[0].link))).resolves.toEqual(
      {
        message: 'Your email address is verified. You can now book.',
      },
    );
    expect(doc.emailVerified).toBe(true);
    await expect(
      service.verifyEmail(tokenFrom(sent[0].link)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('an expired link is 400; a new link replaces the old one', async () => {
    const { service, users, sent } = setup();
    const p = await register(service);
    users.docs[0].emailVerificationExpiresAt = new Date(Date.now() - 1000);
    await expect(service.verifyEmail(tokenFrom(sent[0].link))).rejects.toThrow(
      'invalid or has expired',
    );
    await service.resendVerification(p.id);
    await expect(
      service.verifyEmail(tokenFrom(sent[0].link)),
    ).rejects.toBeInstanceOf(BadRequestException);
    await service.verifyEmail(tokenFrom(sent[1].link));
    await expect(service.resendVerification(p.id)).rejects.toThrow(
      'already verified',
    );
  });

  it('with email off (no SMTP), a new account starts verified', async () => {
    const { service, sent } = setup(false);
    expect((await register(service)).emailVerified).toBe(true);
    expect(sent).toEqual([]);
  });

  it('booking routes answer 403 until the email is verified', async () => {
    const reflector = {
      getAllAndOverride: jest.fn((key: string) =>
        key === REQUIRE_VERIFIED_EMAIL_KEY ? true : false,
      ),
    } as unknown as Reflector;
    const jwt = new JwtService({ secret: 'x'.repeat(40) });
    const user: any = {
      _id: new Types.ObjectId(),
      role: Role.USER,
      status: AccountStatus.ACTIVE,
      sessionVersion: 0,
      lastActivityAt: new Date(),
      emailVerified: false,
    };
    const users = {
      findById: () => ({ lean: async () => user }),
      updateOne: jest.fn(),
    };
    const guard = new JwtAuthGuard(jwt, reflector, users as any);
    const token = await jwt.signAsync({ sub: String(user._id), sv: 0 });
    const ctx: any = {
      getHandler: () => null,
      getClass: () => null,
      switchToHttp: () => ({
        getRequest: () => ({ cookies: { access_token: token } }),
      }),
    };
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    user.emailVerified = true;
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    delete user.emailVerified; // accounts from before ACC-02
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});

describe('ACC-07: password reset by email', () => {
  it('answers the same for an unknown and a known email', async () => {
    const { service, sent } = setup();
    await register(service);
    sent.length = 0;
    const known = await service.forgotPassword('SARA@example.com');
    const unknown = await service.forgotPassword('nobody@example.com');
    expect(known).toEqual({ message: FORGOT_PASSWORD_MESSAGE });
    expect(unknown).toEqual(known);
    expect(sent).toHaveLength(1);
    expect(sent[0].link).toMatch(
      /^http:\/\/web\.test\/reset-password\?token=[0-9a-f]{64}$/,
    );
  });

  it('resets once, signs out every session and clears a lockout', async () => {
    const { service, users, sent } = setup();
    await register(service);
    const doc = users.docs[0];
    Object.assign(doc, {
      sessionVersion: 3,
      failedLoginAttempts: 5,
      lockUntil: new Date(Date.now() + 60_000),
      refreshTokenHash: 'r',
    });
    await service.forgotPassword('sara@example.com');
    const token = tokenFrom(sent[sent.length - 1].link);
    await service.resetPassword({ token, newPassword: 'NewPassw0rd1' });
    expect(await bcrypt.compare('NewPassw0rd1', doc.passwordHash)).toBe(true);
    expect(doc).toMatchObject({
      sessionVersion: 4,
      failedLoginAttempts: 0,
      lockUntil: null,
      refreshTokenHash: null,
      passwordResetTokenHash: null,
    });
    await expect(
      service.resetPassword({ token, newPassword: 'Another1x' }),
    ).rejects.toThrow(INVALID_RESET_LINK);
  });

  it('a link older than 30 minutes is 400', async () => {
    const { service, users, sent } = setup();
    await register(service);
    await service.forgotPassword('sara@example.com');
    expect(
      users.docs[0].passwordResetExpiresAt.getTime() - Date.now(),
    ).toBeLessThanOrEqual(30 * 60_000);
    users.docs[0].passwordResetExpiresAt = new Date(Date.now() - 60_000);
    await expect(
      service.resetPassword({
        token: tokenFrom(sent[sent.length - 1].link),
        newPassword: 'NewPassw0rd1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('an older link stops working after a newer request', async () => {
    const { service, sent } = setup();
    await register(service);
    await service.forgotPassword('sara@example.com');
    const older = tokenFrom(sent[sent.length - 1].link);
    await service.forgotPassword('sara@example.com');
    const newer = tokenFrom(sent[sent.length - 1].link);
    await expect(
      service.resetPassword({ token: older, newPassword: 'NewPassw0rd1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.resetPassword({ token: newer, newPassword: 'NewPassw0rd1' }),
    ).resolves.toBeDefined();
  });

  it('sends nothing for a deactivated account', async () => {
    const { service, users, sent } = setup();
    await register(service);
    users.docs[0].status = AccountStatus.DEACTIVATED;
    sent.length = 0;
    await expect(service.forgotPassword('sara@example.com')).resolves.toEqual({
      message: FORGOT_PASSWORD_MESSAGE,
    });
    expect(sent).toEqual([]);
  });
});
