import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { packageScripts } from '../util/import-closure';
import { lfsContentReadable, REPO_ROOT } from '../util/paths';
import { describeStep } from './freshness';
import { loadTable } from './load-table';
import { pipelineTree } from './pipeline-tree';
import { describesItself, isBuild } from './step-table-pure';
import { MANUAL_STEPS } from './manual-step-outputs';
import { STEPS } from './steps';
import { MEMBERSHIP_MANIFEST_FILE } from '../catalog/membership/membership-manifest-tsv';

const MANIFEST = resolve(REPO_ROOT, MEMBERSHIP_MANIFEST_FILE);

describe('the step table', () => {
  it('loads: one writer per file, no build-step cycle', async () => {
    const loaded = await loadTable(STEPS, { root: REPO_ROOT, deriveInputs: async () => [] });
    expect(loaded.kind === 'rejected' ? loaded.problems : []).toEqual([]);
  });

  it('runs every manual step by hand through record.ts, under its own name', () => {
    const scripts = packageScripts();
    const manual = STEPS.steps.filter((s) => !isBuild(s));
    expect(manual.map((s) => [s.name, scripts[s.name]])).toEqual(
      manual.map((s) => [s.name, `tsx scripts/pipeline/record.ts ${s.name}`]),
    );
  });

  it.skipIf(!lfsContentReadable(MANIFEST))('describes every pull under python3 -I -S with no network call', () => {
    const tree = pipelineTree(REPO_ROOT);
    const pulls = MANUAL_STEPS.filter((s) => s.kind === 'pull' && describesItself(s));
    for (const step of pulls) {
      expect(describeStep(step, tree), step.name).toMatchObject({ kind: 'pull', query: expect.any(String) });
    }
  }, 60_000);
});
