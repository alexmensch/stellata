// Orchestrator for the catalog build; emits CATALOG_OUTPUTS (catalog-outputs.ts).
// See scripts/catalog/README.md.

import { resolve } from 'node:path';

import {
  BINARY_VERSION,
  catalogChunkFilename,
  planCatalogChunks,
  recordsInChunkPrefix,
  type CatalogManifest,
  SOL_RECORD_INDEX,
} from '../../src/catalog-format/record/catalog-pure';
import { buildHipToIndex, inferBinaries, wingEclipsingBinaries } from './multiplicity/binary-flags-pure';
import {
  multiplicityStatuses, multiplicitySummary, type MultiplicityCounts,
} from './multiplicity/multiplicity-stage-pure';
import { SIMBAD_OTYPE_MULTIPLE } from './spectral/spectral-resolve';
import { apparentVFromSol, assertSolFirst } from './record/record-order-pure';
import { buildSearchIndex, searchIndexSummary } from './record/search-index-pure';
import { apsisCoverageSummary, recordsCounts } from './record/records-stage-pure';
import { encodeCatalog, type EncodedCatalog } from './record/encode-catalog-pure';
import { avSolToStar } from './distance/dust/dust-deextinction-pure';
import {
  orbitChainExemption, overlapLabel, physicalOverlaps,
} from './companions/overlap-gate-pure';
import { BUILD_CATALOG_COUNTS } from './build-catalog-expected-json';
import { CATALOG_COUNT_STAGES, type CatalogCountStage } from './build-counts';
import { DISTANCE_OUTLIERS } from './distance/refinement/build-distance-outliers-expected-json';
import {
  buildRegressionReport,
  compareRegressionReports,
  formatRegressionDiff,
  mergeReasonsFromSnapshot,
  simbadSampleDistances,
} from './distance/refinement/distance-regression-check';
import {
  CONSTELLATIONS,
  assertFigureVerticesInFirstChunk,
  buildFigureLines,
  figuresCounts,
  figuresSummary,
} from './parse/constellations/constellations';
import { boundaryArtifactSummary, renderBoundaryArtifact } from './boundaries/build-boundaries-artifact';
import {
  applyDoublesFlag,
  collectPhysicalPairKeys,
  doublesEvidence,
  parseHipCcdm,
} from './multiplicity/visual-doubles';
import {
  isRecuratedAdoption,
  promoteCompanions,
  readMultiplesTsv,
  parkedRefusals,
  type MultiplesTsvRow,
  type PromotionDerivedCounts,
  type PromotionInputs,
} from './companions/companion-promotion';
import {
  PROMOTION_CODES, PROMOTION_INVARIANTS, PROMOTION_LINEAGE_BUDGET, promotionLineage, promotionSummary, type PromotionCounts,
} from './companions/promotion-lineage-pure';
import { identityText } from './lineage/identity/identity-pure';
import { LINEAGE_LAYOUT } from './lineage/lineage-layout-pure';
import { LineSpill } from './lineage/line-spill';
import {
  foldStageLines, lineageLineCode, stageLineageLine, type LineageLine,
} from './lineage/lineage-row-pure';
import { codeEffects, type StageCodes } from './lineage/reason-codes/reason-codes-pure';
import {
  countedStageLineage, namedStageRun, stageLineage, upstreamLineage, type NamedStage, type StageLineageEmission,
  type StageLineageRun,
} from './lineage/stage-lineage';
import {
  BRIGHTNESS_COLOUR_CODES, BRIGHTNESS_COLOUR_LINEAGE_BUDGET, brightnessColourLineageLines, brightnessColourSummary,
} from './photometry/brightness-colour-lineage-pure';
import { SIZE_CODES, SIZE_LINEAGE_BUDGET, sizeLineageLines } from './spectral/size-lineage-pure';
import {
  buildCatalogRowIndexMap,
  buildComponentDesignations,
  type ComponentDesignation,
  renderableOrbitRelations,
  resolvedMemberIndices,
  wingRenderablePrimaries,
} from './companions/record-index/record-index';
import { resolvePairs, type ResolvedPair } from './companions/record-index/pair-resolution-pure';
import { serializeCatalogPairEnds } from './companions/record-index/pair-ends-pure';
import {
  anchorMovedRecords, buildSystemMembership, lentDistanceRecords, systemMembershipSummary,
} from './system-membership/system-membership-pure';
import { serializeSystemMembership } from '../../src/catalog-format/system-membership/system-membership-format';
import { pairsFromRows } from '../binaries/pairs-pure';
import {
  serializeCatalogRowIndexSidecar, type CatalogRowIndexMap,
} from './companions/record-index/catalog-row-index-map-pure';
import { MULTIPLES_TSV } from '../binaries/multiples-tsv';
import {
  applySystemCoherence, systemCoherenceVerdicts, type SystemVerdict,
} from './multiplicity/system-coherence';
import {
  COHERENCE_CODES, COHERENCE_LINEAGE_BUDGET, coherenceLineageLines, coherenceSummary,
} from './multiplicity/coherence-lineage-pure';
import {
  bridgeGcvsByGaia,
  applyVariability,
  gcvsSummary,
} from './parse/gcvs/gcvs-parse';
import {
  applyDesignationConstellations,
  loadDesignationConstellationIndex,
} from './classic-ids/apply-designation-constellation';
import {
  applyStarNames,
  loadStarNamingInputs,
  starNamingSummary,
} from './naming/apply-star-names';
import { assignDisplayNames, type NamedRecord, type NamingDerivedCounts } from './naming/display-names';
import {
  NAMING_CODES, NAMING_INVARIANTS, NAMING_LINEAGE_BUDGET, namingLineageLines, namingSummary, type NamingCounts,
} from './naming/naming-lineage-pure';
import { readStars, type ReadStarsOptions, type Star } from './parse/stars-parse';
import { walkVelocitySummary } from './parse/walk-stats-pure';
import { PARKED_LEDGER } from './distance/parallax/parked-ledger-tsv';
import {
  PLACEMENT_CODES, PLACEMENT_INVARIANTS, PLACEMENT_LINEAGE_BUDGET, parkedLedgerView, placementLineageLines,
} from './distance/placement-lineage-pure';
import { placementSummary } from './distance/placement-counts-pure';
import {
  SIMBAD_SOURCED_DISTANCES,
} from './distance/parallax/simbad-sourced-ledger-tsv';
import { loadReadStarsInputs, type ReadStarsInputs } from './parse/read-stars-inputs';
import type { IauConstellationLookup } from '../../src/astro-core/iau-geometry/iau-boundaries-pure';
import { GAIA_HIP_XMATCH } from './parse/gaia-hip-xmatch-source';
import { STELLARIUM } from './parse/constellations/stellarium-source';
import { GCVS, GCVS_CROSSID } from './parse/gcvs/gcvs-source';
import { HIP_CCDM } from './multiplicity/hip-ccdm-source';
import { NAME_OVERRIDES } from './naming/name-overrides-source';
import { SIMBAD_SAMPLE } from './validate/simbad-sample-source';
import { MEMBERSHIP_MANIFEST, manifestDesignations } from './membership/membership-manifest-tsv';
import { artifactRows } from '../util/sources/source';
import type { FileHashes } from '../util/build-stamp';
import { handedFileHash, stepInputHashes } from '../util/step-input-hashes';
import {
  CATALOG_CHUNK_DIR, CATALOG_OUTPUTS,
} from './catalog-outputs';
import {
  emitArtifacts, sweepStaged, type ArtifactContents, type Check, type Emission,
} from '../util/emit-artifacts';
import { countSnapshotCheck, snapshotCheck } from '../util/snapshot-check';
import { derivedStage, nestByStage, type CountValue, type StageBlock } from '../util/counts/count-stages-pure';
import { watchHeap } from '../util/heap-budget/heap-budget';
import { syntheticGaiaBridges } from '../sid/sid-pure';
import { sidSuccessorPairs, type EventRow } from '../sid/events-pure';
import { allocate } from '../sid/allocate-pure';
import {
  ALLOCATION_CODES, ALLOCATION_LINEAGE_BUDGET, allocationSidRows, allocationSidsText,
  allocationLineageRows, allocationSummary,
} from '../sid/allocation-lineage-pure';
import { catalogSidObjects } from '../sid/catalog-objects';
import { inPartition } from '../sid/registry-partitions-pure';
import { catalogUpstream } from '../sid/catalog-upstream';
import { synthChurnReport } from '../sid/synth-churn-pure';
import { allocationRun, loadRegistry, registryTexts } from '../sid/registry-io';
import { loadStoredEdges } from '../sid/stored-edges';
import { CATALOG_PARTITION } from '../../src/catalog-format/pipeline-outputs/data-files';
import {
  PROMOTION_LINEAGE, PLACEMENT_LINEAGE, COHERENCE_LINEAGE, ALLOCATION_LINEAGE, ALLOCATION_SIDS_STEM, MEMBERSHIP_LINEAGE,
  NAMING_LINEAGE, BRIGHTNESS_COLOUR_LINEAGE, SIZE_LINEAGE, type StageLineageSpec,
} from '../../src/catalog-format/pipeline-outputs/lineage-files';

