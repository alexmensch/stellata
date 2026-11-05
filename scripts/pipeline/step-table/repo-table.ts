// The repo's own step table, loaded against this checkout: what run.ts, record.ts and the table suites judge.

import { REPO_ROOT } from '../../util/paths';
import { entryInputPaths } from '../../util/step-inputs';
import { loadTable, type Loaded } from './load-table';
import { STEPS } from './steps';

export const deriveRepoInputs = (entry: string): Promise<readonly string[]> => entryInputPaths([entry]);

export function loadRepoTable(): Promise<Loaded> {
  return loadTable(STEPS, { root: REPO_ROOT, deriveInputs: deriveRepoInputs });
}

/** For a suite: a rejected table fails the suite rather than skipping it. */
export async function loadedRepoTable(): Promise<Extract<Loaded, { kind: 'loaded' }>> {
  const loaded = await loadRepoTable();
  if (loaded.kind !== 'loaded') throw new Error(loaded.problems.join('\n'));
  return loaded;
}
