import { validateEnv } from './env.validation';

describe('validateEnv (IM-6)', () => {
  const valid = {
    MONGODB_URI: 'mongodb://localhost:27017/travel-platform',
    JWT_SECRET: 'x'.repeat(32),
    FRONTEND_URL: 'http://localhost:3001',
  };

  it('accepts a complete environment', () => {
    expect(() =>
      validateEnv({ ...valid, JWT_EXPIRES_IN: '15m' }),
    ).not.toThrow();
  });

  it('treats an empty JWT_EXPIRES_IN as not set', () => {
    expect(() => validateEnv({ ...valid, JWT_EXPIRES_IN: '' })).not.toThrow();
  });

  it.each(['MONGODB_URI', 'JWT_SECRET', 'FRONTEND_URL'])(
    'rejects a missing %s',
    (key) => {
      const env: Record<string, string> = { ...valid };
      delete env[key];
      expect(() => validateEnv(env)).toThrow(new RegExp(key));
    },
  );

  it('rejects a short JWT_SECRET', () => {
    expect(() => validateEnv({ ...valid, JWT_SECRET: 'short' })).toThrow(
      /at least 32 characters/,
    );
  });

  it('rejects a malformed JWT_EXPIRES_IN', () => {
    expect(() => validateEnv({ ...valid, JWT_EXPIRES_IN: 'soon' })).toThrow(
      /JWT_EXPIRES_IN/,
    );
  });

  it('refuses insecure cookies in production', () => {
    expect(() =>
      validateEnv({ ...valid, NODE_ENV: 'production', COOKIE_SECURE: 'false' }),
    ).toThrow(/not allowed in production/);
  });
});
