// run.ts <step…> [--force] [--update-snapshots]. See README.md#the-runner--runts.

import { REPO_ROOT } from '../util/paths';
import { entryInputPaths } from '../util/step-inputs';
import { loadTable } from './load-table';
import { runSteps } from './runner';
import { STEPS } from './steps';

const FLAGS = new Set(['--force', '--update-snapshots']);

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a.startsWith('--') && !FLAGS.has(a));
  const targets = args.filter((a) => !a.startsWith('--'));
  if (unknown.length > 0 || targets.length === 0) {
    console.error(`usage: run.ts <step…> [--force] [--update-snapshots]${unknown.length > 0 ? `; unknown: ${unknown.join(' ')}` : ''}`);
    return 2;
  }
  const loaded = await loadTable(STEPS, { root: REPO_ROOT, deriveInputs: (entry) => entryInputPaths([entry]) });
  if (loaded.kind === 'rejected') {
    for (const problem of loaded.problems) console.error(`step table rejected: ${problem}`);
    return 1;
  }
  const { status } = await runSteps(loaded, {
    root: REPO_ROOT,
    targets,
    force: args.includes('--force'),
    updateSnapshots: args.includes('--update-snapshots'),
    log: (line) => console.log(line),
  });
  return status;
}

main().then((status) => process.exit(status), (err: unknown) => {
  console.error(err);
  process.exit(1);
});
