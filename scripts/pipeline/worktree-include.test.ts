import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { REPO_ROOT } from '../util/paths';
import type { LoadedTable } from './step-table/load-table';
import { loadedRepoTable } from './step-table/repo-table';
import { seedOutputs, seedSteps, worktreeInclude } from './worktree-include';
import { WORKTREE_INCLUDE, WORKTREE_INCLUDE_COMMAND } from './worktree-include-pure';

let loaded: LoadedTable;

beforeAll(async () => {
  loaded = await loadedRepoTable();
}, 60_000);

describe(WORKTREE_INCLUDE, () => {
  it(`is what the step table renders — run ${WORKTREE_INCLUDE_COMMAND}`, () => {
    expect(readFileSync(resolve(REPO_ROOT, WORKTREE_INCLUDE), 'utf8')).toBe(worktreeInclude(loaded));
  });

  it('loses membership\'s lineage baseline without build:membership', () => {
    const steps = seedSteps(loaded);
    const others = new Set(steps.filter((step) => step !== 'build:membership').flatMap((step) => seedOutputs(loaded, step).files));
    expect(seedOutputs(loaded, 'build:membership').files.filter((f) => f.startsWith('build/lineage/') && !others.has(f)))
      .toEqual(['build/lineage/membership.tsv.gz', 'build/lineage/identity.tsv.gz', 'build/lineage/membership.header.json']);
  });
});
