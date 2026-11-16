// build:binaries: Stages 1-6 in order, then Stage 7's count snapshot check gates multiples.tsv, the verdicts and every binaries lineage stage. See README.md#pipeline-at-a-glance.

import { emitArtifacts } from '../util/emit-artifacts';
import { countSnapshotCheck } from '../util/snapshot-check';
import { BUILD_BINARIES_COUNTS } from './build-binaries-expected-json';
import { stepInputHashes } from '../util/step-input-hashes';
import type { LineageInvariant } from '../catalog/lineage/lineage-invariant-pure';
import type { LineageLine } from '../catalog/lineage/lineage-row-pure';
import type { FileHashes } from '../util/build-stamp';
import type { StageCodes } from '../catalog/lineage/reason-codes/reason-codes-pure';
import { countedStageLineage, foldedStageLineage, mergedEmissions, namedStageRun, stageLineage, type LineageBudget } from '../catalog/lineage/stage-lineage';
import { BINARIES_OUTPUTS } from './binaries-outputs';
import { PAIRS_CODES, PAIRS_LINEAGE_BUDGET, pairsLineageLines } from './pairs-lineage-pure';
import { binariesCounts } from './counts/binaries-counts';
import { MULTIPLES_TSV } from './multiples-tsv';
import { BINDING_VERDICTS_TSV, bindingVerdictRow } from './resolve/binding-verdicts-tsv';
import { attachStage3, type Stage3Result } from './astrometry/attach-astrometry';
import {
  ASTROMETRY_CODES, ASTROMETRY_INVARIANTS, ASTROMETRY_LINEAGE_BUDGET, astrometryCounts, astrometryLineageLines,
} from './astrometry/astrometry-lineage-pure';
import { stage3Report } from './astrometry/stage3-report-pure';
import { loadReferenceCatalogs, type ReferenceCatalogs } from './load/reference-catalogs';
import { stage1Report } from './load/stage1-report-pure';
import { pairMasses } from './masses/pair-masses';
import { ANCHORS_CODES, ANCHORS_INVARIANTS, ANCHORS_LINEAGE_BUDGET, anchorsLineageLines } from './multiples/anchors-lineage-pure';
import { attachStage6, type Stage6Result } from './multiples/attach-multiples';
import { MASSES_CODES, MASSES_INVARIANTS, MASSES_LINEAGE_BUDGET, massesLineageLines } from './multiples/masses-lineage-pure';
import { stage6Report } from './multiples/stage6-report-pure';
import { attachStage5, type Stage5Result } from './optical/attach-optical';
import { stage5Report } from './optical/stage5-report-pure';
import { resolveStage2, type Stage2Result } from './resolve/resolve-pairs';
import { BINDING_CODES, BINDING_LINEAGE_BUDGET, bindingLineageLines } from './resolve/binding-lineage-pure';
import {
  RESOLVE_CODES, RESOLVE_INVARIANTS, RESOLVE_LINEAGE_BUDGET, resolveCounts, resolveLineageLines,
} from './resolve/resolve-lineage-pure';
import { stage2Report } from './resolve/stage2-report-pure';
import { attachStage4, type Stage4Result } from './orbits/attach-orbits';
import {
  ORBITS_CODES, ORBITS_INVARIANTS, ORBITS_LINEAGE_BUDGET, orbitsCounts, orbitsLineageLines,
} from './orbits/orbits-lineage-pure';
import { stage4Report } from './orbits/stage4-report-pure';
import {
  ANCHORS_LINEAGE, ASTROMETRY_LINEAGE, BINDING_LINEAGE, MASSES_LINEAGE, ORBITS_LINEAGE, PAIRS_LINEAGE, RESOLVE_LINEAGE, type StageLineageSpec,
} from '../../src/catalog-format/pipeline-outputs/lineage-files';

export interface StageResults {
  readonly reference: ReferenceCatalogs;
  readonly resolved: Stage2Result;
  readonly astrometry: Stage3Result;
  readonly orbits: Stage4Result;
  readonly optical: Stage5Result;
  readonly multiples: Stage6Result;
}

