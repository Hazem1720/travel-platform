import { rmSync } from 'fs';
import type { MongoMemoryServer } from 'mongodb-memory-server';

// Jest globalTeardown: stops the in-memory MongoDB. It deletes the run
// folder only if global-setup.ts created it; the folder of a
// test:e2e:full run belongs to run.ts, which deletes it after the coverage
// check has read it.
export default async function globalTeardown(): Promise<void> {
  const server = (globalThis as any).__E2E_MONGO__ as
    | MongoMemoryServer
    | undefined;
  await server?.stop();

  if (process.env.E2E_RUN_DIR_OWNED === '1' && process.env.E2E_RUN_DIR) {
    rmSync(process.env.E2E_RUN_DIR, { recursive: true, force: true });
  }
}