type CatalogOutputKey = keyof (typeof CATALOG_OUTPUTS)['files'] & string;

const UPSTREAM_LINEAGE = upstreamLineage(LINEAGE_LAYOUT, [MEMBERSHIP_LINEAGE]);

type CatalogStage<F extends string, S extends F, C extends StageCodes<string, S>> = NamedStage<F, S, C>;

function catalogStageRun<F extends string, S extends F, C extends StageCodes<string, S>>(
  stage: CatalogStage<F, S, C>,
): StageLineageRun<F, S> {
  return namedStageRun({ ...stage, upstream: UPSTREAM_LINEAGE });
}

function catalogStageLineage<F extends string, S extends F, C extends StageCodes<string, S>>(stage: CatalogStage<F, S, C>) {
  return stageLineage(catalogStageRun(stage));
}

function catalogCountedStageLineage<F extends string, S extends F, B extends string, L extends B>(
  stage: CatalogStage<F, S, StageCodes<B, S, L>>,
) {
  return countedStageLineage(catalogStageRun(stage), stage.codes);
}

// A function of its own so the walk's lines are unreachable once it returns:
// inlined into main, they outlive the walk and the build runs out of heap.
function walkManifest(inputs: ReadStarsOptions, stepInputs: FileHashes) {
  let placementLines: LineageLine[] = [];
  const brightnessSpill = new LineSpill();
  try {
    const sizeSpill = new LineSpill();
    try {
      const manifestFounded = new Set<string>();
      const manifest = function* () {
        for (const r of artifactRows(MEMBERSHIP_MANIFEST)) {
          for (const d of manifestDesignations(r)) manifestFounded.add(d);
          yield r;
        }
      };
      const { stars, stats } = readStars(manifest(), inputs, (outcome) => {
        for (const line of placementLineageLines(outcome.placement)) placementLines.push(line);
        if (outcome.brightness !== null) for (const line of brightnessColourLineageLines(outcome.brightness)) brightnessSpill.push(line);
        if (outcome.kind === 'shipped') for (const line of sizeLineageLines(outcome.size)) sizeSpill.push(line);
      });
      const parkedLedger = parkedLedgerTsv(placementLines);
      const placementRemovals = placementLines.filter((line) => PLACEMENT_EFFECTS.get(lineageLineCode(line)) !== 'none');
      const placementEmission = catalogCountedStageLineage({
        spec: PLACEMENT_LINEAGE, codes: PLACEMENT_CODES, lines: () => placementLines,
        budget: PLACEMENT_LINEAGE_BUDGET, invariants: PLACEMENT_INVARIANTS, inputs: stepInputs,
      });
      // Released before brightness-colour's lines are read back, or both stages' lines are held at once.
      placementLines = [];
      const brightnessEmission = catalogCountedStageLineage({
        spec: BRIGHTNESS_COLOUR_LINEAGE, codes: BRIGHTNESS_COLOUR_CODES, lines: () => brightnessSpill.lines(),
        budget: BRIGHTNESS_COLOUR_LINEAGE_BUDGET, invariants: [], inputs: stepInputs,
      });
      const sizeEmission = catalogStageLineage({
        spec: SIZE_LINEAGE, codes: SIZE_CODES, lines: () => sizeSpill.lines(),
        budget: SIZE_LINEAGE_BUDGET, invariants: [], inputs: stepInputs,
      });
      return { stars, stats, parkedLedger, placementEmission, brightnessEmission, sizeEmission, manifestFounded, placementRemovals };
    } finally {
      sizeSpill.dispose();
    }
  } finally {
    brightnessSpill.dispose();
  }
}

