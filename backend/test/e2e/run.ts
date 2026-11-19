import { spawnSync } from 'child_process';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { checkCoverage } from './check-coverage';
import { JEST_JSON, makeRunDir } from './run-dir';

// npm run test:e2e:full (also used by CI): the whole e2e suite, then the
// coverage gates, with one run folder shared by both.
//   1. create a unique run folder and set E2E_RUN_DIR;
//   2. run Jest (random order, seed printed, JSON results);
//   3. run the coverage check on the same folder;
//   4. delete the folder.
// Exit code: Jest's if Jest failed, otherwise the check's.

const BACKEND = join(__dirname, '..', '..');

function main(): number {
  const runDir = makeRunDir();
  const extra = process.argv.slice(2);
  if (extra.length) {
    console.warn(
      `test:e2e:full: extra Jest arguments (${extra.join(' ')}); the coverage ` +
        'gates expect the whole suite and will report what this run missed.',
    );
  }
  const coverageDir = join(BACKEND, 'coverage');
  mkdirSync(coverageDir, { recursive: true });
  const jestJson = join(coverageDir, JEST_JSON);

  try {
    const jest = spawnSync(
      process.execPath,
      [
        require.resolve('jest/bin/jest', { paths: [BACKEND] }),
        '--config',
        './test/jest-e2e.json',
        '--randomize',
        '--showSeed',
        '--json',
        `--outputFile=${jestJson}`,
        ...extra,
      ],
      {
        cwd: BACKEND,
        stdio: 'inherit',
        env: { ...process.env, E2E_RUN_DIR: runDir },
      },
    );
    const jestCode = jest.status ?? 1;

    const result = checkCoverage({ runDir, jestJson });
    console.log(
      `\nE2E coverage gates: ${result.ok ? 'passed' : `FAILED (${result.problems.length} problems)`}` +
        ` - report: coverage/e2e-coverage.md`,
    );
    for (const p of result.problems.slice(0, 50)) console.log(`  - ${p}`);
    if (result.problems.length > 50) {
      console.log(
        `  ... and ${result.problems.length - 50} more (see the report)`,
      );
    }

    if (jestCode !== 0) return jestCode;
    return result.ok ? 0 : 1;
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
}

process.exitCode = main();
