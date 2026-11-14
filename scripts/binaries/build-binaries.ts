// build:binaries: Stages 1-6 in order, then Stage 7's count snapshot check gates multiples.tsv, the astrometry request and the verdicts. See README.md#pipeline-at-a-glance.

import { resolve } from 'node:path';

import type { StagedCounts } from '../util/counts/count-stages-pure';
import { emitArtifacts } from '../util/emit-artifacts';
import { REPO_ROOT } from '../util/paths';
import { countSnapshotCheck } from '../util/snapshot-check';
import { BINARIES_OUTPUTS } from './binaries-outputs';
import { binariesCounts } from './counts/binaries-counts';
import { MULTIPLES_TSV } from './multiples-tsv';
import { BINDING_VERDICTS_TSV, bindingVerdictRow } from './resolve/binding-verdicts-tsv';
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
  for (const line of stage3Report(reference, resolved, astrometry)) log(line);
  const orbits = attachStage4(astrometry, reference);
  for (const line of stage4Report(orbits)) log(line);
  const masses = pairMasses(astrometry.pairs, reference.indices);
  const optical = attachStage5(astrometry, orbits, masses, reference.indices);
  for (const line of stage5Report(optical)) log(line);
  const multiples = attachStage6(astrometry, orbits, optical, reference);
  for (const line of stage6Report(multiples)) log(line);
  return { reference, resolved, astrometry, orbits, optical, multiples };
}

const EXPECTED_COUNTS = resolve(REPO_ROOT, 'scripts/binaries/build-binaries-expected.json');

const log = (line: string): void => console.log(`[build-binaries] ${line}`);

export async function main(): Promise<void> {
  const results = await runStages(log);
  const { reference, resolved, multiples } = results;
  emitArtifacts({
    outputs: BINARIES_OUTPUTS,
    files: {
      multiples: MULTIPLES_TSV.serialize(multiples.rows),
      bindingVerdicts: BINDING_VERDICTS_TSV.serialize(resolved.verdicts.map(bindingVerdictRow)),
    },
    checks: [
      ...reference.checks,
      countSnapshotCheck<StagedCounts>({
        snapshotPath: EXPECTED_COUNTS,
        actual: binariesCounts(results),
        failureLabel: 'build-binaries count',
        script: 'build:binaries',
      }),
    ],
  });
  for (const f of Object.values(BINARIES_OUTPUTS.files)) log(`wrote ${f}`);
}