export async function runStages(log: (line: string) => void): Promise<StageResults> {
  const reference = await loadReferenceCatalogs('read');
  for (const line of stage1Report(reference)) log(line);
  const resolved = resolveStage2(reference);
  for (const line of stage2Report(resolved)) log(line);
  const astrometry = attachStage3(resolved, reference);
  for (const line of stage3Report(reference, astrometry)) log(line);
  const orbits = attachStage4(astrometry, reference);
  for (const line of stage4Report(orbits)) log(line);
  const masses = pairMasses(astrometry.pairs, reference.indices);
  const optical = attachStage5(astrometry, orbits, masses, reference.indices);
  for (const line of stage5Report(optical)) log(line);
  const multiples = attachStage6(astrometry, orbits, optical, reference);
  for (const line of stage6Report(multiples)) log(line);
  return { reference, resolved, astrometry, orbits, optical, multiples };
}

const log = (line: string): void => console.log(`[build-binaries] ${line}`);

interface BinariesStage<S extends string, C extends StageCodes<string, S>> {
  readonly spec: StageLineageSpec<S, S>;
  readonly codes: C;
  readonly lines: () => readonly LineageLine[];
  readonly budget: LineageBudget;
  readonly invariants: readonly LineageInvariant[];
}

/** One binaries lineage stage's run, its files named for it, over the step's input hashes. */
function binariesRun<S extends string, C extends StageCodes<string, S>>(inputs: FileHashes, stage: BinariesStage<S, C>) {
  return namedStageRun<S, S, C>({ ...stage, inputs });
}

export async function main(): Promise<void> {
  const results = await runStages(log);
  const { reference, resolved, astrometry: routed, orbits: sourced, optical, multiples } = results;
  const inputs = stepInputHashes();
  const binding = countedStageLineage(binariesRun(inputs, {
    spec: BINDING_LINEAGE, codes: BINDING_CODES, lines: () => bindingLineageLines(multiples.rows), budget: BINDING_LINEAGE_BUDGET, invariants: [],
  }), BINDING_CODES);
  const resolve = foldedStageLineage(binariesRun(inputs, {
    spec: RESOLVE_LINEAGE, codes: RESOLVE_CODES, lines: () => resolveLineageLines(resolved), budget: RESOLVE_LINEAGE_BUDGET, invariants: RESOLVE_INVARIANTS,
  }), resolveCounts);
  const astrometry = foldedStageLineage(binariesRun(inputs, {
    spec: ASTROMETRY_LINEAGE, codes: ASTROMETRY_CODES, lines: () => astrometryLineageLines(routed), budget: ASTROMETRY_LINEAGE_BUDGET,
    invariants: ASTROMETRY_INVARIANTS,
  }), astrometryCounts);
  const orbits = foldedStageLineage(binariesRun(inputs, {
    spec: ORBITS_LINEAGE, codes: ORBITS_CODES, lines: () => orbitsLineageLines(sourced), budget: ORBITS_LINEAGE_BUDGET, invariants: ORBITS_INVARIANTS,
  }), orbitsCounts);
  const pairs = countedStageLineage(binariesRun(inputs, {
    spec: PAIRS_LINEAGE, codes: PAIRS_CODES, lines: () => pairsLineageLines({ reference, optical, multiples }), budget: PAIRS_LINEAGE_BUDGET,
    invariants: [],
  }), PAIRS_CODES);
  const anchors = stageLineage(binariesRun(inputs, {
    spec: ANCHORS_LINEAGE, codes: ANCHORS_CODES, lines: () => anchorsLineageLines(multiples.anchors), budget: ANCHORS_LINEAGE_BUDGET,
    invariants: ANCHORS_INVARIANTS,
  }));
  const masses = stageLineage(binariesRun(inputs, {
    spec: MASSES_LINEAGE, codes: MASSES_CODES, lines: () => massesLineageLines(multiples.massReads), budget: MASSES_LINEAGE_BUDGET,
    invariants: MASSES_INVARIANTS,
  }));
  const lineage = mergedEmissions([binding, resolve, astrometry, orbits, pairs, anchors, masses]);
  emitArtifacts({
    outputs: BINARIES_OUTPUTS,
    files: {
      multiples: MULTIPLES_TSV.serialize(multiples.rows),
      bindingVerdicts: BINDING_VERDICTS_TSV.serialize(resolved.verdicts.map(bindingVerdictRow)),
      ...lineage.files,
    },
    members: lineage.members,
    checks: [
      ...reference.checks,
      ...lineage.checks,
      countSnapshotCheck(BUILD_BINARIES_COUNTS, {
        actual: binariesCounts(results, { binding: binding.counts, resolve: resolve.counts, astrometry: astrometry.counts, orbits: orbits.counts, pairs: pairs.counts }),
        failureLabel: 'build-binaries count',
      }),
    ],
  });
  for (const f of Object.values(BINARIES_OUTPUTS.files)) log(`wrote ${f}`);
}
