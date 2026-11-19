import { MongoMemoryServer } from 'mongodb-memory-server';
import { makeRunDir } from './run-dir';
import { assertSafeTestUri, guardOptionsFromEnv } from './uri-guard';

// Jest globalSetup: runs once, in the parent process, before any test file.
// Jest starts its workers afterwards, and they inherit process.env, so the
// URI and the run folder set here reach every test file.
//
// MongoDB version: pinned to the Atlas cluster's major version. Override
// with MONGOMS_VERSION.
const DEFAULT_MONGO_VERSION = '7.0.14';

export default async function globalSetup(): Promise<void> {
  if (!process.env.E2E_RUN_DIR) {
    // A plain `npm run test:e2e` (no coverage check): our own folder, which
    // global-teardown.ts deletes. test:e2e:full creates and deletes its own.
    process.env.E2E_RUN_DIR = makeRunDir();
    process.env.E2E_RUN_DIR_OWNED = '1';
  }

  if (process.env.E2E_MONGODB_URI) {
    // A database chosen by hand (for example a throwaway Atlas database):
    // checked before anything connects to it.
    assertSafeTestUri(process.env.E2E_MONGODB_URI, guardOptionsFromEnv());
    return;
  }

  const server = await MongoMemoryServer.create({
    binary: {
      version: process.env.MONGOMS_VERSION || DEFAULT_MONGO_VERSION,
    },
  });
  (globalThis as any).__E2E_MONGO__ = server;
  process.env.E2E_MONGODB_URI = server.getUri();
}
