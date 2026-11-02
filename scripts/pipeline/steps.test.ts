import { existsSync } from 'node:fs';
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

  it.skipIf(!lfsContentReadable(MANIFEST))('describes every pull under python3 -I -S', () => {
    const tree = pipelineTree(REPO_ROOT);
    for (const step of MANUAL_STEPS.filter((s) => s.kind === 'pull')) {
      expect(describeStep(step, tree), step.name).toMatchObject({ kind: 'pull', query: expect.any(String) });
    }
  }, 60_000);

  it.skipIf(!existsSync(resolve(REPO_ROOT, 'public/clouds.json')))('describes every describing bake under python3 -I -S', () => {
    const tree = pipelineTree(REPO_ROOT);
    const bakes = MANUAL_STEPS.filter((s) => s.kind === 'bake' && describesItself(s));
    expect(bakes.map((s) => s.name)).toEqual(['build:cloud-surfaces']);
    for (const step of bakes) {
      expect(describeStep(step, tree), step.name).toMatchObject({ kind: 'bake', request: expect.any(Array) });
    }
  });
});
