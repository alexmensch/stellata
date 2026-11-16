// SID allocation over the sorted records, failing the build before anything
// is staged. See ../README.md#sid-allocation.

import { ALLOCATION_LINEAGE, ALLOCATION_SIDS_STEM } from '../../../src/catalog-format/pipeline-outputs/lineage-files';
import { allocate, type Allocation, type SidObject } from '../../sid/allocate-pure';
import {
  ALLOCATION_CODES, ALLOCATION_LINEAGE_BUDGET, allocationLineageRows, allocationSidRows, allocationSidsText,
  allocationSummary,
} from '../../sid/allocation-lineage-pure';
import { catalogSidObjects } from '../../sid/catalog-objects';
import { catalogUpstream, type CatalogLineage } from '../../sid/catalog-upstream';
import { allocationRun, loadRegistry } from '../../sid/registry-io';
import { inPartition } from '../../sid/registry-partitions-pure';
import { synthChurnReport } from '../../sid/synth-churn-pure';
import { CATALOG_PARTITION } from '../../../src/catalog-format/pipeline-outputs/data-files';
import type { FileHashes } from '../../util/build-stamp';
import type { MultiplesTsvRow } from '../companions/multiples-row';
import { stageLines } from '../lineage/lineage-row-pure';
import { allocatedSids, type AllocatedSids, type Sorted } from '../record/record-phase';
import type { Star } from '../parse/stars-parse';
import { catalogCountedStageLineage } from './catalog-stage-lineage';

export type Allocated = Extract<Allocation, { kind: 'allocated' }>;

/** A successful allocation over the catalogue: the display names key on `recordSids`. */
export interface AllocatedCatalog {
  readonly allocation: Allocated;
  readonly recordSids: AllocatedSids;
  readonly registry: ReturnType<typeof loadRegistry>;
  readonly emission: ReturnType<typeof allocationLineage>;
}

export function allocationStage(
  sorted: Sorted<Star>,
  mintSynth: ReadonlyMap<string, string>,
  upstream: CatalogLineage,
  multiplesRows: readonly MultiplesTsvRow[],
  stepInputs: FileHashes,
): AllocatedCatalog {
  const registry = loadRegistry();
  const sidObjects = catalogSidObjects(sorted, mintSynth);
  const allocation = allocate({
    objects: sidObjects,
    storedEdges: registry.storedEdges,
    ledger: registry.ledger,
    events: registry.events,
    scope: inPartition(CATALOG_PARTITION),
    ...allocationRun(),
  }, catalogUpstream(upstream));
  if (allocation.kind === 'failed') throw new Error(allocationFailure(allocation, sidObjects, multiplesRows));
  for (const { designation, objects } of allocation.ambiguous) {
    console.log(`ambiguous (dropped): ${designation} names ${objects.length} objects — ${objects.map((i) => sidObjects[i].label).join(' | ')}`);
  }
  const emission = allocationLineage(sidObjects, allocation, stepInputs);
  console.log(allocationSummary(emission.counts, allocation.events.length));
  return {
    allocation, registry, emission,
    recordSids: allocatedSids(allocation.outcomes.slice(0, sorted.length).map((o) => o.sid)),
  };
}

function allocationFailure(
  allocation: Extract<Allocation, { kind: 'failed' }>,
  sidObjects: readonly SidObject[],
  multiplesRows: readonly MultiplesTsvRow[],
): string {
  const synthOrphans = allocation.unexplained.flatMap((k) => (k.startsWith('synth:') ? [k.slice('synth:'.length)] : []));
  const liveSynth = sidObjects.flatMap((o) => o.designations.flatMap((d) => (d.startsWith('synth:') ? [d.slice('synth:'.length)] : [])));
  return `SID allocation failed for ${allocation.errors.length} object(s):\n  ${allocation.errors.join('\n  ')}`
    + (synthOrphans.length === 0 ? '' : `\n${synthChurnReport(synthOrphans, liveSynth, multiplesRows)}`);
}

function allocationLineage(sidObjects: readonly SidObject[], allocation: Allocated, stepInputs: FileHashes) {
  return catalogCountedStageLineage({
    spec: ALLOCATION_LINEAGE, codes: ALLOCATION_CODES,
    lines: () => stageLines(ALLOCATION_CODES, allocationLineageRows(sidObjects, allocation)),
    siblings: () => ({ [ALLOCATION_SIDS_STEM]: allocationSidsText(allocationSidRows(sidObjects, allocation.outcomes)) }),
    budget: ALLOCATION_LINEAGE_BUDGET, invariants: [], inputs: stepInputs,
  });
}
