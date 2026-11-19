import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import type { RouteInfo } from './app';
import type { HitLine } from './recorder';
import { REQUIREMENT_EXCLUSIONS } from './requirement-exclusions';
import { ROUTE_EXCLUSIONS } from './route-exclusions';
import { HITS_PREFIX, ROUTES_PREFIX } from './run-dir';

// The gates of E2E_PLAN.md section 2, run by run.ts after Jest:
//   1. requirement gate: every M1 requirement is named in a passing test
//      (or a documented it.failing), or excluded with a reason;
//   2. route gate: every served route has a 2xx hit, a 401 hit if it is not
//      public, a 403 hit if it has @Roles, and a Swagger entry, or is
//      excluded with a reason;
//   3. sensitive-field gate: no response body had a sensitive key.
// An exclusion that is no longer needed also fails, so the lists only shrink.

const BACKEND = join(__dirname, '..', '..');
export const TRACKER_CSV = join(
  BACKEND,
  '..',
  'docs',
  'requirements',
  'requirements-tracker.csv',
);
export const REPORT_FILE = join(BACKEND, 'coverage', 'e2e-coverage.md');

// A requirement ID in a test title: "ACC-04", "FLT-22", "ACC-07a",
// "GEN-01-B" (the tracker's four shapes).
const ID_PATTERN = /\b[A-Z]{2,4}-\d{2}(?:[a-z]|-[A-Z])?\b/g;
// A known bug, written as it.failing('... (bug #123)') (rule 0.1).
const BUG_PATTERN = /\(bug #\d+\)/;
// "[partial: GEN-10, BLG-02]": the test checks only part of those
// requirements. The gate ignores these IDs (they do not count as covered);
// the report lists them per requirement.
const PARTIAL_PATTERN = /\[partial:([^\]]*)\]/g;

export interface CheckInput {
  runDir: string;
  jestJson: string;
  trackerCsv?: string;
  requirementExclusions?: Record<string, string>;
  routeExclusions?: Record<string, string>;
  reportFile?: string;
}

export interface CheckResult {
  ok: boolean;
  problems: string[];
  report: string;
}

interface Requirement {
  id: string;
  type: string;
  owner: string;
  milestone: string;
}

