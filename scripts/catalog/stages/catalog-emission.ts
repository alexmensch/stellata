// The build's one emission: every CATALOG_OUTPUTS file, family member and
// check, assembled from the stages' results. See README.md.

import { resolve } from 'node:path';

import {
  BINARY_VERSION, catalogChunkFilename, planCatalogChunks, recordsInChunkPrefix, SOL_RECORD_INDEX,
  type CatalogManifest,
} from '../../../src/catalog-format/record/catalog-pure';
import {
  ALLOCATION_LINEAGE, BRIGHTNESS_COLOUR_LINEAGE, COHERENCE_LINEAGE, NAMING_LINEAGE, OVERLAP_LINEAGE, PLACEMENT_LINEAGE,
  PROMOTION_LINEAGE, SIZE_LINEAGE, type StageLineageSpec,
} from '../../../src/catalog-format/pipeline-outputs/lineage-files';
import { CATALOG_PARTITION } from '../../../src/catalog-format/pipeline-outputs/data-files';
import type { IauConstellationLookup } from '../../../src/astro-core/iau-geometry/iau-boundaries-pure';
import { MULTIPLES_TSV } from '../../binaries/multiples-tsv';
import { sidSuccessorPairs, type EventRow } from '../../sid/events-pure';
import { registryTexts } from '../../sid/registry-io';
import type { FileHashes } from '../../util/build-stamp';
import { derivedStage, nestByStage, type CountValue, type StageBlock } from '../../util/counts/count-stages-pure';
import { sweepStaged, type ArtifactContents, type Check, type Emission } from '../../util/emit-artifacts';
import { countSnapshotCheck, snapshotCheck } from '../../util/snapshot-check';
import { handedFileHash, stepInputHashes } from '../../util/step-input-hashes';
import { boundaryArtifactSummary, renderBoundaryArtifact } from '../boundaries/build-boundaries-artifact';
import { BUILD_CATALOG_COUNTS } from '../build-catalog-expected-json';
import { CATALOG_COUNT_STAGES, type CatalogCountStage } from '../build-counts';
import { CATALOG_CHUNK_DIR, CATALOG_OUTPUTS } from '../catalog-outputs';
import { serializeCatalogPairEnds } from '../companions/record-index/pair-ends-pure';
import type { MultiplesTsvRow } from '../companions/multiples-row';
import type { ResolvedPair } from '../companions/record-index/pair-resolution-pure';
import {
  serializeCatalogRowIndexSidecar, type CatalogRowIndexMap,
} from '../companions/record-index/catalog-row-index-map-pure';
import type { ComponentDesignation } from '../companions/record-index/record-index';
import {
  PROMOTION_CODES, PROMOTION_INVARIANTS, PROMOTION_LINEAGE_BUDGET, type PromotionCounts,
} from '../companions/promotion-lineage/promotion-lineage-pure';
import { DISTANCE_OUTLIERS } from '../distance/refinement/build-distance-outliers-expected-json';
import {
  buildRegressionReport, compareRegressionReports, formatRegressionDiff, mergeReasonsFromSnapshot, simbadSampleDistances,
} from '../distance/refinement/distance-regression-check';
import { identityText } from '../lineage/identity/identity-pure';
import type { StageLineageEmission } from '../lineage/stage-lineage';
import type { NamingDerivedCounts } from '../naming/display-names';
import { namingSummary, type NamingCounts } from '../naming/naming-lineage-pure';
import {
  CONSTELLATIONS, assertFigureVerticesInFirstChunk, figuresCounts, figuresSummary,
} from '../parse/constellations/constellations';
import type { ReadStarsInputs } from '../parse/read-stars-inputs';
import type { Star } from '../parse/stars-parse';
import { encodeCatalog, type EncodedCatalog } from '../record/encode-catalog-pure';
import type { Finalised, Sorted } from '../record/record-phase';
import { apsisCoverageSummary, recordsCounts } from '../record/records-stage-pure';
import { buildSearchIndex, searchIndexSummary } from '../record/search-index-pure';
import { SIMBAD_SAMPLE } from '../validate/simbad-sample-source';
import type { AllocatedCatalog } from './allocation-stage';
import { catalogStageLineage } from './catalog-stage-lineage';
import type { FinaliseStage } from './finalise-stage';
import type { NamingStage } from './naming-stage';
import type { PromotionStage } from './promotion-stage';
import type { SortedPasses } from './sorted-stage';
import type { WalkStage } from './walk-stage';

type CatalogOutputKey = keyof (typeof CATALOG_OUTPUTS)['files'] & string;

