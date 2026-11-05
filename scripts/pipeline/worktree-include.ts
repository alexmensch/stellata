// The steps build:seed runs and .worktreeinclude rendered from their outputs, over the loaded repo table. See README.md#files.

import { packageScripts } from '../util/import-closure';
import { runnerTargets, scriptParts } from '../util/import-closure-pure';
import { REPO_ROOT } from '../util/paths';
import { buildClaims } from './build-files';
import { pipelineTree } from './pipeline-tree';
import type { LoadedTable } from './step-table/load-table';
import { expandTargets, isBuild, selectSteps, type OutputClaims } from './step-table/step-table-pure';
import { STEPS } from './step-table/steps';
import { renderWorktreeInclude } from './worktree-include-pure';

const SEED_SCRIPT = 'build:data';

const tree = pipelineTree(REPO_ROOT);

export function seedSteps(loaded: LoadedTable): string[] {
  const targets = runnerTargets(scriptParts(packageScripts(), SEED_SCRIPT));
  if (targets === null || targets.length === 0) throw new Error(`${SEED_SCRIPT} must be one run.ts call`);
  return selectSteps(loaded.graph, expandTargets(STEPS.steps, targets))
    .filter((name) => isBuild(loaded.steps.get(name)!.step));
}

/** Repo-relative, the stamp among the files. */
export function seedOutputs(loaded: LoadedTable, step: string): OutputClaims {
  const { files, families } = buildClaims(loaded.steps.get(step)!, tree);
  return { files: files.map(tree.rel), families: families.map((f) => ({ ...f, dir: tree.rel(f.dir) })) };
}

export function worktreeInclude(loaded: LoadedTable): string {
  return renderWorktreeInclude(seedSteps(loaded).map((step) => seedOutputs(loaded, step)));
}
