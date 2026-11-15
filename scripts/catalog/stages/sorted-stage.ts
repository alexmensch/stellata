// The passes that address records by index, over the sorted records:
// figures, variability, multiplicity, pair resolution, overlaps and system
// membership. See README.md#the-phases.

import { OVERLAP_LINEAGE } from '../../../src/catalog-format/pipeline-outputs/lineage-files';
import { serializeSystemMembership } from '../../../src/catalog-format/system-membership/system-membership-format';
import { pairsFromRows } from '../../binaries/pairs-pure';
import type { FileHashes } from '../../util/build-stamp';
import type { MultiplesTsvRow } from '../companions/multiples-row';
import { resolvePairs } from '../companions/record-index/pair-resolution-pure';
import {
  buildCatalogRowIndexMap, buildComponentDesignations, renderableOrbitRelations, resolvedMemberIndices,
  wingRenderablePrimaries,
} from '../companions/record-index/record-index';
import { buildHipToIndex, inferBinaries, wingEclipsingBinaries } from '../multiplicity/binary-flags-pure';
import { HIP_CCDM } from '../multiplicity/hip-ccdm-source';
import {
  multiplicityStatuses, multiplicitySummary, type MultiplicityCounts,
} from '../multiplicity/multiplicity-stage-pure';
import {
  applyDoublesFlag, collectPhysicalPairKeys, doublesEvidence, parseHipCcdm,
} from '../multiplicity/visual-doubles';
import { orbitChainExemption, overlapLabel, physicalOverlaps } from '../overlap/overlap-gate-pure';
import {
  OVERLAP_CODES, OVERLAP_INVARIANTS, OVERLAP_LINEAGE_BUDGET, overlapLineageLines,
} from '../overlap/overlap-lineage-pure';
import { buildFigureLines } from '../parse/constellations/constellations';
import { STELLARIUM } from '../parse/constellations/stellarium-source';
import { GAIA_HIP_XMATCH } from '../parse/gaia-hip-xmatch-source';
import { applyVariability, bridgeGcvsByGaia, gcvsSummary } from '../parse/gcvs/gcvs-parse';
import { GCVS, GCVS_CROSSID } from '../parse/gcvs/gcvs-source';
import type { ReadStarsInputs } from '../parse/read-stars-inputs';
import type { Star } from '../parse/stars-parse';
import type { Sorted } from '../record/record-phase';
import { SIMBAD_OTYPE_MULTIPLE } from '../spectral/spectral-resolve';
import { buildSystemMembership, lentDistanceRecords, systemMembershipSummary } from '../system-membership/system-membership-pure';
import { catalogCountedStageLineage } from './catalog-stage-lineage';

export interface SortedPassInputs {
  readonly multiplesRows: readonly MultiplesTsvRow[];
  readonly synthGaiaBridges: ReadonlyMap<string, string>;
  readonly simbadSpectral: ReadStarsInputs['simbadSpectral'];
  /** Records coherence snapped or promotion re-curated onto their anchor's distance. */
  readonly anchorMoved: ReadonlySet<Star>;
  readonly stepInputs: FileHashes;
}

export type SortedPasses = ReturnType<typeof sortedPasses>;

export function sortedPasses(sorted: Sorted, inputs: SortedPassInputs) {
  const hipToIndex = buildHipToIndex(sorted);
  // Throws if a referenced HIP is missing from the catalog.
  const figureLines = buildFigureLines(STELLARIUM.read(), hipToIndex);

  console.log('Inferring binary/multiple systems...');
  const tBin = Date.now();
  const binaries = inferBinaries(sorted);
  console.log(`  in ${Date.now() - tBin}ms`);

  const gcvsCounts = variability(sorted);

  console.log('Parsing Hipparcos CCDM double-star cross-reference...');
  const tCcdm = Date.now();
  const doubles = doublesEvidence(
    parseHipCcdm(HIP_CCDM.read()), collectPhysicalPairKeys(inputs.multiplesRows), hipToIndex,
  );
  const ccdm = applyDoublesFlag(sorted, doubles);
  console.log(`  in ${Date.now() - tCcdm}ms`);

  const eclipsing = wingEclipsingBinaries(sorted);

  const rowIndexMap = buildCatalogRowIndexMap(sorted, inputs.synthGaiaBridges);
  const resolvedPairs = resolvePairs(pairsFromRows(inputs.multiplesRows), rowIndexMap);
  const renderableWings = wingRenderablePrimaries(resolvedPairs, sorted);

  const overlaps = physicalOverlaps(sorted, orbitChainExemption(renderableOrbitRelations(resolvedPairs)));
  console.log(`  physical overlaps outside an orbit chain: ${overlaps.length}`);
  for (const [a, b] of overlaps) {
    console.log(`    ${overlapLabel(sorted[a], a)} | ${overlapLabel(sorted[b], b)}`);
  }
  const overlapEmission = catalogCountedStageLineage({
    spec: OVERLAP_LINEAGE, codes: OVERLAP_CODES, lines: () => overlapLineageLines(overlaps, sorted),
    budget: OVERLAP_LINEAGE_BUDGET, invariants: OVERLAP_INVARIANTS, inputs: inputs.stepInputs,
  });

  const { designations: componentDesignations, ...componentCount } = buildComponentDesignations(resolvedPairs);
  const statuses = multiplicityStatuses(
    sorted, resolvedMemberIndices(resolvedPairs),
    (sourceId) => inputs.simbadSpectral.bySourceId.get(sourceId)?.otype === SIMBAD_OTYPE_MULTIPLE,
  );
  const systems = buildSystemMembership({
    records: sorted, multiplicityStatus: statuses.status, wdsPairs: resolvedPairs, doubles,
    geometricPairs: binaries.mutual, lentDistance: lentDistanceRecords(sorted, inputs.anchorMoved),
  });
  console.log(`  ${systemMembershipSummary(systems.counts)}`);
  const multiplicity: MultiplicityCounts = {
    ...binaries.counts, ...ccdm, ...eclipsing, ...renderableWings,
    ...componentCount, ...statuses.counts, ...systems.counts,
  };
  console.log(`  ${multiplicitySummary(multiplicity)}`);

  return {
    figureLines, gcvsCounts, componentDesignations, rowIndexMap, resolvedPairs, overlapEmission, multiplicity,
    multiplicityStatus: statuses.status,
    systemMembership: serializeSystemMembership(systems.membership),
  };
}

/** GCVS onto the records: xref.byGaia is bridged from byHip through the Gaia
 *  DR3 ↔ HIP cross-walk, so a record with a gaia_source_id but no HIP still resolves. */
function variability(sorted: Sorted) {
  console.log('Parsing GCVS variable-star catalogue...');
  const tGcvs = Date.now();
  const gcvsData = GCVS.read();
  const xref = GCVS_CROSSID.read();
  const tX = Date.now();
  const hipToGaia = GAIA_HIP_XMATCH.read();
  console.log(`  Gaia DR3 ↔ HIP cross-walk: ${hipToGaia.size} entries in ${Date.now() - tX}ms`);
  bridgeGcvsByGaia(xref, hipToGaia);
  const counts = applyVariability(sorted, gcvsData, xref);
  console.log(`  ${gcvsSummary(counts)} in ${Date.now() - tGcvs}ms`);
  return counts;
}