/** Clears a previous run's staged outputs, then hashes the inputs this run reads, which the stamps key on. */
export function startCatalogBuild(): FileHashes {
  sweepStaged(CATALOG_OUTPUTS);
  return stepInputHashes();
}

/** What the pre-allocation stages hand on: the sorted records and no handle
 *  to an earlier phase, the reference tables left behind. */
export interface PreAllocation {
  readonly walk: Omit<WalkStage, 'walked'>;
  readonly naming: Omit<NamingStage, 'named'>;
  readonly promotion: Omit<PromotionStage, 'promoted'>;
  readonly sorted: Sorted<Star>;
  readonly multiplesRows: MultiplesTsvRow[];
  /** Each record's apparent-V sort key, in record order. */
  readonly sortedKey: readonly number[];
  readonly passes: SortedPasses;
  readonly apsisMap: ReadStarsInputs['apsisMap'];
  readonly gspcMap: ReadStarsInputs['gspcMap'];
  readonly conLookup: IauConstellationLookup;
  readonly inputsCounts: ReadStarsInputs['counts'];
}

/** Every CATALOG_OUTPUTS file, family member and check, ready for emitArtifacts. */
export function catalogEmission(
  built: PreAllocation, allocated: AllocatedCatalog, final: FinaliseStage, inputHashes: FileHashes,
): Emission<CatalogOutputKey> {
  const { walk, naming, promotion, passes } = built;
  const promotionEmission = catalogStageLineage({
    spec: PROMOTION_LINEAGE, codes: PROMOTION_CODES, lines: () => promotion.lines,
    siblings: () => ({ 'promotion.identity': identityText(promotion.identity) }),
    budget: PROMOTION_LINEAGE_BUDGET, invariants: PROMOTION_INVARIANTS, inputs: inputHashes,
  });
  const encoded = encodeCatalog({
    catalog: final.finalised, apsisMap: built.apsisMap, multiplicityStatus: passes.multiplicityStatus,
    binaryPrimaries: passes.binaryPrimaries,
  });
  const namingDerived: NamingDerivedCounts = { ...final.displayCounts, nameTableEntries: encoded.nameTableEntries };
  console.log(namingSummary(final.namingEmission.counts, namingDerived));

  return assembleEmission({
    catalog: final.finalised,
    sortedKey: built.sortedKey,
    encoded,
    apsisMap: built.apsisMap,
    gspcMap: built.gspcMap,
    conLookup: built.conLookup,
    inputHashes,
    figureLines: passes.figureLines,
    componentDesignations: passes.componentDesignations,
    rowIndexMap: passes.rowIndexMap,
    resolvedPairs: passes.resolvedPairs,
    systemMembership: passes.systemMembership,
    sidEvents: [...allocated.registry.events, ...allocated.allocation.events],
    ledgers: {
      parkedLedger: walk.parkedLedger,
      simbadSourcedDistances: walk.simbadSourcedDistances,
      ...registryTexts(CATALOG_PARTITION, allocated.allocation.minted, allocated.allocation.events),
    },
    lineage: {
      placement: walk.placementEmission,
      brightnessColour: walk.brightnessEmission,
      size: walk.sizeEmission,
      coherence: naming.coherenceEmission,
      promotion: promotionEmission,
      overlap: passes.overlapEmission,
      allocation: allocated.emission,
      naming: final.namingEmission,
    },
    stageCounts: [
      { stage: 'inputs', block: { kind: 'counted', counts: built.inputsCounts } },
      { stage: 'placement', block: { kind: 'counted', counts: walk.placementEmission.counts } },
      { stage: derivedStage('placement'), block: { kind: 'counted', counts: walk.stats.placementDerived } },
      { stage: 'multiplicity', block: { kind: 'counted', counts: passes.multiplicity } },
      { stage: 'gcvs', block: { kind: 'counted', counts: passes.gcvsCounts } },
      { stage: 'allocation', block: { kind: 'counted', counts: allocated.emission.counts } },
      { stage: 'naming', block: { kind: 'counted', counts: { ...final.namingEmission.counts, ...naming.starNamingCounts } satisfies NamingCounts } },
      { stage: derivedStage('naming'), block: { kind: 'counted', counts: namingDerived } },
      { stage: 'brightness-colour', block: { kind: 'counted', counts: walk.brightnessEmission.counts } },
      { stage: 'coherence', block: { kind: 'counted', counts: naming.coherenceEmission.counts } },
      { stage: 'promotion', block: { kind: 'counted', counts: promotion.counts satisfies PromotionCounts } },
      { stage: derivedStage('promotion'), block: { kind: 'counted', counts: promotion.stats } },
      { stage: 'overlap', block: { kind: 'counted', counts: passes.overlapEmission.counts } },
    ],
  });
}

