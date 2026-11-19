import { readFileSync } from 'fs';
import { join } from 'path';

// The e2e tests write and drop databases, so they must never reach the
// shared team database. Called by global-setup.ts (before anything connects)
// and by setup-e2e-env.ts in every test worker.

export interface UriGuardOptions {
  // E2E_ALLOW_ATLAS=1: a throwaway Atlas database was chosen on purpose.
  allowAtlas: boolean;
  // MONGODB_URI from backend/.env (the shared database), if there is one.
  sharedUri: string | null;
}

// Throws if `uri` may not be used. The message never contains the URI,
// because it can hold a password.
export function assertSafeTestUri(
  uri: string | undefined,
  { allowAtlas, sharedUri }: UriGuardOptions,
): void {
  if (!uri) {
    throw new Error(
      'E2E URI guard: no test database URI. Run through npm run test:e2e or ' +
        'test:e2e:full (they start an in-memory MongoDB), or set E2E_MONGODB_URI.',
    );
  }
  if (!/^mongodb(\+srv)?:\/\//.test(uri)) {
    throw new Error('E2E URI guard: the URI must start with mongodb://');
  }
  if (uri.startsWith('mongodb+srv://') && !allowAtlas) {
    throw new Error(
      'E2E URI guard: refusing a mongodb+srv (Atlas) URI. Use a separate, ' +
        'throwaway Atlas database and set E2E_ALLOW_ATLAS=1 to allow it.',
    );
  }
  if (sharedUri && sameDatabase(uri, sharedUri)) {
    throw new Error(
      'E2E URI guard: this is the shared database from backend/.env ' +
        '(MONGODB_URI). Tests never run against it.',
    );
  }
}

// Same host(s) and same database name. A URI without a database name uses
// "test", as the MongoDB driver does.
export function sameDatabase(a: string, b: string): boolean {
  const pa = parse(a);
  const pb = parse(b);
  return !!pa && !!pb && pa.hosts === pb.hosts && pa.db === pb.db;
}

function parse(uri: string): { hosts: string; db: string } | null {
  const m = /^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)(?:\/([^?]*))?/.exec(
    uri.trim(),
  );
  if (!m) return null;
  const hosts = m[1].toLowerCase().split(',').sort().join(',');
  return { hosts, db: decodeURIComponent(m[2] || '') || 'test' };
}

// MONGODB_URI from backend/.env, read directly so that a test never needs
// the file to be loaded into process.env.
export function sharedUriFromDotEnv(
  path = join(__dirname, '..', '..', '.env'),
): string | null {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*MONGODB_URI\s*=\s*(.*?)\s*$/.exec(line);
    if (m) return m[1].replace(/^(['"])(.*)\1$/, '$2') || null;
  }
  return null;
}

export function guardOptionsFromEnv(): UriGuardOptions {
  return {
    allowAtlas: process.env.E2E_ALLOW_ATLAS === '1',
    sharedUri: sharedUriFromDotEnv(),
  };
}
