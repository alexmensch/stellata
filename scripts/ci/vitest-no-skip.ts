// The whole vitest suite, failing on any test that did not run. `pnpm run test:no-skip`; see README.md#vitest-with-every-input.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { REPO_ROOT } from '../util/paths';
import { testsNotRun, type VitestJsonReport } from './vitest-skips-pure';

const reportPath = join(mkdtempSync(join(tmpdir(), 'vitest-no-skip-')), 'report.json');
const run = spawnSync(
  'pnpm',
  ['exec', 'vitest', 'run', '--reporter=default', '--reporter=json', `--outputFile=${reportPath}`],
  { cwd: REPO_ROOT, stdio: 'inherit' },
);
if (run.status !== 0) process.exit(run.status ?? 1);

const report = JSON.parse(readFileSync(reportPath, 'utf-8')) as VitestJsonReport;
const notRun = testsNotRun(report, REPO_ROOT);
for (const line of notRun) console.log(`::error::${line}`);
if (report.numTotalTests === 0 || notRun.length > 0) {
  console.log(`${notRun.length} of ${report.numTotalTests} tests did not run; every input is present here, so none may skip`);
  process.exit(1);
}
