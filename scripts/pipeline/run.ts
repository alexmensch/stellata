// The runner's command line. See README.md#the-runner--runts.

import { REPO_ROOT } from '../util/paths';
import { loadRepoTable } from './step-table/repo-table';
import { runSteps } from './runner';
import { expandTargets } from './step-table/step-table-pure';
import { STEPS } from './step-table/steps';

const FLAGS = new Set(['--force', '--update-snapshots', '--verify-committed']);

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a.startsWith('--') && !FLAGS.has(a));
  const targets = args.filter((a) => !a.startsWith('--'));
  if (unknown.length > 0 || targets.length === 0) {
    console.error(`usage: run.ts <step…|data> ${[...FLAGS].map((f) => `[${f}]`).join(' ')}${unknown.length > 0 ? `; unknown: ${unknown.join(' ')}` : ''}`);
    return 2;
  }
  const loaded = await loadRepoTable();
  if (loaded.kind === 'rejected') {
    for (const problem of loaded.problems) console.error(`step table rejected: ${problem}`);
    return 1;
  }
  const { status } = await runSteps(loaded, {
    root: REPO_ROOT,
    targets: expandTargets(STEPS.steps, targets),
    force: args.includes('--force'),
    updateSnapshots: args.includes('--update-snapshots'),
    verifyCommitted: args.includes('--verify-committed'),
    log: (line) => console.log(line),
  });
  return status;
}

main().then((status) => process.exit(status), (err: unknown) => {
  console.error(err);
  process.exit(1);
});