const PLACEMENT_EFFECTS = codeEffects([PLACEMENT_CODES]);

// A function of its own so its line per record is unreachable once it returns:
// inlined into main, the lines outlive promotion and raise the build's peak heap.
function coherenceLineage(verdicts: readonly SystemVerdict[], stars: readonly Star[], stepInputs: FileHashes) {
  return catalogCountedStageLineage({
    spec: COHERENCE_LINEAGE, codes: COHERENCE_CODES, lines: () => coherenceLineageLines(verdicts, stars),
    budget: COHERENCE_LINEAGE_BUDGET, invariants: [], inputs: stepInputs,
  });
}

// A function of its own so its lines are unreachable once it returns, as coherence's are.
function namingLineage(records: readonly NamedRecord[], stars: readonly Star[], stepInputs: FileHashes) {
  return catalogCountedStageLineage({
    spec: NAMING_LINEAGE, codes: NAMING_CODES, lines: () => namingLineageLines(records, stars, CONSTELLATIONS),
    budget: NAMING_LINEAGE_BUDGET, invariants: NAMING_INVARIANTS, inputs: stepInputs,
  });
}

// A function of its own so promotion's rows and rewrites are unreachable once
// it returns, leaving only its lines, as coherence's and naming's are.
function promoteAndTrace(
  multiplesRows: MultiplesTsvRow[], stars: Star[], inputs: PromotionInputs, founded: ReadonlySet<string>,
) {
  const { newStars, stats, rows, rewrites } = promoteCompanions(multiplesRows, stars, inputs);
  for (const ns of newStars) stars.push(ns);
  const { lineage, identity } = promotionLineage(rows, stars, founded, rewrites);
  return {
    stats, identity, lines: lineage.map((row) => stageLineageLine(PROMOTION_CODES, row)),
    decidedRows: rows.length, secondaryRows: rows.filter((r) => r.via === 'secondary').length,
    recuratedRecords: rows.flatMap(({ outcome: o }) => (isRecuratedAdoption(o) ? [stars[o.idx]] : [])),
  };
}

