// build:binaries' TypeScript shell: the stages in order. build-binaries.py runs the step until the switch (README.md#porting-to-typescript--one-stack-one-switch).

import { loadReferenceCatalogs, type ReferenceCatalogs } from './load/reference-catalogs';
import { stage1Report } from './load/stage1-report-pure';

export interface StageResults {
  readonly reference: ReferenceCatalogs;
}

export async function runStages(log: (line: string) => void): Promise<StageResults> {
  const reference = await loadReferenceCatalogs();
  for (const line of stage1Report(reference)) log(line);
  return { reference };
}
