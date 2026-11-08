// build:binaries' TypeScript shell: the stages in order. build-binaries.py runs the step until the switch (README.md#porting-to-typescript--one-stack-one-switch).

import { loadReferenceCatalogs, type ReferenceCatalogs } from './load/reference-catalogs';
import { stage1Report } from './load/stage1-report-pure';
import { resolveStage2, type Stage2Result } from './resolve/resolve-pairs';
import { stage2Report } from './resolve/stage2-report-pure';

export interface StageResults {
  readonly reference: ReferenceCatalogs;
  readonly resolved: Stage2Result;
}

export async function runStages(log: (line: string) => void): Promise<StageResults> {
  const reference = await loadReferenceCatalogs();
  for (const line of stage1Report(reference)) log(line);
  const resolved = resolveStage2(reference);
  for (const line of stage2Report(resolved)) log(line);
  return { reference, resolved };
}
