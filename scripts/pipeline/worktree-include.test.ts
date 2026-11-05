import { beforeAll, describe, expect, it } from 'vitest';

import type { LoadedTable } from './step-table/load-table';
import { loadedRepoTable } from './step-table/repo-table';
import { seedOutputs, seedSteps, worktreeInclude } from './worktree-include';

let loaded: LoadedTable;

beforeAll(async () => {
  loaded = await loadedRepoTable();
}, 60_000);

describe('the worktree include', () => {
  it('renders from the repo table', () => {
    expect(worktreeInclude(loaded).split('\n')).toEqual(expect.arrayContaining(['build/stamps/build-catalog.json', 'public/catalog.bin.*']));
  });

  it('loses membership\'s lineage baseline without build:membership', () => {
    const steps = seedSteps(loaded);
    const others = new Set(steps.filter((step) => step !== 'build:membership').flatMap((step) => seedOutputs(loaded, step).files));
    expect(seedOutputs(loaded, 'build:membership').files.filter((f) => f.startsWith('build/lineage/') && !others.has(f)))
      .toEqual(['build/lineage/membership.tsv.gz', 'build/lineage/identity.tsv.gz', 'build/lineage/membership.header.json']);
  });
});