type EmissionOf<T> = T extends StageLineageSpec<infer F, infer S> ? StageLineageEmission<F, S> : never;

interface CatalogEmissionInputs {
  readonly catalog: Finalised;
  /** Each record's apparent-V sort key, in record order. */
  readonly sortedKey: readonly number[];
  readonly encoded: EncodedCatalog;
  readonly apsisMap: ReadStarsInputs['apsisMap'];
  readonly gspcMap: ReadStarsInputs['gspcMap'];
  readonly conLookup: IauConstellationLookup;
  readonly inputHashes: FileHashes;
  readonly figureLines: ReadonlyMap<number, readonly (readonly number[])[]>;
  readonly componentDesignations: ReadonlyMap<number, ComponentDesignation>;
  readonly rowIndexMap: CatalogRowIndexMap;
  readonly resolvedPairs: readonly ResolvedPair[];
  readonly systemMembership: string;
  /** The registry's events and this run's. */
  readonly sidEvents: readonly EventRow[];
  readonly ledgers: {
    readonly parkedLedger: string;
    readonly simbadSourcedDistances: string;
  } & ReturnType<typeof registryTexts<typeof CATALOG_PARTITION>>;
  readonly lineage: {
    readonly placement: EmissionOf<typeof PLACEMENT_LINEAGE>;
    readonly brightnessColour: EmissionOf<typeof BRIGHTNESS_COLOUR_LINEAGE>;
    readonly size: EmissionOf<typeof SIZE_LINEAGE>;
    readonly coherence: EmissionOf<typeof COHERENCE_LINEAGE>;
    readonly promotion: EmissionOf<typeof PROMOTION_LINEAGE>;
    readonly overlap: EmissionOf<typeof OVERLAP_LINEAGE>;
    readonly allocation: EmissionOf<typeof ALLOCATION_LINEAGE>;
    readonly naming: EmissionOf<typeof NAMING_LINEAGE>;
  };
  /** Every stage's count block but the four this assembly tallies: records, search, boundaries, figures. */
  readonly stageCounts: readonly StageBlock<CatalogCountStage, CountValue>[];
}

