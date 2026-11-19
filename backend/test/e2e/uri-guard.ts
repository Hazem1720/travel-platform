import { readFileSync } from 'fs';
import { join } from 'path';

// The e2e tests write and drop databases, so they must never reach the
// shared team database. Called by global-setup.ts (before anything connects)
// and by setup-e2e-env.ts in every test worker.

export interface UriGuardOptions {
  // E2E_ALLOW_ATLAS=1: a database on another machine (for example a
  // throwaway Atlas database) was chosen on purpose.
  allowAtlas: boolean;
  // MONGODB_URI from backend/.env (the shared database), if there is one.
  sharedUri: string | null;
}

// An allow-list: without E2E_ALLOW_ATLAS=1, every host in the URI must be
// one of these (the in-memory MongoDB listens on 127.0.0.1). Anything else,
// in any form (mongodb+srv://, mongodb://host1,host2,..., an IP), needs the
// flag.
export const LOCAL_HOSTS: readonly string[] = ['127.0.0.1', 'localhost'];

// Throws if `uri` may not be used, in this order:
//   1. missing or not a MongoDB URI;
//   2. the backend/.env database (same hosts and database name): refused
//      always, even with E2E_ALLOW_ATLAS=1;
//   3. any host not in LOCAL_HOSTS, unless E2E_ALLOW_ATLAS=1.
// The message never contains the URI, because it can hold a password.
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
  const target = parseUri(uri);
  if (!target) {
    throw new Error('E2E URI guard: not a mongodb:// or mongodb+srv:// URI');
  }
  if (sharedUri && sameDatabase(uri, sharedUri)) {
    throw new Error(
      'E2E URI guard: this is the shared database from backend/.env ' +
        '(MONGODB_URI). Tests never run against it, even with E2E_ALLOW_ATLAS=1.',
    );
  }
  if (!allowAtlas && !isLocal(target)) {
    throw new Error(
      `E2E URI guard: refusing a database that is not on ${LOCAL_HOSTS.join(' or ')}. ` +
        'For a separate, throwaway database elsewhere (for example on Atlas), ' +
        'set E2E_ALLOW_ATLAS=1.',
    );
  }
}

// True if every host is in LOCAL_HOSTS. A mongodb+srv:// name is a DNS
// record for other hosts, so it is never local.
function isLocal(target: ParsedUri): boolean {
  return (
    !target.srv &&
    target.hostList.every((h) => LOCAL_HOSTS.includes(hostname(h)))
  );
}

// "127.0.0.1:27017" -> "127.0.0.1"; "[::1]:27017" -> "[::1]".
function hostname(hostAndPort: string): string {
  return hostAndPort.startsWith('[')
    ? hostAndPort.slice(0, hostAndPort.indexOf(']') + 1)
    : hostAndPort.replace(/:\d+$/, '');
}

// Same host(s) and same database name. A URI without a database name uses
// "test", as the MongoDB driver does.
export function sameDatabase(a: string, b: string): boolean {
  const pa = parseUri(a);
  const pb = parseUri(b);
  return !!pa && !!pb && pa.hosts === pb.hosts && pa.db === pb.db;
}

interface ParsedUri {
  srv: boolean;
  hostList: string[];
  // Sorted and lower-cased, for comparing two URIs.
  hosts: string;
  db: string;
}

function parseUri(uri: string): ParsedUri | null {
  const m = /^mongodb(\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)(?:\/([^?]*))?/.exec(
    uri.trim(),
  );
  if (!m) return null;
  const hostList = m[2].toLowerCase().split(',').filter(Boolean);
  if (!hostList.length) return null;
  return {
    srv: !!m[1],
    hostList,
    hosts: [...hostList].sort().join(','),
    db: decodeURIComponent(m[3] || '') || 'test',
  };
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