function parkedLedgerTsv(placementLines: readonly LineageLine[]): string {
  const parked = parkedLedgerView(placementLines);
  console.log(`  parked (record parity): ${parked.length} → ${PARKED_LEDGER.file}`);
  return PARKED_LEDGER.serialize(parked);
}

/** Validation independence (/docs/catalog-driver.md#5-per-field-cascades-and-rescue-tiers), made checkable: a record whose distance came
 *  from the SIMBAD tier cannot be verified against SIMBAD's own parallax, so
 *  the sample validator needs to know which records those are. It reads
 *  catalog.bin, which carries no `distVia`, hence the file. */
function simbadSourcedDistancesTsv(stars: readonly Star[]): string {
  const rows = stars
    .filter((s) => s.distVia === 'simbad_plx')
    .map((s) => ({ gaiaSourceId: s.gaiaSourceId, hip: s.hip }));
  console.log(
    `  SIMBAD-sourced distances: ${rows.length} → ${SIMBAD_SOURCED_DISTANCES.file}`,
  );
  return SIMBAD_SOURCED_DISTANCES.serialize(rows);
}

// A function of its own so the reference tables are unreachable once it returns:
// held through SID allocation, encoding and emission, the build runs out of heap.
async function preAllocationStages(inputHashesAtStart: FileHashes) {
  const inputs = await loadReadStarsInputs();
  const {
    bailerJones, apsisMap, simbadSpectral, directions,
    dustGrid, conAssignment,
  } = inputs;

  console.log(`Reading ${MEMBERSHIP_MANIFEST.file}...`);
  const t0 = Date.now();
  const {
    stars, stats, parkedLedger, placementEmission, brightnessEmission, sizeEmission, manifestFounded, placementRemovals,
  } = walkManifest(inputs, inputHashesAtStart);
  console.log(`  parsed ${stats.total} rows in ${Date.now() - t0}ms`);
  console.log(`  kept ${stars.length} stars; parked ${stats.parked.length}`);
  console.log(placementSummary(placementEmission.counts, stats.placementDerived));
  console.log(brightnessColourSummary(brightnessEmission.counts));
  console.log(walkVelocitySummary(stats));
  const simbadSourcedDistances = simbadSourcedDistancesTsv(stars);

  // The labels are the manifest's (/docs/catalog-driver.md#31-retiring-the-spine--the-membership-rule-measured-against-the-primaries); what the
  // classic-ID tables still supply per record is IV/27A's constellation for
  // each Bayer / Flamsteed designation.
  console.log('Resolving designation constellations from IV/27A...');
  applyDesignationConstellations(stars, loadDesignationConstellationIndex());

  // Naming ladder, authority half: the IAU WGSN approved name and the
  // glyph-bearing Bayer / Gould designations, keyed on the record's
  // identifiers. Composition itself is post-sort, once every promoted record
  // exists and its component letter is known.
  console.log('Applying the IAU WGSN naming ladder...');
  const starNamingCounts = applyStarNames(stars, loadStarNamingInputs(), CONSTELLATIONS);
  console.log(starNamingSummary(starNamingCounts));

  // Companion promotion — read data/binaries/multiples.tsv and add
  // first-class catalog records for the secondary of every physical pair
  // whose identifier isn't already a record. Promoted companions ride
  // catalog.bin with FLAG_BINARY_COMPANION_ONLY set; the renderer/picker
  // hover/focus stack picks them up with zero code change.
  const multiplesRows = readMultiplesTsv();
  const synthGaiaBridges = syntheticGaiaBridges(loadStoredEdges());
  // Intra-system radial coherence BEFORE promotion, so minted members
  // project off already-coherent anchor positions.
  const coherenceVerdicts = systemCoherenceVerdicts(multiplesRows, stars, {
    gaiaAstrometry: directions.gaiaAstrometry,
    hip2: directions.hip2,
    bailerJones,
  });
  const coherenceEmission = coherenceLineage(coherenceVerdicts, stars, inputHashesAtStart);
  applySystemCoherence(stars, coherenceVerdicts);
  console.log(coherenceSummary(coherenceEmission.counts));
  console.log('Promoting binary companions from multiples.tsv...');
  const tProm = Date.now();
  const {
    stats: ps, lines: promotionLines, identity: promotionIdentity, decidedRows, secondaryRows, recuratedRecords,
  } = promoteAndTrace(multiplesRows, stars, {
    conAssignment, dustGrid, parked: parkedRefusals(stats.parked),
    gaiaAstrometry: directions.gaiaAstrometry, synthGaiaBridges,
  }, manifestFounded);
  const promotionCounts = foldStageLines(PROMOTION_CODES, promotionLines);
  const anchorMoved = anchorMovedRecords(stars, coherenceVerdicts, recuratedRecords);
  console.log(`  promotion decided ${decidedRows} rows in ${Date.now() - tProm}ms`);

  // Sort by apparent V from Sol ascending (brightest-looking first), so any
  // prefix of the record array is a usable sky and the transport chunks can
  // stream one (/src/catalog-format/record/README.md#record-order). Record indices are final
  // after this point.
  const sortKey = new Float64Array(stars.length);
  for (let i = 0; i < stars.length; i++) {
    const s = stars[i];
    const v = apparentVFromSol(s, avSolToStar(dustGrid, s.x, s.y, s.z));
    // On the key, before the sort — /src/catalog-format/record/README.md#record-order.
    if (!Number.isFinite(v)) {
      throw new Error(`Record ${i} has a non-finite apparent V sort key: ${v}`);
    }
    sortKey[i] = v;
  }
  const order = Array.from(stars.keys()).sort((a, b) => sortKey[a] - sortKey[b]);
  const sorted = order.map((i) => stars[i]);
  for (let i = 0; i < sorted.length; i++) stars[i] = sorted[i];
  assertSolFirst(stars);

  const hipToIndex = buildHipToIndex(stars);

  // Throws if a referenced HIP is missing from the catalog.
  const figureLines = buildFigureLines(STELLARIUM.read(), hipToIndex);

  // Geometric binary inference.
  console.log('Inferring binary/multiple systems...');
  const tBin = Date.now();
  const binaries = inferBinaries(stars);
  console.log(`  in ${Date.now() - tBin}ms`);

  // GCVS variable-star cross-match. xref.byGaia is bridged from byHip via
  // gaia_dr3_hip_xmatch.tsv, so records that carry a gaia_source_id but no
  // HIP still resolve.
  console.log('Parsing GCVS variable-star catalogue...');
  const tGcvs = Date.now();
  const gcvsData = GCVS.read();
  const xref = GCVS_CROSSID.read();
  const tX = Date.now();
  const hipToGaia = GAIA_HIP_XMATCH.read();
  console.log(
    `  Gaia DR3 ↔ HIP cross-walk: ${hipToGaia.size} entries in ${Date.now() - tX}ms`,
  );
  bridgeGcvsByGaia(xref, hipToGaia);

  const gcvsCounts = applyVariability(stars, gcvsData, xref);
  console.log(`  ${gcvsSummary(gcvsCounts)} in ${Date.now() - tGcvs}ms`);

  // Hipparcos CCDM double-star cross-match. Marks a primary on
  // the same FLAG_BINARY_PRIMARY bit the geometric pass uses, picking
  // exactly one primary per CCDM system so chart-mode wings surface both
  // sources without double-flagging components of the same system.
  console.log('Parsing Hipparcos CCDM double-star cross-reference...');
  const tCcdm = Date.now();
  const doubles = doublesEvidence(parseHipCcdm(HIP_CCDM.read()), collectPhysicalPairKeys(multiplesRows), hipToIndex);
  const ccdm = applyDoublesFlag(stars, doubles);
  console.log(`  in ${Date.now() - tCcdm}ms`);

  const eclipsing = wingEclipsingBinaries(stars);

  const rowIndexMap = buildCatalogRowIndexMap(stars, synthGaiaBridges);
  const resolvedPairs = resolvePairs(pairsFromRows(multiplesRows), rowIndexMap);

  const renderableWings = wingRenderablePrimaries(resolvedPairs, stars);

  const overlaps = physicalOverlaps(stars, orbitChainExemption(renderableOrbitRelations(resolvedPairs)));
  const promotionDerived: PromotionDerivedCounts = { ...ps, physicalOverlaps: overlaps.length };
  console.log(promotionSummary(
    promotionCounts, promotionDerived, secondaryRows,
  ));
  console.log(`  physical overlaps outside an orbit chain: ${overlaps.length}`);
  for (const [a, b] of overlaps) {
    console.log(`    ${overlapLabel(stars[a], a)} | ${overlapLabel(stars[b], b)}`);
  }

  const { designations: componentDesignations, ...componentCount } = buildComponentDesignations(resolvedPairs);
  const statuses = multiplicityStatuses(
    stars, resolvedMemberIndices(resolvedPairs), (sourceId) => simbadSpectral.bySourceId.get(sourceId)?.otype === SIMBAD_OTYPE_MULTIPLE,
  );
  const multiplicityStatus = statuses.status;
  // Serialized here so the tree objects are not held through emission (the CI heap budget).
  const systems = (() => {
    const result = buildSystemMembership({
      records: stars, multiplicityStatus, wdsPairs: resolvedPairs, doubles,
      geometricPairs: binaries.mutual, lentDistance: lentDistanceRecords(stars, anchorMoved),
    });
    return { json: serializeSystemMembership(result.membership), counts: result.counts };
  })();
  console.log(`  ${systemMembershipSummary(systems.counts)}`);
  const multiplicity: MultiplicityCounts = {
    ...binaries.counts, ...ccdm, ...eclipsing, ...renderableWings,
    ...componentCount, ...statuses.counts, ...systems.counts,
  };
  console.log(`  ${multiplicitySummary(multiplicity)}`);

  return {
    stars,
    sortedKey: order.map((i) => sortKey[i]),
    apsisMap,
    gspcMap: inputs.gspcMap,
    conLookup: conAssignment.lookup,
    inputsCounts: inputs.counts,
    parkedLedger, simbadSourcedDistances,
    placementEmission, brightnessEmission, sizeEmission, coherenceEmission, placementRemovals,
    placementDerived: stats.placementDerived,
    starNamingCounts, multiplesRows, promotionLines, promotionIdentity, promotionCounts, promotionDerived,
    figureLines, gcvsCounts, componentDesignations, rowIndexMap, resolvedPairs, multiplicityStatus, multiplicity,
    systemMembership: systems.json,
  };
}

