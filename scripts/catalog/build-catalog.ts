// Orchestrator for the catalog build; emits CATALOG_OUTPUTS (catalog-outputs.ts).
// See scripts/catalog/README.md.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  HEADER_SIZE,
  RECORD_SIZE,
  BINARY_VERSION,
  NO_COMPANION,
  NO_GAIA_SOURCE_ID,
  NO_APSIS,
  NO_CONSTELLATION_INDEX,
  APSIS_FIELDS,
  type ApsisField,
  writeStarRecord,
  writeCatalogHeader,
  encodeNameTable,
  catalogChunkFilename,
  planCatalogChunks,
  recordsInChunkPrefix,
  type CatalogManifest,
  DIST_VIA_VALUES,
  SOL_RECORD_INDEX,
} from '../../src/catalog-format/record/catalog-pure';
import { encodeSpectralBytes } from '../../src/catalog-format/spectral/spectral-record-bytes';
import { buildHipToIndex, inferBinaries, wingEclipsingBinaries } from './multiplicity/binary-flags-pure';
import {
  multiplicityStatuses, multiplicitySummary, type MultiplicityCounts,
} from './multiplicity/multiplicity-stage-pure';
import { SIMBAD_OTYPE_MULTIPLE } from './spectral/spectral-resolve';
import { apparentVFromSol, assertSolFirst } from './record/record-order-pure';
import { buildSearchIndex, searchIndexSummary } from './record/search-index-pure';
import { apsisCoverageSummary, recordsCounts, variabilityUnits } from './record/records-stage-pure';
import { avSolToStar } from './distance/dust/dust-deextinction-pure';
import {
  orbitChainExemption, overlapLabel, physicalOverlaps,
} from './companions/overlap-gate-pure';
import {
  BUILD_COUNTS_EXPECTED_FILE,
  CATALOG_COUNT_STAGE,
  CATALOG_COUNT_STAGES,
  compareCountSnapshot,
  formatPartition,
  type CatalogCountStage,
  type FiledCounts,
} from './build-counts';
import { DIST_VIA_COUNT_KEY } from './distance/parallax/parallax-cascade';
import {
  buildRegressionReport,
  compareRegressionReports,
  formatRegressionDiff,
  mergeReasonsFromSnapshot,
  simbadSampleDistances,
  type RegressionReport,
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
  parseHipCcdm,
} from './multiplicity/visual-doubles';
import {
  promoteCompanions,
  readMultiplesTsv,
  parkedRefusals,
  RECURATED_BRIGHTNESS,
} from './companions/companion-promotion';
import { PROMOTION_CODES, PROMOTION_LINEAGE_BUDGET, promotionLineage } from './companions/promotion-lineage-pure';
import { identityText } from './lineage/identity-pure';
import { LINEAGE_LAYOUT } from './lineage/lineage-layout-pure';
import { LineSpill } from './lineage/line-spill';
import {
  lineageLineCode, stageLineageLine, stageLineageText, type LineageLine,
} from './lineage/lineage-row-pure';
import { codeEffects, type StageCodes } from './lineage/reason-codes/reason-codes-pure';
import {
  countedStageLineage, stageLineage, upstreamLineage, type LineageBudget, type StageLineageRun,
} from './lineage/stage-lineage';
import type { LineageInvariant } from './lineage/lineage-invariant-pure';
import {
  BRIGHTNESS_COLOUR_CODES, BRIGHTNESS_COLOUR_LINEAGE_BUDGET, brightnessColourLineageLines, brightnessColourSummary,
} from './photometry/brightness-colour-lineage-pure';
import { SIZE_CODES, SIZE_LINEAGE_BUDGET, sizeLineageLines } from './spectral/size-lineage-pure';
import {
  buildCatalogRowIndexMap,
  buildComponentDesignations,
  renderableOrbitRelations,
  wingRenderablePrimaries,
} from './companions/record-index/record-index';
import { serializeCatalogRowIndexSidecar } from './companions/record-index/catalog-row-index-map-pure';
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
import { VELOCITY_SANITY_CEILING_KM_S, GALACTIC_ESCAPE_VELOCITY_KM_S } from './distance/velocity';
import { RV_ERROR_BANDS } from './distance/radial-velocity/radial-velocity';
import { emptyTallyPartition } from '../util/counts/tally-pure';
import {
  applyDesignationConstellations,
  loadDesignationConstellationInputs,
} from './classic-ids/apply-designation-constellation';
import {
  applyStarNames,
  loadStarNamingInputs,
} from './naming/apply-star-names';
import { assignDisplayNames, type NamedRecord } from './naming/display-names';
import { NAMING_CODES, NAMING_INVARIANTS, NAMING_LINEAGE_BUDGET, namingLineageLines } from './naming/naming-lineage-pure';
import { readStars, type ReadStarsOptions, type Star } from './parse/stars-parse';
import {
  PARKED_COUNT_KEY,
  PARKED_REASONS,
} from './distance/parallax/parked-ledger-pure';
import { PARKED_LEDGER } from './distance/parallax/parked-ledger-tsv';
import {
  PLACEMENT_CODES, PLACEMENT_INVARIANTS, PLACEMENT_LINEAGE_BUDGET, parkedLedgerView, placementLineageLines,
} from './distance/placement-lineage-pure';
import {
  SIMBAD_SOURCED_DISTANCES,
} from './distance/parallax/simbad-sourced-ledger-tsv';
import { loadReadStarsInputs } from './parse/read-stars-inputs';
import { GAIA_HIP_XMATCH } from './parse/gaia-hip-xmatch-source';
import { STELLARIUM } from './parse/constellations/stellarium-source';
import { GCVS, GCVS_CROSSID } from './parse/gcvs/gcvs-source';
import { HIP_CCDM } from './multiplicity/hip-ccdm-source';
import { NAME_OVERRIDES } from './naming/name-overrides-source';
import { SIMBAD_SAMPLE } from './validate/simbad-sample-source';
import { MEMBERSHIP_MANIFEST, manifestDesignations } from './membership/membership-manifest-tsv';
import { artifactRows } from '../util/sources/source';
import { REPO_ROOT as ROOT } from '../util/paths';
import type { FileHashes } from '../util/build-stamp';
import { handedFileHash, stepInputHashes } from '../util/step-input-hashes';
import {
  CATALOG_CHUNK_DIR, CATALOG_OUTPUTS,
} from './catalog-outputs';
import {
  emitArtifacts, sweepStaged, type ArtifactContents, type Check,
} from '../util/emit-artifacts';
import { snapshotCheck } from '../util/snapshot-check';
import { nestByStage, type StageBlock, type StagedCounts } from '../util/counts/count-stages-pure';
import { watchHeap } from '../util/heap-budget/heap-budget';
import { syntheticGaiaBridges } from '../sid/sid-pure';
import { sidSuccessorPairs } from '../sid/events-pure';
import { allocate } from '../sid/allocate-pure';
import {
  ALLOCATION_CODES, ALLOCATION_LINEAGE_BUDGET, allocationSidRows, allocationSidsText,
  allocationLineageRows,
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const UPSTREAM_LINEAGE = upstreamLineage(LINEAGE_LAYOUT, [MEMBERSHIP_LINEAGE]);

const EXPECTED_COUNTS = resolve(ROOT, BUILD_COUNTS_EXPECTED_FILE);
const EXPECTED_OUTLIERS = resolve(
  __dirname,
  'distance/refinement/build-distance-outliers-expected.json',
);

/** A build:catalog stage whose lineage is one file named for the stage. */
function catalogStageRun<S extends string>(
  spec: StageLineageSpec<S, S>, codes: StageCodes<string, NoInfer<S>>, lines: () => readonly LineageLine[],
  budget: LineageBudget, invariants: readonly LineageInvariant[], stepInputs: FileHashes,
): StageLineageRun<S, S> {
  return {
    layout: LINEAGE_LAYOUT,
    spec,
    inputs: stepInputs,
    diffed: spec.stage,
    lines,
    render: (sorted) => ({ [spec.stage]: stageLineageText(codes, sorted) }) as Record<S, Uint8Array>,
    joins: () => [],
    budget,
    invariants,
    argv: process.argv.slice(2),
    upstream: UPSTREAM_LINEAGE,
  };
}

function catalogStageLineage<S extends string>(...run: Parameters<typeof catalogStageRun<S>>) {
  return stageLineage(catalogStageRun(...run));
}

function catalogCountedStageLineage<S extends string, B extends string, L extends B>(
  spec: StageLineageSpec<S, S>, codes: StageCodes<B, S, L>,
  ...rest: Parameters<typeof catalogStageRun<S>> extends [unknown, unknown, ...infer R] ? R : never
) {
  return countedStageLineage(catalogStageRun(spec, codes, ...rest), codes);
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
      const placementEmission = catalogStageLineage(
        PLACEMENT_LINEAGE, PLACEMENT_CODES, () => placementLines, PLACEMENT_LINEAGE_BUDGET, PLACEMENT_INVARIANTS, stepInputs,
      );
      // Released before brightness-colour's lines are read back, or both stages' lines are held at once.
      placementLines = [];
      const brightnessEmission = catalogCountedStageLineage(
        BRIGHTNESS_COLOUR_LINEAGE, BRIGHTNESS_COLOUR_CODES, () => brightnessSpill.lines(), BRIGHTNESS_COLOUR_LINEAGE_BUDGET, [],
        stepInputs,
      );
      const sizeEmission = catalogStageLineage(
        SIZE_LINEAGE, SIZE_CODES, () => sizeSpill.lines(), SIZE_LINEAGE_BUDGET, [], stepInputs,
      );
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
  return catalogCountedStageLineage(
    COHERENCE_LINEAGE, COHERENCE_CODES, () => coherenceLineageLines(verdicts, stars), COHERENCE_LINEAGE_BUDGET, [],
    stepInputs,
  );
}

// A function of its own so its lines are unreachable once it returns, as coherence's are.
function namingLineage(records: readonly NamedRecord[], stars: readonly Star[], stepInputs: FileHashes) {
  return catalogStageLineage(
    NAMING_LINEAGE, NAMING_CODES, () => namingLineageLines(records, stars, CONSTELLATIONS), NAMING_LINEAGE_BUDGET,
    NAMING_INVARIANTS, stepInputs,
  );
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

export async function main() {
  const heap = watchHeap('build:catalog');
  sweepStaged(CATALOG_OUTPUTS);
  const inputHashesAtStart = stepInputHashes();

  const counts: FiledCounts = {
    namingIauNamed: 0,
    namingIauNamedByProper: 0,
    namingIauUnreached: 0,
    namingEponym: 0,
    namingBayer: 0,
    namingBayerAdded: 0,
    namingBayerComponent: 0,
    namingBayerDropped: 0,
    namingGould: 0,
    namingAliases: 0,
    namingAliasRecords: 0,
    namingDesigConFromWgsn: 0,
    namingDesigConWgsnConflict: 0,
    namingTierOverride: 0,
    namingTierIau: 0,
    namingTierEponym: 0,
    namingTierBayer: 0,
    namingTierFlamsteed: 0,
    namingTierBayerLatin: 0,
    namingTierGould: 0,
    namingTierGcvs: 0,
    namingTierCatalogue: 0,
    namingBorrowed: 0,
    namingLettered: 0,
    namingNameTable: 0,
    namingOverrides: 0,
    namingUnlabelled: 0,
    namingDuplicateLabels: 0,
    namingDuplicateRecords: 0,
    desigConFromCrossIndex: 0,
    crossIndexUnknownCst: 0,
    bjEligible: 0,
    bjOverridden: 0,
    lmcCandidates: 0,
    lmcOverridden: 0,
    lmcParallaxRefusedByDistVia: emptyTallyPartition(DIST_VIA_VALUES),
    lmcOverriddenByDistVia: emptyTallyPartition(DIST_VIA_VALUES),
    nameTableEntries: 0,
    companionRowsScanned: 0,
    companionPromoted: 0,
    companionPromotedSynthetic: 0,
    companionAlreadyInCatalog: 0,
    companionDroppedNoIdentifier: 0,
    companionDroppedNoPosition: 0,
    companionDroppedBeyondTidalLimit: 0,
    companionDroppedNoAbsmag: 0,
    companionDroppedCompoundComp: 0,
    companionDroppedCollocatedPrimary: 0,
    companionAnchorIsComponent: 0,
    companionDroppedParkedRecord: 0,
    companionDroppedParkedViaGaia5p: 0,
    companionDroppedParkedOwnedFit: 0,
    companionAbsmagSpectralDerived: 0,
    companionSpectMsFromOwnAbsmag: 0,
    companionAbsmagWdsMagDerived: 0,
    companionAbsmagAnchorCollocated: 0,
    companionAbsmagInheritedTwinOrbital: 0,
    companionBlendSplit: 0,
    companionBlendDimmedAnchors: 0,
    companionBlendDimSkipped: 0,
    companionBlendDimUnfit: 0,
    companionBlendDimOutside: 0,
    companionBlendDimGaiaResolved: 0,
    companionBlendDimBeyondSeparation: 0,
    companionBlendDimMisfit: 0,
    companionRepositionedCollocatedDouble: 0,
    physicalOverlaps: 0,
    companionConstellationSplitFromAnchor: 0,
    companionExistingDesigConFromAnchor: 0,
    companionExistingMemberRecurated: emptyTallyPartition(RECURATED_BRIGHTNESS),
    companionExistingViaSameasBridge: 0,
    distBailerJones: 0,
    distLmcKinematic: 0,
    distGaiaDr3Inversion: 0,
    distHip2Parallax: 0,
    distCns5Plx: 0,
    distGliesePlx: 0,
    distSimbadPlx: 0,
    distGliesePhotometricPlx: 0,
    distPairMemberParallax: 0,
    distCurated: 0,
    distNone: 0,
    distLowPrecisionParallax: 0,
    parkedRefusedNoDefensibleParallax: 0,
    parkedNoParallaxPublished: 0,
    parkedNoVMagnitude: 0,
    parkedNoPosition: 0,
    directionGaia5p: 0,
    directionGaia2p: 0,
    directionGaiaNssSystemic: 0,
    directionHip2Saturated: 0,
    directionHip2PmDiscrepant: 0,
    directionTycho2: 0,
    directionTycho2FromIcrs: 0,
    directionTycho2Photocentre: 0,
    directionCns5: 0,
    directionSimbad: 0,
    directionCurated: 0,
    velocityGaiaPm: 0,
    velocityHip2Pm: 0,
    velocityTycho2Pm: 0,
    velocityCns5Pm: 0,
    velocitySimbadPm: 0,
    velocityZero: 0,
    pmRescueTycho2: 0,
    pmRescueCns5: 0,
    pmRescueSimbad: 0,
    pmRescueGaiaBibcodeSkipped: 0,
    pmRescueNone: 0,
    velocityClamped: 0,
    velocityAboveEscape: 0,
    velocityRvApplied: 0,
    rvGaiaDr3: 0,
    rvSimbad: 0,
    rvSimbadGaiaBibcode: 0,
    rvGaiaBibcodeSkipped: 0,
    rvNone: 0,
    rvRadialRejected: 0,
    rvGaiaErrorBands: emptyTallyPartition(RV_ERROR_BANDS),
    rvGaiaErrorMaxKmS: 0,
  };

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
  if (stats.bjEligible > 0) {
    const pct = ((stats.bjOverridden / stats.bjEligible) * 100).toFixed(1);
    console.log(
      `  Bailer-Jones override: ${stats.bjOverridden} / ${stats.bjEligible} ` +
        `Gaia-inverse-distance stars (${pct}%)`,
    );
  }
  if (stats.lmcCandidates > 0) {
    const pct = ((stats.lmcOverridden / stats.lmcCandidates) * 100).toFixed(1);
    console.log(
      `  LMC kinematic override: ${stats.lmcOverridden} / ${stats.lmcCandidates} ` +
        `LMC-cone stars (${pct}%)`,
    );
    console.log(
      `    displacing: ${formatPartition(stats.lmcOverriddenByDistVia)}`,
    );
    console.log(
      `    refused on own parallax, keeping: ${formatPartition(stats.lmcParallaxRefusedByDistVia)}`,
    );
  }
  const dv = stats.directionVia;
  console.log(
    `  direction cascade: gaia_5p ${dv.gaia_5p}, ` +
      `gaia_nss_systemic ${dv.gaia_nss_systemic}, ` +
      `hip2_saturated ${dv.hip2_saturated}, ` +
      `hip2_pm_discrepant ${dv.hip2_pm_discrepant}, ` +
      `tycho2 ${dv.tycho2} (${stats.directionTycho2FromIcrs} at the J2000 ` +
      `cell with no mean solution, ${stats.directionTycho2Photocentre} a ` +
      `double's photocentre), cns5 ${dv.cns5}, simbad ${dv.simbad}, ` +
      `curated ${dv.curated}`,
  );
  console.log(brightnessColourSummary(brightnessEmission.counts));
  const vv = stats.velocityVia;
  console.log(
    `  velocity cascade: gaia_pm ${vv.gaia_pm}, hip2_pm ${vv.hip2_pm}, ` +
      `tycho2_pm ${vv.tycho2_pm}, cns5_pm ${vv.cns5_pm}, ` +
      `simbad_pm ${vv.simbad_pm}, zero ${vv.zero} ` +
      `(clamped ${stats.velocityClamped}); rv applied ${stats.rvApplied}`,
  );
  const pmr = stats.pmRescueOutcome;
  console.log(
    `  PM rescue (direction tier carries none): tycho2 ${pmr.tycho2}, ` +
      `cns5 ${pmr.cns5}, simbad ${pmr.simbad}, ` +
      `${pmr.gaia_bibcode_skipped} Gaia-bibcoded values skipped on 2p rows, ` +
      `${pmr.none} with no owned PM`,
  );
  const rv = stats.rvVia;
  const rvErr = stats.rvGaiaErrorBand;
  console.log(
    `  rv cascade: gaia_dr3 ${rv.gaia_dr3}, simbad ${rv.simbad} ` +
      `(${stats.rvSimbadGaiaBibcode} citing a Gaia release), none ${rv.none}; ` +
      `${stats.rvGaiaBibcodeSkipped} Gaia-bibcoded values skipped on 2p rows`,
  );
  console.log(
    `  rv uncertainty on the gaia_dr3 tier: <=1 ${rvErr.le1}, <=5 ${rvErr.le5}, ` +
      `<=10 ${rvErr.le10}, <=20 ${rvErr.le20}, >20 ${rvErr.gt20}, ` +
      `absent ${rvErr.none}; max ${stats.rvGaiaErrorMaxKmS} km/s`,
  );
  if (stats.rvRadialRejectedSample.length > 0) {
    console.log(
      `  radial term rejected (>${VELOCITY_SANITY_CEILING_KM_S} km/s, proper motion kept):`,
    );
    for (const s of stats.rvRadialRejectedSample) console.log(`    ${s}`);
  }
  if (stats.velocityClampedSample.length > 0) {
    console.log(`  velocity clamped (>${VELOCITY_SANITY_CEILING_KM_S} km/s, zeroed as artifacts):`);
    for (const s of stats.velocityClampedSample) console.log(`    ${s}`);
  }
  console.log(
    `  velocity above escape (>${GALACTIC_ESCAPE_VELOCITY_KM_S} km/s, kept + tracked): ${stats.velocityAboveEscape} ` +
      `— sample (first ${stats.velocityAboveEscapeSample.length}):`,
  );
  for (const s of stats.velocityAboveEscapeSample) console.log(`    ${s}`);
  console.log(
    '  distance by tier: '
    + DIST_VIA_VALUES.map((v) => `${v}=${stats.distVia[v]}`).join(' · '),
  );
  if (stats.distLowPrecisionParallax > 0) {
    console.log(
      `  parallaxes admitted below 20% precision: ${stats.distLowPrecisionParallax}`
      + ' (ship, biased inversion — revisit at Gaia DR4)',
    );
  }
  const simbadSourcedDistances = simbadSourcedDistancesTsv(stars);
  counts.bjEligible = stats.bjEligible;
  counts.bjOverridden = stats.bjOverridden;
  counts.distLowPrecisionParallax = stats.distLowPrecisionParallax;
  for (const r of PARKED_REASONS) counts[PARKED_COUNT_KEY[r]] = stats.parkedVia[r];
  for (const v of DIST_VIA_VALUES) counts[DIST_VIA_COUNT_KEY[v]] = stats.distVia[v];
  counts.lmcCandidates = stats.lmcCandidates;
  counts.lmcOverridden = stats.lmcOverridden;
  counts.lmcParallaxRefusedByDistVia = stats.lmcParallaxRefusedByDistVia;
  counts.lmcOverriddenByDistVia = stats.lmcOverriddenByDistVia;
  counts.directionGaia5p = dv.gaia_5p;
  counts.directionGaia2p = dv.gaia_2p;
  counts.directionGaiaNssSystemic = dv.gaia_nss_systemic;
  counts.directionHip2Saturated = dv.hip2_saturated;
  counts.directionHip2PmDiscrepant = dv.hip2_pm_discrepant;
  counts.directionTycho2 = dv.tycho2;
  counts.directionCns5 = dv.cns5;
  counts.directionSimbad = dv.simbad;
  counts.directionCurated = dv.curated;
  counts.directionTycho2FromIcrs = stats.directionTycho2FromIcrs;
  counts.directionTycho2Photocentre = stats.directionTycho2Photocentre;
  counts.velocityGaiaPm = vv.gaia_pm;
  counts.velocityHip2Pm = vv.hip2_pm;
  counts.velocityTycho2Pm = vv.tycho2_pm;
  counts.velocityCns5Pm = vv.cns5_pm;
  counts.velocitySimbadPm = vv.simbad_pm;
  counts.velocityZero = vv.zero;
  const pr = stats.pmRescueOutcome;
  counts.pmRescueTycho2 = pr.tycho2;
  counts.pmRescueCns5 = pr.cns5;
  counts.pmRescueSimbad = pr.simbad;
  counts.pmRescueGaiaBibcodeSkipped = pr.gaia_bibcode_skipped;
  counts.pmRescueNone = pr.none;
  counts.velocityClamped = stats.velocityClamped;
  counts.velocityAboveEscape = stats.velocityAboveEscape;
  counts.velocityRvApplied = stats.rvApplied;
  counts.rvGaiaDr3 = stats.rvVia.gaia_dr3;
  counts.rvSimbad = stats.rvVia.simbad;
  counts.rvSimbadGaiaBibcode = stats.rvSimbadGaiaBibcode;
  counts.rvGaiaBibcodeSkipped = stats.rvGaiaBibcodeSkipped;
  counts.rvNone = stats.rvVia.none;
  counts.rvRadialRejected = stats.rvRadialRejected;
  counts.rvGaiaErrorBands = stats.rvGaiaErrorBand;
  counts.rvGaiaErrorMaxKmS = stats.rvGaiaErrorMaxKmS;

  // The labels are the manifest's (/docs/catalog-driver.md#31-retiring-the-spine--the-membership-rule-measured-against-the-primaries); what the
  // classic-ID tables still supply per record is IV/27A's constellation for
  // each Bayer / Flamsteed designation.
  console.log('Resolving designation constellations from IV/27A...');
  const desigConCounts = applyDesignationConstellations(
    stars, loadDesignationConstellationInputs(),
  );
  Object.assign(counts, desigConCounts);
  console.log(
    `  designation constellation from IV/27A on ${desigConCounts.desigConFromCrossIndex}`,
  );

  // Naming ladder, authority half: the IAU WGSN approved name and the
  // glyph-bearing Bayer / Gould designations, keyed on the record's
  // identifiers. Composition itself is post-sort, once every promoted record
  // exists and its component letter is known.
  console.log('Applying the IAU WGSN naming ladder...');
  const namingCounts = applyStarNames(stars, loadStarNamingInputs(), CONSTELLATIONS);
  Object.assign(counts, namingCounts);
  console.log(
    `  ${namingCounts.namingIauNamed} IAU names ` +
      `(${namingCounts.namingIauNamedByProper} via the record's own spelling, ` +
      `${namingCounts.namingIauUnreached} approved names unreached), ` +
      `${namingCounts.namingEponym} string designations`,
  );
  console.log(
    `  ${namingCounts.namingBayer} Bayer designations ` +
      `(${namingCounts.namingBayerAdded} added, ` +
      `${namingCounts.namingBayerDropped} spine cells the authority does not ` +
      `reach), ${namingCounts.namingGould} Gould, ` +
      `${namingCounts.namingAliases} aliases on ` +
      `${namingCounts.namingAliasRecords} records`,
  );

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
  const { newStars, stats: ps, rows: promotedRows } = promoteCompanions(multiplesRows, stars, {
    conAssignment, dustGrid, parked: parkedRefusals(stats.parked),
    gaiaAstrometry: directions.gaiaAstrometry, synthGaiaBridges,
  });
  for (const ns of newStars) stars.push(ns);
  const { lineage: promotionLineageRows, identity: promotionIdentity } = promotionLineage(promotedRows, stars, manifestFounded);
  const promotionLines = promotionLineageRows.map((row) => stageLineageLine(PROMOTION_CODES, row));
  console.log(
    `  scanned ${ps.pairRowsScanned} pair rows; promoted ${ps.promoted} ` +
      `(${ps.promotedSynthetic} via synthetic ID); ` +
      `already-in-catalog ${ps.alreadyInCatalog} ` +
      `(re-curated ${formatPartition(ps.existingMemberRecurated)}, ` +
      `${ps.existingViaSameasBridge} via same-as bridge); ` +
      `dropped (no-identifier=${ps.droppedNoIdentifier}, ` +
      `no-position=${ps.droppedNoPosition}, ` +
      `beyond-tidal=${ps.droppedBeyondTidalLimit}, ` +
      `no-absmag=${ps.droppedNoAbsmag}, ` +
      `compound-comp=${ps.droppedCompoundComp}, ` +
      `collocated-primary=${ps.droppedCollocatedPrimary}, ` +
      `anchor-is-component=${ps.anchorIsComponent}); ` +
      `absmag spectral-derived=${ps.absmagSpectralDerived}, ` +
      `spect ms-from-own-absmag=${ps.spectMsFromOwnAbsmag}, ` +
      `wds-mag-derived=${ps.absmagWdsMagDerived}, ` +
      `inherited-twin-orbital=${ps.absmagInheritedTwinOrbital}, ` +
      `blend-split=${ps.blendSplitRecords}, ` +
      `dimmed-anchors=${ps.blendDimmedAnchors} (skipped ${ps.blendDimSkipped}, ` +
      `unfit ${ps.blendDimMembersUnfit}, outside ${ps.blendDimMembersOutside}, ` +
      `gaia-resolved ${ps.blendDimGaiaResolved}, ` +
      `beyond-separation ${ps.blendDimMembersBeyondSeparation}, ` +
      `misfit ${ps.blendDimMembersMisfit}), ` +
      `repositioned-collocated-double=${ps.repositionedCollocatedDouble}, ` +
      `constellation-split-from-anchor=${ps.constellationSplitFromAnchor}, ` +
      `refused-parked=${ps.droppedParkedRecord} ` +
      `(via gaia_5p ${ps.droppedParkedRecordViaGaia5p}, ` +
      `owned fit ${ps.droppedParkedRecordOwnedFit}) ` +
      `in ${Date.now() - tProm}ms`,
  );
  counts.companionRowsScanned = ps.pairRowsScanned;
  counts.companionPromoted = ps.promoted;
  counts.companionPromotedSynthetic = ps.promotedSynthetic;
  counts.companionAlreadyInCatalog = ps.alreadyInCatalog;
  counts.companionDroppedNoIdentifier = ps.droppedNoIdentifier;
  counts.companionDroppedNoPosition = ps.droppedNoPosition;
  counts.companionDroppedBeyondTidalLimit = ps.droppedBeyondTidalLimit;
  counts.companionDroppedNoAbsmag = ps.droppedNoAbsmag;
  counts.companionDroppedCompoundComp = ps.droppedCompoundComp;
  counts.companionDroppedCollocatedPrimary = ps.droppedCollocatedPrimary;
  counts.companionAnchorIsComponent = ps.anchorIsComponent;
  counts.companionDroppedParkedRecord = ps.droppedParkedRecord;
  counts.companionDroppedParkedViaGaia5p = ps.droppedParkedRecordViaGaia5p;
  counts.companionDroppedParkedOwnedFit = ps.droppedParkedRecordOwnedFit;
  counts.companionAbsmagSpectralDerived = ps.absmagSpectralDerived;
  counts.companionSpectMsFromOwnAbsmag = ps.spectMsFromOwnAbsmag;
  counts.companionAbsmagWdsMagDerived = ps.absmagWdsMagDerived;
  counts.companionAbsmagAnchorCollocated = ps.absmagAnchorCollocated;
  counts.companionAbsmagInheritedTwinOrbital = ps.absmagInheritedTwinOrbital;
  counts.companionBlendSplit = ps.blendSplitRecords;
  counts.companionBlendDimmedAnchors = ps.blendDimmedAnchors;
  counts.companionBlendDimSkipped = ps.blendDimSkipped;
  counts.companionBlendDimUnfit = ps.blendDimMembersUnfit;
  counts.companionBlendDimOutside = ps.blendDimMembersOutside;
  counts.companionBlendDimGaiaResolved = ps.blendDimGaiaResolved;
  counts.companionBlendDimBeyondSeparation = ps.blendDimMembersBeyondSeparation;
  counts.companionBlendDimMisfit = ps.blendDimMembersMisfit;
  counts.companionRepositionedCollocatedDouble = ps.repositionedCollocatedDouble;
  counts.companionConstellationSplitFromAnchor = ps.constellationSplitFromAnchor;
  counts.companionExistingDesigConFromAnchor = ps.existingDesigConFromAnchor;
  counts.companionExistingMemberRecurated = ps.existingMemberRecurated;
  counts.companionExistingViaSameasBridge = ps.existingViaSameasBridge;

  // Sort by apparent V from Sol ascending (brightest-looking first), so any
  // prefix of the record array is a usable sky and the transport chunks can
  // stream one (/src/catalog-format/record/README.md#record-order). Record indices are final
  // after this point.
  const sortKey = new Float64Array(stars.length);
  for (let i = 0; i < stars.length; i++) {
    const s = stars[i];
    const v = apparentVFromSol(s, dustGrid ? avSolToStar(dustGrid, s.x, s.y, s.z) : 0);
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
  const ccdmGroups = parseHipCcdm(HIP_CCDM.read());
  const ccdm = applyDoublesFlag(stars, ccdmGroups, hipToIndex, collectPhysicalPairKeys(multiplesRows));
  console.log(`  in ${Date.now() - tCcdm}ms`);

  const eclipsing = wingEclipsingBinaries(stars);

  // Built here (not at the sidecar write below) so the wings pass resolves
  // multiples.tsv rows exactly as the runtime binaries loader will.
  const rowIndexMap = buildCatalogRowIndexMap(stars, synthGaiaBridges);

  const { memberIndices, ...renderableWings } = wingRenderablePrimaries(multiplesRows, stars, rowIndexMap);

  const overlaps = physicalOverlaps(
    stars,
    orbitChainExemption(renderableOrbitRelations(multiplesRows, rowIndexMap)),
  );
  counts.physicalOverlaps = overlaps.length;
  console.log(`  physical overlaps outside an orbit chain: ${overlaps.length}`);
  for (const [a, b] of overlaps) {
    console.log(`    ${overlapLabel(stars[a], a)} | ${overlapLabel(stars[b], b)}`);
  }

  const { designations: componentDesignations, ...componentCount } = buildComponentDesignations(multiplesRows, rowIndexMap);
  const statuses = multiplicityStatuses(
    stars, memberIndices, (sourceId) => simbadSpectral.bySourceId.get(sourceId)?.otype === SIMBAD_OTYPE_MULTIPLE,
  );
  const multiplicityStatus = statuses.status;
  const multiplicity: MultiplicityCounts = {
    ...binaries, ...ccdm, ...eclipsing, ...renderableWings,
    ...componentCount, ...statuses.counts,
  };
  console.log(`  ${multiplicitySummary(multiplicity)}`);

  const registry = loadRegistry();
  const sidObjects = catalogSidObjects(stars);
  const allocation = allocate({
    objects: sidObjects,
    storedEdges: registry.storedEdges,
    ledger: registry.ledger,
    events: registry.events,
    scope: inPartition(CATALOG_PARTITION),
    ...allocationRun(),
  }, catalogUpstream({ placementRemovals, promotion: promotionLines, promotionIdentity }));
  if (allocation.kind === 'failed') {
    const synthOrphans = allocation.unexplained.flatMap((k) => (k.startsWith('synth:') ? [k.slice('synth:'.length)] : []));
    const liveSynth = sidObjects.flatMap((o) => o.designations.flatMap((d) => (d.startsWith('synth:') ? [d.slice('synth:'.length)] : [])));
    throw new Error(
      `SID allocation failed for ${allocation.errors.length} object(s):\n  ${allocation.errors.join('\n  ')}`
        + (synthOrphans.length === 0 ? '' : `\n${synthChurnReport(synthOrphans, liveSynth, multiplesRows)}`),
    );
  }
  for (const { designation, objects } of allocation.ambiguous) {
    console.log(`ambiguous (dropped): ${designation} names ${objects.length} objects — ${objects.map((i) => sidObjects[i].label).join(' | ')}`);
  }
  const recordSids = allocation.outcomes.slice(0, stars.length).map((o) => o.sid);
  const removedBy = (kind: string): number => allocation.removals.filter((r) => r.kind === kind).length;
  console.log(
    `SID allocation: ${sidObjects.length} objects, ${allocation.minted.length} minted, `
      + `${allocation.outcomes.filter((o) => o.kind === 'reinstated').length} reinstated; `
      + `${removedBy('parked')} parked, ${removedBy('retired')} retired, ${removedBy('merged')} merged; `
      + `${allocation.events.length} new event(s)`,
  );

  // Naming ladder, composition half. Runs here because it needs every
  // record final: the promoted companions exist, indices are sorted, each
  // component's WDS root anchor resolves through the row-index map, and the
  // SIDs the override table keys on are known. Writes `proper` for the NAME
  // tiers alone — the runtime composes every designation off the search
  // index through the same pure function (/docs/star-naming.md#6-rendering--glyphs-everywhere-no-fallback-path).
  const display = assignDisplayNames(
    stars, componentDesignations, CONSTELLATIONS, NAME_OVERRIDES.read(), recordSids,
  );
  const namingEmission = namingLineage(display.records, stars, inputHashesAtStart);
  Object.assign(counts, {
    namingTierOverride: display.counts.namingTier.override,
    namingTierIau: display.counts.namingTier.iau,
    namingTierEponym: display.counts.namingTier.eponym,
    namingTierBayer: display.counts.namingTier.bayer,
    namingTierFlamsteed: display.counts.namingTier.flamsteed,
    namingTierBayerLatin: display.counts.namingTier.bayer_latin,
    namingTierGould: display.counts.namingTier.gould,
    namingTierGcvs: display.counts.namingTier.gcvs,
    namingTierCatalogue: display.counts.namingTier.catalogue,
    namingBorrowed: display.counts.namingBorrowed,
    namingLettered: display.counts.namingLettered,
    namingNameTable: display.counts.namingNameTable,
    namingOverrides: display.counts.namingOverrides,
    namingUnlabelled: display.counts.namingUnlabelled,
    namingDuplicateLabels: display.counts.namingDuplicateLabels,
    namingDuplicateRecords: display.counts.namingDuplicateRecords,
  });
  console.log(
    `Display names: ${stars.length - display.counts.namingUnlabelled} composed ` +
      `(${display.counts.namingNameTable} names in catalog.bin, ` +
      `${display.counts.namingBorrowed} borrowed from a system anchor, ` +
      `${display.counts.namingLettered} lettered, ` +
      `${display.counts.namingUnlabelled} unlabelled)`,
  );
  if (display.counts.namingDuplicateLabels > 0) {
    console.log(
      `  ${display.counts.namingDuplicateLabels} duplicate label(s) across ` +
        `${display.counts.namingDuplicateRecords} records — see ` +
        'naming/naming-parity.test.ts',
    );
  }

  // Build name table — the NAME tiers only. Every designation is composed
  // at runtime off search-index.json so the main binary stays compact.
  const nameTable = encodeNameTable(stars.map((s) => s.proper));
  const nameOffsets = nameTable.offsets;
  const nameTableLength = nameTable.bytes.length;
  counts.nameTableEntries += nameTable.entries;

  // Allocate output buffer.
  const recordsLength = stars.length * RECORD_SIZE;
  const totalLength = HEADER_SIZE + nameTableLength + recordsLength;
  const out = new ArrayBuffer(totalLength);
  const view = new DataView(out);
  const bytes = new Uint8Array(out);

  // Header, then the name table, then the records — the order the first
  // transport chunk needs to decode standalone (`/src/catalog-format/record/README.md#on-disk-transport-chunking`).
  writeCatalogHeader(view, {
    count: stars.length,
    nameTableOffset: HEADER_SIZE,
    nameTableLength,
  });

  bytes.set(nameTable.bytes, HEADER_SIZE);
  let off = HEADER_SIZE + nameTableLength;

  // Records.
  const unclassifiedCon: number[] = [];
  for (let i = 0; i < stars.length; i++) {
    const s = stars[i];
    const { ampUnits, periodUnits } = variabilityUnits(s);
    // Gaia DR3 source_ids exceed Number.MAX_SAFE_INTEGER; parse the
    // manifest column as BigInt to preserve every bit before writing.
    const gaiaSourceId = s.gaiaSourceId !== null ? BigInt(s.gaiaSourceId) : NO_GAIA_SOURCE_ID;

    // Apsis lookup keyed by gaia_source_id string (BigInt key would
    // require a parallel string map). NO_APSIS (NaN) fills every cell
    // when the source_id is absent from the TSV or the row's cell is blank.
    const apsisRow = s.gaiaSourceId !== null ? apsisMap.get(s.gaiaSourceId) : undefined;
    const apsis = {} as Record<ApsisField, number>;
    for (const name of APSIS_FIELDS) apsis[name] = apsisRow?.[name] ?? NO_APSIS;

    writeStarRecord(view, off, {
      x: s.x, y: s.y, z: s.z,
      vx: s.vx, vy: s.vy, vz: s.vz,
      absmag: s.absmag,
      ci: s.ci,
      physRadius: s.physicalRadius,
      companionIdx: s.companionIdx >= 0 ? s.companionIdx : NO_COMPANION,
      nameOffset: s.proper ? nameOffsets[i] : 0,
      ...encodeSpectralBytes(s.spectral),
      conIndex: s.conIndex,
      flags: s.flags,
      ampUnits,
      periodUnits,
      varType: s.varType ?? 0,
      hip: s.hip ?? 0,
      gaiaSourceId,
      apsis,
      sid: recordSids[i],
      multiplicityStatus: multiplicityStatus[i],
    });

    if (s.conIndex === NO_CONSTELLATION_INDEX) unclassifiedCon.push(i);
    off += RECORD_SIZE;
  }

  // The IAU boundaries partition the whole sphere, so byte 34's sentinel is
  // unreachable for anything with a direction. Sol sits at the origin and is
  // the one record that has none — any other holder means an assignment path
  // was skipped, which surfaces downstream as a blank constellation row
  // rather than an error.
  if (unclassifiedCon.length !== 1 || unclassifiedCon[0] !== SOL_RECORD_INDEX) {
    throw new Error(
      `Expected Sol (record ${SOL_RECORD_INDEX}) to be the only record without a `
      + `constellation; got ${unclassifiedCon.length}: `
      + `${unclassifiedCon.slice(0, 10).join(', ')}`,
    );
  }

  if (off !== totalLength) {
    throw new Error(`Size mismatch: wrote ${off}, expected ${totalLength}`);
  }

  const chunkBytes = planCatalogChunks(totalLength);
  // What first paint actually gets. Pinned because it is the number the
  // progressive load's whole latency argument rests on, and it moves with
  // the name table's length as well as the chunk target.
  const recordsInFirstChunk = recordsInChunkPrefix(
    chunkBytes, 1, HEADER_SIZE + nameTableLength, stars.length,
  );
  assertFigureVerticesInFirstChunk(figureLines, recordsInFirstChunk);
  const records = recordsCounts(stars, apsisMap, inputs.gspcMap, recordsInFirstChunk);
  // /src/catalog-format/record/README.md#on-disk-transport-chunking is measured from this line.
  const sortedKey = order.map((i) => sortKey[i]);
  const chunkRows = chunkBytes.map((_, i) => {
    const n = recordsInChunkPrefix(
      chunkBytes, i + 1, HEADER_SIZE + nameTableLength, stars.length,
    );
    return `${i} ${n} records to V ${sortedKey[n - 1]?.toFixed(2) ?? '—'}`;
  });
  console.log(`  transport chunks — ${chunkRows.join(' · ')}`);
  const sidSuccessors = sidSuccessorPairs([...registry.events, ...allocation.events]);
  const manifest: CatalogManifest = {
    chunkBytes,
    totalBytes: totalLength,
    ...(sidSuccessors.length > 0 ? { sidSuccessors } : {}),
  };
  const chunks = new Map<string, ArtifactContents>();
  let chunkOff = 0;
  for (let i = 0; i < chunkBytes.length; i++) {
    chunks.set(
      resolve(CATALOG_CHUNK_DIR, catalogChunkFilename(i)),
      new Uint8Array(out, chunkOff, chunkBytes[i]),
    );
    chunkOff += chunkBytes[i];
  }
  const manifestJson = JSON.stringify(manifest) + '\n';

  // Constellations JSON (unchanged from v1 format).
  const constellationsOut = CONSTELLATIONS.map((c, idx) => {
    const lines = figureLines.get(idx);
    return lines ? { ...c, lines } : { ...c };
  });
  const constellationsJson = JSON.stringify(constellationsOut) + '\n';

  // Boundary polylines, region label anchors, the runtime membership grid and
  // the fade-quantile table. The quantiles are keyed to apparent magnitude
  // and measured over the shipped population, so this runs against the same
  // `stars` the binary was written from.
  const boundaries = renderBoundaryArtifact(stars, conAssignment.lookup);
  console.log(`Built ${CATALOG_OUTPUTS.files.boundaries} ${boundaryArtifactSummary(boundaries)}`);

  const search = buildSearchIndex(stars, componentDesignations);
  const searchJson = JSON.stringify(search.entries) + '\n';

  const rowIndexMapJson = serializeCatalogRowIndexSidecar(
    handedFileHash(inputHashesAtStart, MULTIPLES_TSV.file), rowIndexMap,
  );
  console.log(
    `Row-index map ${CATALOG_OUTPUTS.files.rowIndexMap} (${Object.keys(rowIndexMap.byGaia).length} ` +
      `Gaia entries, ${Object.keys(rowIndexMap.byHip).length} HIP entries, ` +
      `${Object.keys(rowIndexMap.bySynth).length} synthetic entries)`,
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

  const lineage = stageLineage({
    layout: LINEAGE_LAYOUT,
    spec: PROMOTION_LINEAGE,
    inputs: inputHashesAtStart,
    diffed: 'promotion',
    lines: () => promotionLines,
    render: (sorted) => ({
      promotion: stageLineageText(PROMOTION_CODES, sorted),
      'promotion.identity': identityText(promotionIdentity),
    }),
    joins: () => [],
    budget: PROMOTION_LINEAGE_BUDGET,
    invariants: [],
    argv: process.argv.slice(2),
    upstream: UPSTREAM_LINEAGE,
  });
  const allocationLineage = stageLineage({
    layout: LINEAGE_LAYOUT,
    spec: ALLOCATION_LINEAGE,
    inputs: inputHashesAtStart,
    diffed: 'allocation',
    lines: () => allocationLineageRows(sidObjects, allocation).map((row) => stageLineageLine(ALLOCATION_CODES, row)),
    render: (sorted) => ({
      allocation: stageLineageText(ALLOCATION_CODES, sorted),
      [ALLOCATION_SIDS_STEM]: allocationSidsText(allocationSidRows(sidObjects, allocation.outcomes)),
    }),
    joins: () => [],
    budget: ALLOCATION_LINEAGE_BUDGET,
    invariants: [],
    argv: process.argv.slice(2),
    upstream: UPSTREAM_LINEAGE,
  });
  const files = {
    manifest: manifestJson,
    constellations: constellationsJson,
    boundaries: boundaries.json,
    searchIndex: searchJson,
    rowIndexMap: rowIndexMapJson,
    parkedLedger,
    simbadSourcedDistances,
    ...placementEmission.files,
    ...brightnessEmission.files,
    ...sizeEmission.files,
    ...coherenceEmission.files,
    ...lineage.files,
    ...allocationLineage.files,
    ...namingEmission.files,
    ...registryTexts(CATALOG_PARTITION, allocation.minted, allocation.events),
  };
  const members = new Map([
    ...chunks, ...placementEmission.members, ...brightnessEmission.members, ...sizeEmission.members, ...coherenceEmission.members, ...lineage.members, ...allocationLineage.members,
    ...namingEmission.members,
  ]);

  emitArtifacts({
    outputs: CATALOG_OUTPUTS,
    files,
    members,
    checks: [
      ...placementEmission.checks, ...brightnessEmission.checks, ...sizeEmission.checks, ...coherenceEmission.checks, ...lineage.checks, ...allocationLineage.checks,
      ...namingEmission.checks,
      buildCountsCheck(counts, [
        { stage: 'inputs', block: { kind: 'counted', counts: inputs.counts } },
        { stage: 'multiplicity', block: { kind: 'counted', counts: multiplicity } },
        { stage: 'gcvs', block: { kind: 'counted', counts: gcvsCounts } },
        { stage: 'records', block: { kind: 'counted', counts: records } },
        { stage: 'search', block: { kind: 'counted', counts: search.counts } },
        { stage: 'boundaries', block: { kind: 'counted', counts: boundaries.counts } },
        { stage: 'figures', block: { kind: 'counted', counts: figures } },
        { stage: 'brightness-colour', block: { kind: 'counted', counts: brightnessEmission.counts } },
        { stage: 'coherence', block: { kind: 'counted', counts: coherenceEmission.counts } },
      ]), distanceOutliersCheck(stars),
      heap.check(),
    ],
  });
}

function buildCountsCheck(counts: FiledCounts, blocks: readonly StageBlock<CatalogCountStage>[]): Check {
  return snapshotCheck<StagedCounts>({
    snapshotPath: EXPECTED_COUNTS,
    actual: nestByStage(counts, { order: CATALOG_COUNT_STAGES, of: CATALOG_COUNT_STAGE }, blocks),
    compare: compareCountSnapshot,
    failureLabel: 'build-catalog count',
    script: 'build:catalog',
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

  return snapshotCheck<RegressionReport>({
    snapshotPath: EXPECTED_OUTLIERS,
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
    script: 'build:catalog',
  });
}

