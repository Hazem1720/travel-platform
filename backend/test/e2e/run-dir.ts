import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// One folder per test run, so two runs on the same machine never share hit
// files, route lists or uploads.
export function makeRunDir(): string {
  return mkdtempSync(join(tmpdir(), 'travel-e2e-'));
}

export const HITS_PREFIX = 'hits-';
// routes-<pid>.json: one per worker process, so workers never write the
// same file (renaming over a file another process writes fails on Windows).
export const ROUTES_PREFIX = 'routes-';
export const JEST_JSON = 'e2e.json';