export function checkCoverage(input: CheckInput): CheckResult {
  const problems: string[] = [];
  const reqExcl = input.requirementExclusions ?? REQUIREMENT_EXCLUSIONS;
  const routeExcl = input.routeExclusions ?? ROUTE_EXCLUSIONS;

  // ---- 1. Requirement gate
  const requirements = readTracker(input.trackerCsv ?? TRACKER_CSV);
  const known = new Set(requirements.map((r) => r.id));
  const m1 = requirements.filter((r) => r.milestone === 'M1');
  const m1Ids = new Set(m1.map((r) => r.id));

  const passing = new Map<string, number>();
  const failingBugs = new Map<string, number>();
  const partial = new Map<string, string[]>(); // requirement -> test titles
  if (!existsSync(input.jestJson)) {
    problems.push(`Jest results not found: ${input.jestJson}`);
  } else {
    const results = JSON.parse(readFileSync(input.jestJson, 'utf8'));
    for (const file of results.testResults ?? []) {
      for (const t of file.assertionResults ?? []) {
        if (t.status !== 'passed') continue;
        const name: string = t.fullName ?? t.title ?? '';
        for (const m of name.matchAll(PARTIAL_PATTERN)) {
          for (const id of new Set(m[1].match(ID_PATTERN) ?? [])) {
            if (known.has(id))
              partial.set(id, [...(partial.get(id) ?? []), name]);
          }
        }
        const full = name.replace(PARTIAL_PATTERN, '');
        const target = BUG_PATTERN.test(name) ? failingBugs : passing;
        for (const id of new Set(full.match(ID_PATTERN) ?? [])) {
          if (known.has(id)) target.set(id, (target.get(id) ?? 0) + 1);
        }
      }
    }
  }

  const reqRows: string[] = [];
  for (const r of m1) {
    const p = passing.get(r.id) ?? 0;
    const f = failingBugs.get(r.id) ?? 0;
    const covered = p + f > 0;
    const excluded = reqExcl[r.id];
    let status: string;
    if (covered && excluded !== undefined) {
      status = 'STALE EXCLUSION';
      problems.push(
        `requirement ${r.id} is covered by a test but still in requirement-exclusions.ts; remove it there`,
      );
    } else if (covered) {
      status = f > 0 && p === 0 ? 'only it.failing' : 'covered';
    } else if (excluded !== undefined) {
      status = `excluded: ${excluded}`;
    } else {
      status = 'MISSING';
      problems.push(
        `requirement ${r.id} (M1) is named in no passing test and not excluded`,
      );
    }
    const parts = partial.get(r.id)?.length ?? 0;
    reqRows.push(
      `| ${r.id} | ${r.type} | ${r.owner} | ${p} | ${f} | ${parts} | ${status} |`,
    );
  }
  for (const id of Object.keys(reqExcl)) {
    if (!m1Ids.has(id)) {
      problems.push(
        `requirement-exclusions.ts lists ${id}, which is not an M1 requirement in the tracker`,
      );
    }
  }

  // ---- 2. Route gate
  // Every worker wrote its own copy; they must all agree.
  const lists = listFiles(input.runDir, ROUTES_PREFIX, '.json').map((f) =>
    readFileSync(join(input.runDir, f), 'utf8'),
  );
  const routes: RouteInfo[] = lists.length ? JSON.parse(lists[0]) : [];
  if (!routes.length) {
    problems.push(
      `no route list (${ROUTES_PREFIX}*.json): no test app was booted`,
    );
  }
  if (new Set(lists).size > 1) {
    problems.push(
      'the workers wrote different route lists; the app must boot the same way every time',
    );
  }
  const hits = readHits(input.runDir);
  const byRoute = new Map<
    string,
    { ok2xx: number; s401: number; s403: number }
  >();
  let setupHits = 0;
  for (const h of hits) {
    if (h.kind !== 'hit') continue;
    // A request sent by actors.ts, fixtures.ts or a suite's setup to arrange
    // data (x-e2e-setup: 1) does not test the route, so it never counts.
    if (h.setup) {
      setupHits += 1;
      continue;
    }
    const c = byRoute.get(h.route) ?? { ok2xx: 0, s401: 0, s403: 0 };
    if (h.status >= 200 && h.status < 300) c.ok2xx += 1;
    if (h.status === 401) c.s401 += 1;
    if (h.status === 403) c.s403 += 1;
    byRoute.set(h.route, c);
  }

  const routeKeys = new Set(routes.map((r) => r.key));
  const routeRows: string[] = [];
  for (const r of routes) {
    const c = byRoute.get(r.key) ?? { ok2xx: 0, s401: 0, s403: 0 };
    const missing: string[] = [];
    if (!r.declared) missing.push('no controller declares it');
    if (!r.inSwagger) missing.push('not in Swagger');
    if (c.ok2xx === 0) missing.push('no 2xx');
    if (!r.isPublic && c.s401 === 0) missing.push('no 401');
    if (r.roles.length && c.s403 === 0) missing.push('no 403');
    const excluded = routeExcl[r.key];
    let status: string;
    if (!missing.length && excluded !== undefined) {
      status = 'STALE EXCLUSION';
      problems.push(
        `route ${r.key} is fully covered but still in route-exclusions.ts; remove it there`,
      );
    } else if (!missing.length) {
      status = 'covered';
    } else if (excluded !== undefined) {
      status = `excluded: ${excluded} (${missing.join(', ')})`;
    } else {
      status = `MISSING: ${missing.join(', ')}`;
      problems.push(`route ${r.key}: ${missing.join(', ')}`);
    }
    const roles = r.isPublic ? 'public' : r.roles.join(', ') || 'any user';
    routeRows.push(
      `| \`${r.key}\` | ${roles} | ${c.ok2xx} | ${c.s401} | ${c.s403} | ${r.inSwagger ? 'yes' : 'no'} | ${status} |`,
    );
  }
  if (routes.length) {
    for (const key of Object.keys(routeExcl)) {
      if (!routeKeys.has(key)) {
        problems.push(
          `route-exclusions.ts lists ${key}, which the app does not serve`,
        );
      }
    }
  }

  // ---- 3. Sensitive-field gate
  const leaks = hits.filter(
    (h): h is Extract<HitLine, { kind: 'sensitive' }> => h.kind === 'sensitive',
  );
  for (const l of leaks) {
    problems.push(
      `sensitive key "${l.key}" at ${l.path} in the response of ${l.route} (${l.status})`,
    );
  }

  // ---- Report
  const coveredReqs = m1.filter(
    (r) => (passing.get(r.id) ?? 0) + (failingBugs.get(r.id) ?? 0) > 0,
  ).length;
  const coveredRoutes = routeRows.filter((row) =>
    row.endsWith('| covered |'),
  ).length;
  const report = [
    '# E2E coverage',
    '',
    `- Requirements (M1): ${coveredReqs} of ${m1.length} named in a passing test; ${Object.keys(reqExcl).length} excluded.`,
    `- Routes: ${coveredRoutes} of ${routes.length} fully covered; ${Object.keys(routeExcl).length} excluded. ${setupHits} setup requests (x-e2e-setup) not counted.`,
    `- Requirements named only as [partial: ...]: ${[...partial.keys()].filter((id) => m1Ids.has(id) && !(passing.get(id) ?? 0)).length} (listed below).`,
    `- Sensitive keys in responses: ${leaks.length}.`,
    `- Result: ${problems.length ? `FAILED (${problems.length} problems)` : 'passed'}.`,
    '',
    ...(problems.length
      ? ['## Problems', '', ...problems.map((p) => `- ${p}`), '']
      : []),
    '## Requirements',
    '',
    '| ID | Type | Owner | Passing tests | it.failing (bug) | Partial tests | Status |',
    '|---|---|---|---|---|---|---|',
    ...reqRows,
    '',
    '## Partial coverage',
    '',
    'Tests that check only part of a requirement name it as `[partial: ID]`. They do not make it covered.',
    '',
    ...m1
      .filter((r) => partial.has(r.id))
      .flatMap((r) => [
        `- **${r.id}**`,
        ...partial.get(r.id)!.map((name) => `  - ${name}`),
      ]),
    '',
    '## Routes',
    '',
    '| Route | Access | 2xx | 401 | 403 | Swagger | Status |',
    '|---|---|---|---|---|---|---|',
    ...routeRows,
    '',
  ].join('\n');

  const reportFile = input.reportFile ?? REPORT_FILE;
  mkdirSync(join(reportFile, '..'), { recursive: true });
  writeFileSync(reportFile, report);
  return { ok: problems.length === 0, problems, report };
}

function listFiles(dir: string, prefix: string, ext: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(
    (f) => f.startsWith(prefix) && f.endsWith(ext),
  );
}

function readHits(runDir: string): HitLine[] {
  return listFiles(runDir, HITS_PREFIX, '.jsonl').flatMap((f) =>
    readFileSync(join(runDir, f), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as HitLine),
  );
}

export function readTracker(path: string): Requirement[] {
  const rows = parseCsv(readFileSync(path, 'utf8').replace(/^﻿/, ''));
  const [header, ...body] = rows;
  const col = (name: string) => header.indexOf(name);
  const [id, type, owner, milestone] = ['ID', 'Type', 'Owner', 'Milestone'].map(
    col,
  );
  if ([id, type, owner, milestone].some((i) => i < 0)) {
    throw new Error(`Unexpected tracker header in ${path}`);
  }
  return body
    .filter((r) => r[id])
    .map((r) => ({
      id: r[id].trim(),
      type: r[type],
      owner: r[owner],
      milestone: r[milestone].trim(),
    }));
}

// RFC 4180: quoted fields may hold commas, quotes ("") and line breaks.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
