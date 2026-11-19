import { readFileSync } from 'fs';
import { join } from 'path';

// The e2e tests write and drop databases, so they must never reach the
// shared team database. Called by global-setup.ts (before anything connects)
// and by setup-e2e-env.ts in every test worker.

export interface UriGuardOptions {
  // E2E_ALLOW_ATLAS=1: a separate, throwaway cluster (for example on Atlas)
  // was chosen on purpose. Never the backend/.env cluster.
  allowAtlas: boolean;
  // MONGODB_URI from backend/.env (the shared cluster), if there is one.
  sharedUri: string | null;
}

// An allow-list: without E2E_ALLOW_ATLAS=1, every host in the URI must be
// one of these (the in-memory MongoDB listens on 127.0.0.1). Anything else,
// in any form (mongodb+srv://, mongodb://host1,host2,..., an IP), needs the
// flag.
export const LOCAL_HOSTS: readonly string[] = ['127.0.0.1', 'localhost'];

// Throws if `uri` may not be used, in this order:
//   1. missing or not a MongoDB URI;
//   2. any host of the backend/.env cluster, whatever the database name:
//      refused always, even with E2E_ALLOW_ATLAS=1 (see sameCluster);
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
  if (sharedUri && sameCluster(uri, sharedUri)) {
    throw new Error(
      'E2E URI guard: this is the shared cluster from backend/.env ' +
        '(MONGODB_URI), whatever the database name. Tests never run on it, ' +
        'even with E2E_ALLOW_ATLAS=1, which is only for a separate throwaway cluster.',
    );
  }
  if (!allowAtlas && !isLocal(target)) {
    throw new Error(
      `E2E URI guard: refusing a database that is not on ${LOCAL_HOSTS.join(' or ')}. ` +
        'For a separate, throwaway database elsewhere (for example on Atlas), ' +
        'set E2E_ALLOW_ATLAS=1 (never the backend/.env cluster).',
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

// "host" and "host:27017" are the same server (27017 is the default port),
// and so are "localhost" and "127.0.0.1".
function hostKey(hostAndPort: string): string {
  const name = hostname(hostAndPort);
  const port = hostAndPort.slice(name.length).replace(/^:/, '') || '27017';
  return `${name === 'localhost' ? '127.0.0.1' : name}:${port}`;
}

// Atlas names every host of a cluster under one domain, for example
// cluster0.abc12.mongodb.net (mongodb+srv) and
// ac-x-shard-00-00.abc12.mongodb.net (standard form). The last three labels
// ("abc12.mongodb.net") link the two forms; null for any other host.
function atlasDomain(hostAndPort: string): string | null {
  const name = hostname(hostAndPort);
  if (!/\.mongodb\.net$/.test(name)) return null;
  return name.split('.').slice(-3).join('.');
}

// True if `a` reaches any server of the cluster in `b`, whatever the
// database name, credentials or options:
//   - any host:port of one is a host:port of the other; or
//   - both are on Atlas under the same domain, which also catches the
//     mongodb+srv and standard forms of the same cluster.
export function sameCluster(a: string, b: string): boolean {
  const pa = parseUri(a);
  const pb = parseUri(b);
  if (!pa || !pb) return false;
  const keysB = new Set(pb.hostList.map(hostKey));
  if (pa.hostList.some((h) => keysB.has(hostKey(h)))) return true;
  const domainsB = new Set(
    pb.hostList.map(atlasDomain).filter((d): d is string => !!d),
  );
  return pa.hostList.some((h) => {
    const d = atlasDomain(h);
    return !!d && domainsB.has(d);
  });
}

// Same cluster and same database name. A URI without a database name uses
// "test", as the MongoDB driver does.
export function sameDatabase(a: string, b: string): boolean {
  const pa = parseUri(a);
  const pb = parseUri(b);
  return !!pa && !!pb && sameCluster(a, b) && pa.db === pb.db;
}

interface ParsedUri {
  srv: boolean;
  // Lower-cased "host" or "host:port" entries.
  hostList: string[];
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
