// build:binaries' TypeScript shell: the stages in order. build-binaries.py runs the step until the switch (README.md#porting-to-typescript--one-stack-one-switch).

import { attachStage3, type Stage3Result } from './astrometry/attach-astrometry';
import { stage3Report } from './astrometry/stage3-report-pure';
import { loadReferenceCatalogs, type ReferenceCatalogs } from './load/reference-catalogs';
import { stage1Report } from './load/stage1-report-pure';
import { pairMasses } from './masses/pair-masses';
import { attachStage6, type Stage6Result } from './multiples/attach-multiples';
import { stage6Report } from './multiples/stage6-report-pure';
import { attachStage5, type Stage5Result } from './optical/attach-optical';
import { stage5Report } from './optical/stage5-report-pure';
import { resolveStage2, type Stage2Result } from './resolve/resolve-pairs';
import { stage2Report } from './resolve/stage2-report-pure';
import { attachStage4, type Stage4Result } from './orbits/attach-orbits';
import { stage4Report } from './orbits/stage4-report-pure';

export interface StageResults {
  readonly reference: ReferenceCatalogs;
  readonly resolved: Stage2Result;
  readonly astrometry: Stage3Result;
  readonly orbits: Stage4Result;
  readonly optical: Stage5Result;
  readonly multiples: Stage6Result;
}

export async function runStages(log: (line: string) => void): Promise<StageResults> {
  const reference = await loadReferenceCatalogs();
  for (const line of stage1Report(reference)) log(line);
  const resolved = resolveStage2(reference);
  for (const line of stage2Report(resolved)) log(line);
  const astrometry = attachStage3(resolved, reference);
  for (const line of stage3Report(astrometry)) log(line);
  const orbits = attachStage4(astrometry, reference);
  for (const line of stage4Report(orbits)) log(line);
  const masses = pairMasses(astrometry.pairs, reference.indices);
  const optical = attachStage5(astrometry, orbits, masses, reference.indices);
  for (const line of stage5Report(optical)) log(line);
  const multiples = attachStage6(astrometry, orbits, optical, reference);
  for (const line of stage6Report(multiples)) log(line);
  return { reference, resolved, astrometry, orbits, optical, multiples };
}
