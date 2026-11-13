// One sibling artifact's namespace allocated over the committed registry: each record's SID, its partition's registry files, and its allocation stage's lineage. See README.md#sibling-artifact-stamping.

import { resolve } from 'node:path';

import type { FileHashes } from '../util/build-stamp';
import { nestByStage, type StagedCounts } from '../util/counts/count-stages-pure';
import { REPO_ROOT } from '../util/paths';
import { countSnapshotCheck } from '../util/snapshot-check';
import { emitArtifacts, type ArtifactContents, type DeclaredOutputs } from '../util/emit-artifacts';
import { stepInputHashes } from '../util/step-input-hashes';
import { identityText, type IdentityRow } from '../catalog/lineage/identity-pure';
import { LINEAGE_LAYOUT } from '../catalog/lineage/lineage-layout-pure';
import { stageLineageLine, stageLineageText, type LineageLine } from '../catalog/lineage/lineage-row-pure';
import { countedStageLineage, type LineageBudget, type StageLineageEmission } from '../catalog/lineage/stage-lineage';
import { allocate, type Upstream } from './allocate-pure';
import { objectOutcomeRows, type ObjectOutcomeCodes } from './allocation-lineage-pure';
import { allocationRun, loadRegistry, registryTexts } from './registry-io';
import { inPartition } from './registry-partitions-pure';
import {
  siblingArtifactObjects, type SiblingArtifact, type SiblingArtifactSpec, type SiblingItem,
} from './sibling-artifacts-pure';
import type { RegistryKey, SiblingPartition } from '../../src/catalog-format/pipeline-outputs/data-files';
import type { LineageLayout, StageOutputKey } from '../../src/catalog-format/pipeline-outputs/lineage-files';

const NO_LINEAGE: Upstream = { causes: () => new Map(), admissions: () => new Map() };

export const SIBLING_LINEAGE_BUDGET: LineageBudget = { gzipBytes: 1_900, writeMs: 5_000 };

export interface SiblingAllocation<N extends SiblingPartition> {
  /** Parallel to the items allocated. */
  readonly sids: readonly number[];
  /** The partition's files, or null when the allocation appended nothing, so such a run rewrites no registry file. */
  readonly registry: Readonly<Record<RegistryKey<N>, string>> | null;
  /** One row per object, under its origin. */
  readonly lines: readonly LineageLine[];
  /** One per object: its origin and its one designation, which trace finds it by. */
  readonly identity: readonly IdentityRow[];
}

export function allocateSibling<N extends SiblingPartition, I extends string>(
  spec: SiblingArtifactSpec & { readonly ns: N; readonly rowId: I },
  artifact: SiblingArtifact<NoInfer<I>>,
  items: readonly SiblingItem[],
): SiblingAllocation<N> {
  const registry = loadRegistry();
  const objects = siblingArtifactObjects(spec, artifact, items);
  const allocation = allocate({
    objects,
    storedEdges: registry.storedEdges,
    ledger: registry.ledger,
    events: registry.events,
    scope: inPartition(spec.ns),
    ...allocationRun(),
  }, NO_LINEAGE);
  if (allocation.kind === 'failed') {
    throw new Error(
      `${spec.ns} SID allocation failed:\n  ${allocation.errors.join('\n  ')}\n`
        + 'A renamed slug needs a bridge in data/sid/sameas-overrides.tsv.',
    );
  }
  const appended = allocation.minted.length > 0 || allocation.events.length > 0;
  return {
    sids: allocation.outcomes.map((o) => o.sid),
    registry: appended ? registryTexts(spec.ns, allocation.minted, allocation.events) : null,
    lines: objectOutcomeRows(spec.codes, objects, allocation.outcomes).map((row) => stageLineageLine(spec.codes, row)),
    identity: objects.map(({ origin, designations }) => ({
      key: origin, tyc: '', hip: '', hd: '', gl: '', gaia_source_id: '', designations,
    })),
  };
}

type SiblingStem<S extends string> = S | `${S}.identity`;

/** The sibling's allocation stage, ready for emitSibling. See README.md (sibling-allocation.ts entry). */
export function siblingLineage<S extends string>(
  spec: SiblingArtifactSpec<S>,
  allocation: Pick<SiblingAllocation<SiblingPartition>, 'lines' | 'identity'>,
  layout: LineageLayout = LINEAGE_LAYOUT,
  inputs: FileHashes = stepInputHashes(),
):StageLineageEmission<SiblingStem<S>, S> & { readonly counts: Readonly<Record<ObjectOutcomeCodes['live'][number], number>> } {
  const { stage } = spec.lineage;
  const { counts, ...emission } = countedStageLineage({
    layout,
    spec: spec.lineage,
    inputs,
    diffed: stage,
    lines: () => allocation.lines,
    render: (sorted) => ({
      [stage]: stageLineageText(spec.codes, sorted),
      [`${stage}.identity`]: identityText(allocation.identity),
    }) as Record<SiblingStem<S>, string>,
    joins: () => [],
    budget: SIBLING_LINEAGE_BUDGET,
    invariants: [],
    argv: process.argv.slice(2),
  }, spec.codes);
  const countsCheck = countSnapshotCheck<StagedCounts>({
    snapshotPath: resolve(REPO_ROOT, spec.countsSnapshot),
    actual: nestByStage([stage], [{ stage, block: { kind: 'counted', counts } }]),
    failureLabel: `${spec.step} count`,
    script: spec.step,
  });
  return { ...emission, counts, checks: [...emission.checks, countsCheck] };
}

/** Lands the artifact and its lineage, and the registry partition when the allocation appended, in one emitArtifacts call. */
export function emitSibling<K extends string, N extends SiblingPartition, S extends string>(
  outputs: DeclaredOutputs<K | StageOutputKey<SiblingStem<S>, S> | RegistryKey<N>>,
  artifact: Readonly<Record<K, string>>,
  allocation: SiblingAllocation<N>,
  lineage: Pick<StageLineageEmission<SiblingStem<S>, S>, 'files' | 'members' | 'checks'>,
): void {
  type Landed = K | StageOutputKey<SiblingStem<S>, S>;
  const files = { ...artifact, ...lineage.files } as Record<Landed, ArtifactContents>;
  const shared = { outputs, members: lineage.members, checks: lineage.checks };
  if (allocation.registry === null) {
    emitArtifacts<Landed | RegistryKey<N>, Landed>({ ...shared, only: Object.keys(files) as Landed[], files });
  } else {
    emitArtifacts<Landed | RegistryKey<N>>({ ...shared, files: { ...files, ...allocation.registry } });
  }
}
