// record.ts <manual step> [--force] [args…]: every pull and bake's package.json target. See README.md#recording-a-manual-step--recordts.

import { REPO_ROOT } from '../util/paths';
import { deriveRepoInputs, loadRepoTable } from './step-table/repo-table';
import { recordStep } from './record-step';

export async function main(): Promise<number> {
  const [step, ...rest] = process.argv.slice(2);
  if (!step || step.startsWith('--')) {
    console.error('usage: record.ts <manual step> [--force] [args…]');
    return 2;
  }
  const loaded = await loadRepoTable();
  if (loaded.kind === 'rejected') {
    for (const problem of loaded.problems) console.error(`step table rejected: ${problem}`);
    return 1;
  }
  const outcome = await recordStep(loaded, {
    root: REPO_ROOT,
    step,
    force: rest.includes('--force'),
    args: rest.filter((a) => a !== '--force'),
    deriveInputs: deriveRepoInputs,
    log: (line) => console.log(line),
  });
  switch (outcome.kind) {
    case 'fresh':
      console.log(`· ${step} fresh: its record matches its inputs, query and outputs (--force re-runs it)`);
      return 0;
    case 'recorded':
      console.log(`✓ ${step} recorded`);
      return 0;
    case 'partial':
      console.log(`· ${step} ran with arguments, so its record is left as it was: whatever the run moved reads stale`);
      return 0;
    case 'failed':
      console.error(`✗ ${step} failed: ${outcome.reason}; its record is unchanged`);
      return 1;
  }
}