export async function main() {
  const heap = watchHeap('build:catalog');
  sweepStaged(CATALOG_OUTPUTS);
  const inputHashesAtStart = stepInputHashes();

  const built = await preAllocationStages(inputHashesAtStart);
  const { stars, promotionLines, promotionIdentity } = built;

  const registry = loadRegistry();
  const sidObjects = catalogSidObjects(stars);
  const allocation = allocate({
    objects: sidObjects,
    storedEdges: registry.storedEdges,
    ledger: registry.ledger,
    events: registry.events,
    scope: inPartition(CATALOG_PARTITION),
    ...allocationRun(),
  }, catalogUpstream({ placementRemovals: built.placementRemovals, promotion: promotionLines, promotionIdentity }));
  if (allocation.kind === 'failed') {
    const synthOrphans = allocation.unexplained.flatMap((k) => (k.startsWith('synth:') ? [k.slice('synth:'.length)] : []));
    const liveSynth = sidObjects.flatMap((o) => o.designations.flatMap((d) => (d.startsWith('synth:') ? [d.slice('synth:'.length)] : [])));
    throw new Error(
      `SID allocation failed for ${allocation.errors.length} object(s):\n  ${allocation.errors.join('\n  ')}`
        + (synthOrphans.length === 0 ? '' : `\n${synthChurnReport(synthOrphans, liveSynth, built.multiplesRows)}`),
    );
  }
  for (const { designation, objects } of allocation.ambiguous) {
    console.log(`ambiguous (dropped): ${designation} names ${objects.length} objects — ${objects.map((i) => sidObjects[i].label).join(' | ')}`);
  }
  const recordSids = allocation.outcomes.slice(0, stars.length).map((o) => o.sid);

  // Naming ladder, composition half. Runs here because it needs every
  // record final: the promoted companions exist, indices are sorted, each
  // component's WDS root anchor resolves through the row-index map, and the
  // SIDs the override table keys on are known. Writes `proper` for the NAME
  // tiers alone — the runtime composes every designation off the search
  // index through the same pure function (/docs/star-naming.md#6-rendering--glyphs-everywhere-no-fallback-path).
  const display = assignDisplayNames(
    stars, built.componentDesignations, CONSTELLATIONS, NAME_OVERRIDES.read(), recordSids,
  );
  const namingEmission = namingLineage(display.records, stars, inputHashesAtStart);

  const promotionEmission = catalogStageLineage({
    spec: PROMOTION_LINEAGE, codes: PROMOTION_CODES, lines: () => promotionLines,
    siblings: () => ({ 'promotion.identity': identityText(promotionIdentity) }),
    budget: PROMOTION_LINEAGE_BUDGET, invariants: PROMOTION_INVARIANTS, inputs: inputHashesAtStart,
  });
  const allocationEmission = catalogCountedStageLineage({
    spec: ALLOCATION_LINEAGE, codes: ALLOCATION_CODES,
    lines: () => allocationLineageRows(sidObjects, allocation).map((row) => stageLineageLine(ALLOCATION_CODES, row)),
    siblings: () => ({ [ALLOCATION_SIDS_STEM]: allocationSidsText(allocationSidRows(sidObjects, allocation.outcomes)) }),
    budget: ALLOCATION_LINEAGE_BUDGET, invariants: [], inputs: inputHashesAtStart,
  });
  console.log(allocationSummary(allocationEmission.counts, allocation.events.length));

  const encoded = encodeCatalog({
    stars, apsisMap: built.apsisMap, sids: recordSids, multiplicityStatus: built.multiplicityStatus,
  });
  const namingDerived: NamingDerivedCounts = { ...display.counts, nameTableEntries: encoded.nameTableEntries };
  console.log(namingSummary(namingEmission.counts, namingDerived));

  emitArtifacts(catalogEmission({
    stars,
    sortedKey: built.sortedKey,
    encoded,
    apsisMap: built.apsisMap,
    gspcMap: built.gspcMap,
    conLookup: built.conLookup,
    inputHashes: inputHashesAtStart,
    figureLines: built.figureLines,
    componentDesignations: built.componentDesignations,
    rowIndexMap: built.rowIndexMap,
    resolvedPairs: built.resolvedPairs,
    systemMembership: built.systemMembership,
    sidEvents: [...registry.events, ...allocation.events],
    ledgers: {
      parkedLedger: built.parkedLedger,
      simbadSourcedDistances: built.simbadSourcedDistances,
      ...registryTexts(CATALOG_PARTITION, allocation.minted, allocation.events),
    },
    lineage: {
      placement: built.placementEmission,
      brightnessColour: built.brightnessEmission,
      size: built.sizeEmission,
      coherence: built.coherenceEmission,
      promotion: promotionEmission,
      allocation: allocationEmission,
      naming: namingEmission,
    },
    stageCounts: [
      { stage: 'inputs', block: { kind: 'counted', counts: built.inputsCounts } },
      { stage: 'placement', block: { kind: 'counted', counts: built.placementEmission.counts } },
      { stage: derivedStage('placement'), block: { kind: 'counted', counts: built.placementDerived } },
      { stage: 'multiplicity', block: { kind: 'counted', counts: built.multiplicity } },
      { stage: 'gcvs', block: { kind: 'counted', counts: built.gcvsCounts } },
      { stage: 'allocation', block: { kind: 'counted', counts: allocationEmission.counts } },
      { stage: 'naming', block: { kind: 'counted', counts: { ...namingEmission.counts, ...built.starNamingCounts } satisfies NamingCounts } },
      { stage: derivedStage('naming'), block: { kind: 'counted', counts: namingDerived } },
      { stage: 'brightness-colour', block: { kind: 'counted', counts: built.brightnessEmission.counts } },
      { stage: 'coherence', block: { kind: 'counted', counts: built.coherenceEmission.counts } },
      { stage: 'promotion', block: { kind: 'counted', counts: built.promotionCounts satisfies PromotionCounts } },
      { stage: derivedStage('promotion'), block: { kind: 'counted', counts: built.promotionDerived } },
    ],
    heap,
  }));
}

type EmissionOf<T> = T extends StageLineageSpec<infer F, infer S> ? StageLineageEmission<F, S> : never;

interface CatalogEmissionInputs {
  /** Sorted: record order. */
  readonly stars: readonly Star[];
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
    readonly allocation: EmissionOf<typeof ALLOCATION_LINEAGE>;
    readonly naming: EmissionOf<typeof NAMING_LINEAGE>;
  };
  /** Every stage's count block but the four this assembly tallies: records, search, boundaries, figures. */
  readonly stageCounts: readonly StageBlock<CatalogCountStage, CountValue>[];
  readonly heap: { check(): Check };
}

/** Every CATALOG_OUTPUTS file, family member and check, ready for emitArtifacts; logs what it built. */
function catalogEmission({
  stars, sortedKey, encoded, apsisMap, gspcMap, conLookup, inputHashes, figureLines, componentDesignations, rowIndexMap, resolvedPairs, systemMembership, sidEvents, ledgers, lineage,
  stageCounts, heap,
}: CatalogEmissionInputs): Emission<CatalogOutputKey> {
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

  const search = buildSearchIndex(stars, componentDesignations);
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
      heap.check(),
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