/** Every CATALOG_OUTPUTS file, family member and check, ready for emitArtifacts; logs what it built. */
function assembleEmission({
  catalog, sortedKey, encoded, apsisMap, gspcMap, conLookup, inputHashes, figureLines, componentDesignations, rowIndexMap, resolvedPairs, systemMembership, sidEvents, ledgers, lineage,
  stageCounts,
}: CatalogEmissionInputs): Emission<CatalogOutputKey> {
  const stars = catalog.records;
  const totalLength = encoded.buffer.byteLength;
  const chunkBytes = planCatalogChunks(totalLength);
  const recordsThroughChunk = (i: number) => recordsInChunkPrefix(chunkBytes, i + 1, encoded.recordsOffset, stars.length);
  // What first paint actually gets. Pinned because it is the number the
  // progressive load's whole latency argument rests on, and it moves with
  // the name table's length as well as the chunk target.
  const recordsInFirstChunk = recordsThroughChunk(0);
  assertFigureVerticesInFirstChunk(figureLines, recordsInFirstChunk);
  const records = recordsCounts(stars, apsisMap, gspcMap, recordsInFirstChunk);
  // /src/catalog-format/record/README.md#on-disk-transport-chunking is measured from this line.
  const chunkRows = chunkBytes.map((_, i) => {
    const n = recordsThroughChunk(i);
    return `${i} ${n} records to V ${sortedKey[n - 1]?.toFixed(2) ?? '—'}`;
  });
  console.log(`  transport chunks — ${chunkRows.join(' · ')}`);
  const sidSuccessors = sidSuccessorPairs(sidEvents);
  const manifest: CatalogManifest = {
    chunkBytes,
    totalBytes: totalLength,
    ...(sidSuccessors.length > 0 ? { sidSuccessors } : {}),
  };
  const chunks = new Map<string, ArtifactContents>();
  let chunkOff = 0;
  for (let i = 0; i < chunkBytes.length; i++) {
    chunks.set(resolve(CATALOG_CHUNK_DIR, catalogChunkFilename(i)), new Uint8Array(encoded.buffer, chunkOff, chunkBytes[i]));
    chunkOff += chunkBytes[i];
  }

  const constellationsOut = CONSTELLATIONS.map((c, idx) => {
    const lines = figureLines.get(idx);
    return lines ? { ...c, lines } : { ...c };
  });

  // The fade quantiles are measured over the shipped population, so this
  // runs against the same `stars` the binary was written from.
  const boundaries = renderBoundaryArtifact(stars, conLookup);
  console.log(`Built ${CATALOG_OUTPUTS.files.boundaries} ${boundaryArtifactSummary(boundaries)}`);

  const search = buildSearchIndex(catalog, componentDesignations);
  const searchJson = JSON.stringify(search.entries) + '\n';

  const multiplesSha1 = handedFileHash(inputHashes, MULTIPLES_TSV.file);
  const rowIndexMapJson = serializeCatalogRowIndexSidecar(multiplesSha1, rowIndexMap);
  const pairEndsJson = serializeCatalogPairEnds(
    multiplesSha1, new Map(resolvedPairs.map((r) => [r.pair.systemId, r.rendered])),
  );
  console.log(
    `Row-index map ${CATALOG_OUTPUTS.files.rowIndexMap} (${Object.keys(rowIndexMap.byGaia).length} ` +
      `Gaia entries, ${Object.keys(rowIndexMap.byHip).length} HIP entries, ` +
      `${Object.keys(rowIndexMap.bySynth).length} synthetic entries); ` +
      `pair ends ${CATALOG_OUTPUTS.files.pairEnds} (${resolvedPairs.length} pairs)`,
  );

  const figures = figuresCounts(figureLines);
  const mb = (totalLength / 1024 / 1024).toFixed(2);
  console.log(
    `Built ${chunkBytes.length} catalog chunk(s) + ${CATALOG_OUTPUTS.files.manifest} ` +
      `(${mb} MB, ${stars.length} records, v${BINARY_VERSION})`,
  );
  console.log(
    `Built ${CATALOG_OUTPUTS.files.constellations} (${CONSTELLATIONS.length} constellations, ${figuresSummary(figures)})`,
  );
  console.log(`Built ${CATALOG_OUTPUTS.files.searchIndex} (${searchIndexSummary(search.counts, Buffer.byteLength(searchJson))})`);
  const sol = stars[SOL_RECORD_INDEX];
  console.log(`Sol at record index ${SOL_RECORD_INDEX} (absmag=${sol.absmag}, R=${sol.physicalRadius.toFixed(3)} R☉)`);
  console.log(apsisCoverageSummary(records));

  const stages = Object.values(lineage);
  return {
    outputs: CATALOG_OUTPUTS,
    files: {
      manifest: JSON.stringify(manifest) + '\n',
      constellations: JSON.stringify(constellationsOut) + '\n',
      boundaries: boundaries.json,
      searchIndex: searchJson,
      rowIndexMap: rowIndexMapJson,
      pairEnds: pairEndsJson,
      systemMembership,
      ...ledgers,
      ...lineage.placement.files,
      ...lineage.brightnessColour.files,
      ...lineage.size.files,
      ...lineage.coherence.files,
      ...lineage.promotion.files,
      ...lineage.overlap.files,
      ...lineage.allocation.files,
      ...lineage.naming.files,
    },
    members: new Map([...chunks, ...stages.flatMap((e) => [...e.members])]),
    checks: [
      ...stages.flatMap((e) => e.checks),
      buildCountsCheck([
        ...stageCounts,
        { stage: 'records', block: { kind: 'counted', counts: records } },
        { stage: 'search', block: { kind: 'counted', counts: search.counts } },
        { stage: 'boundaries', block: { kind: 'counted', counts: boundaries.counts } },
        { stage: 'figures', block: { kind: 'counted', counts: figures } },
      ]),
      distanceOutliersCheck(stars),
    ],
  };
}

function buildCountsCheck(blocks: readonly StageBlock<CatalogCountStage, CountValue>[]): Check {
  return countSnapshotCheck(BUILD_CATALOG_COUNTS, {
    actual: nestByStage(CATALOG_COUNT_STAGES, blocks),
    failureLabel: 'build-catalog count',
  });
}

function distanceOutliersCheck(stars: readonly Star[]): Check {
  const simbadSample = simbadSampleDistances(SIMBAD_SAMPLE.read());
  const report = buildRegressionReport(stars, simbadSample);
  console.log(
    `distance-regression: SIMBAD sample loaded (${simbadSample.size} keys); ` +
      `selfConsistency outliers=${report.selfConsistency.length}, ` +
      `SIMBAD outliers=${report.simbad.length}`,
  );

  return snapshotCheck(DISTANCE_OUTLIERS, {
    actual: report,
    refreshTransform: mergeReasonsFromSnapshot,
    compare: (expected, actual) => {
      const diff = compareRegressionReports(expected, actual);
      return {
        drifted: diff.some((d) => d.status !== 'unchanged'),
        report: formatRegressionDiff(diff),
      };
    },
    failureLabel: 'distance-regression',
  });
}

