// pnpm run worktree:include: rewrites .worktreeinclude from the step table.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { REPO_ROOT } from '../util/paths';
import { loadedRepoTable } from './step-table/repo-table';
import { worktreeInclude } from './worktree-include';
import { WORKTREE_INCLUDE } from './worktree-include-pure';

export async function main(): Promise<void> {
  writeFileSync(resolve(REPO_ROOT, WORKTREE_INCLUDE), worktreeInclude(await loadedRepoTable()));
  console.log(`${WORKTREE_INCLUDE} written`);
}
