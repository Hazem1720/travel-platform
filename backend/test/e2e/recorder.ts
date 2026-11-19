import { appendFileSync } from 'fs';
import { join } from 'path';
import type { NextFunction, Request, Response } from 'express';
import { HITS_PREFIX } from './run-dir';
import { findSensitiveKeys } from './sensitive-keys';

// One line per response in E2E_RUN_DIR/hits-<pid>.jsonl, read by
// check-coverage.ts after the run.
export type HitLine =
  | { kind: 'hit'; route: string; status: number }
  | {
      kind: 'sensitive';
      route: string;
      status: number;
      key: string;
      path: string;
    };

export function hitsFile(runDir: string): string {
  return join(runDir, `${HITS_PREFIX}${process.pid}.jsonl`);
}

// Express middleware, added before Nest registers its routes. It sees every
// response, including the 401 and 403 that guards send (an interceptor runs
// after the guards and would miss those), and scans every JSON body for
// sensitive keys.
export function recorder(runDir: string) {
  const file = hitsFile(runDir);
  const write = (line: HitLine) =>
    appendFileSync(file, JSON.stringify(line) + '\n');

  return (req: Request, res: Response, next: NextFunction) => {
    // The route template ("/api/hotels/:id") is known only once Express has
    // matched it; it is still set when the response finishes.
    const routeOf = () =>
      req.route?.path ? `${req.method} ${req.route.path}` : null;

    const json = res.json.bind(res);
    res.json = (body?: unknown) => {
      const findings = findSensitiveKeys(body);
      if (findings.length) {
        const route = routeOf() ?? `${req.method} ${req.path} (unmatched)`;
        for (const f of findings) {
          write({ kind: 'sensitive', route, status: res.statusCode, ...f });
        }
      }
      return json(body);
    };

    res.on('finish', () => {
      const route = routeOf();
      // An unknown URL (404 from Express) belongs to no route.
      if (route) write({ kind: 'hit', route, status: res.statusCode });
    });
    next();
  };
}
