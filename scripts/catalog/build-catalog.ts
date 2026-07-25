// Orchestrator for the catalog build pipeline — writes
// public/catalog.bin, public/constellations.json, and
// public/search-index.json. See scripts/catalog/README.md.

import { statSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdir, writeFile, readdir, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseBailerJonesTsv,
  parseGaiaApsisTsv,
  parseSimbadSptypeTsv,
  resolveSpectralInfo,
  resolveApsisTeff,
  resolveSpectDisplay,
  physicalRadius,
  UNKNOWN_CLASS_IDX,
  parseSimbadWdsXidsTsv,
  type SimbadWdsXidIndex,
  buildHipToIndex,
  inferBinaries,
  FLAG_IS_SOL,
  FLAG_BINARY_PRIMARY,
  VAR_TYPE_ECLIPSING,
  encodeAmpUnits,
  encodePeriodUnits,
  HEADER_SIZE,
  RECORD_SIZE,
  BINARY_VERSION,
  NO_COMPANION,
  NO_GAIA_SOURCE_ID,
  NO_APSIS,
  MULTIPLICITY_SINGLE,
  MULTIPLICITY_RESOLVED,
  MULTIPLICITY_UNRESOLVED,
  SIMBAD_OTYPE_MULTIPLE,
  APSIS_FIELDS,
  type ApsisField,
  writeStarRecord,
  writeCatalogHeader,
  NAME_TABLE_PADDING,
  NAME_LENGTH_PREFIX_BYTES,
  CATALOG_MANIFEST_FILENAME,
  catalogChunkFilename,
  planCatalogChunks,
  buildSearchEntry,
  type ApsisRow,
  type SearchEntry,
  emptyDistSrcPartition,
  type SimbadSpectralIndex,
  type CatalogManifest,
} from './catalog-pure';
import {
  compareBuildCounts,
  formatCountDiff,
  formatDistSrcPartition,
  type BuildCounts,
} from './build-counts';
import {
  buildRegressionReport,
  compareRegressionReports,
  formatRegressionDiff,
  mergeReasonsFromSnapshot,
  parseSimbadSampleTsv,
  type RegressionReport,
} from './distance/distance-regression-check';
import {
  CONSTELLATIONS,
  CON_INDEX,
  buildFigureLines,
} from './parse/constellations';
import {
  parseHipCcdm,
  applyDoublesFlag,
  collectPhysicalPairKeys,
} from './multiplicity/visual-doubles';
import {
  buildCatalogRowIndexMap,
  buildComponentDesignations,
  backfillPrimaryIdentifiers,
  promoteCompanions,
  readMultiplesTsv,
  stampComponentLetters,
  wingRenderablePrimaries,
  type ComponentDesignation,
} from './companions/companion-promotion';
import { applySystemDistanceCoherence } from './multiplicity/system-coherence';
import {
  parseGcvsMain,
  parseGcvsCrossref,
  bridgeGcvsByGaia,
  applyVariability,
} from './parse/gcvs-parse';
import { readGaiaHipXmatch } from './parse/gaia-xmatch';
import {
  parseGaiaAstrometryCatalogTsv,
  parseHip2Tsv,
  parseNssSourceIdSet,
  VELOCITY_SANITY_CEILING_KM_S,
  GALACTIC_ESCAPE_VELOCITY_KM_S,
  type DirectionSources,
} from './distance/direction-cascade';
import { readStars, type Star } from './parse/stars-parse';
import { loadDustGrid } from './distance/dust-deextinction';
import { REPO_ROOT as ROOT, maxMtimeOfSources } from '../util/paths';
import { resolveSids, sidSuccessorPairs, starDesignations, type SidObject } from '../sid/sid-pure';
import {
  HEAD_PATH,
  LEDGER_PATH,
  OVERRIDES_PATH,
  REINSTATEMENTS_PATH,
  RETIREMENTS_PATH,
  loadRegistry,
} from '../sid/registry-io';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SRC_CSV = resolve(ROOT, 'data/athyg/athyg_33_classic_ids.csv');
const SRC_STELLARIUM = resolve(ROOT, 'data/stellarium/stellarium-modern-skyculture.json');
const SRC_GCVS = resolve(ROOT, 'data/gcvs/gcvs5.txt');
const SRC_GCVS_XREF = resolve(ROOT, 'data/gcvs/crossid.txt');
const SRC_HIP_CCDM = resolve(ROOT, 'data/hipparcos/hip_ccdm.tsv');
const SRC_BAILER_JONES = resolve(ROOT, 'data/bailer-jones/bailer-jones-dr3.tsv');
const SRC_GAIA_HIP_XMATCH = resolve(ROOT, 'data/gaia/gaia_dr3_hip_xmatch.tsv');
const SRC_GAIA_APSIS = resolve(ROOT, 'data/gaia/gaia_dr3_apsis.tsv');
const SRC_GAIA_ASTROMETRY = resolve(ROOT, 'data/gaia/gaia_dr3_astrometry_catalog.tsv');
const SRC_GAIA_NSS = resolve(ROOT, 'data/gaia/gaia_dr3_nss_two_body.tsv');
const SRC_HIP2 = resolve(ROOT, 'data/hipparcos/hip2_van_leeuwen.tsv');
const SRC_SIMBAD_SPTYPE = resolve(ROOT, 'data/simbad/simbad_sptype.tsv');
const SRC_SIMBAD_WDS_XIDS = resolve(ROOT, 'data/simbad/simbad_wds_xids.tsv');
const SRC_SIMBAD_SAMPLE = resolve(ROOT, 'data/simbad/simbad_sample.tsv');
const SRC_MULTIPLES = resolve(ROOT, 'data/binaries/multiples.tsv');
const SRC_DUST_DIR = resolve(ROOT, 'data/dust');
const SRC_DUST_MANIFEST = resolve(SRC_DUST_DIR, 'manifest.json');
const PUBLIC_DIR = resolve(ROOT, 'public');
const OUT_MANIFEST = resolve(PUBLIC_DIR, CATALOG_MANIFEST_FILENAME);
const OUT_CON = resolve(ROOT, 'public/constellations.json');
const OUT_SEARCH = resolve(ROOT, 'public/search-index.json');
const OUT_ROW_INDEX_MAP = resolve(ROOT, 'public/catalog-row-index-map.json');
const EXPECTED_COUNTS = resolve(__dirname, 'build-catalog-expected.json');
const EXPECTED_OUTLIERS = resolve(
  __dirname,
  'distance/build-distance-outliers-expected.json',
);

function isUpToDate(): boolean {
  if (!existsSync(OUT_MANIFEST) || !existsSync(OUT_CON) || !existsSync(OUT_SEARCH)) return false;
  if (!existsSync(resolve(PUBLIC_DIR, catalogChunkFilename(0)))) return false;
  if (!existsSync(OUT_ROW_INDEX_MAP)) return false;
  const binMtime = statSync(OUT_MANIFEST).mtimeMs;
  // This file is an orchestration shell — the build logic lives in the
  // sibling scripts/catalog modules plus scripts/util and scripts/sid,
  // so any of them must invalidate the artifact.
  const scriptFiles: string[] = [];
  for (const dir of [__dirname, resolve(__dirname, '../util'), resolve(__dirname, '../sid')]) {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
      scriptFiles.push(resolve(dir, name));
    }
  }
  // Every build input: source catalogues, the dust manifest, and the SID
  // registry (a fresh sid:allocate mint or overrides/retirements edit must
  // invalidate a catalog.bin written with NO_SID placeholders, or the
  // documented build → allocate → rebuild bootstrap skips its final step).
  // Adding a new source is one array entry.
  const newest = maxMtimeOfSources([
    SRC_CSV, SRC_STELLARIUM, SRC_GCVS, SRC_GCVS_XREF, SRC_HIP_CCDM,
    SRC_BAILER_JONES, SRC_GAIA_HIP_XMATCH, SRC_GAIA_APSIS, SRC_GAIA_ASTROMETRY,
    SRC_GAIA_NSS, SRC_HIP2, SRC_SIMBAD_SPTYPE, SRC_SIMBAD_WDS_XIDS,
    SRC_SIMBAD_SAMPLE, SRC_MULTIPLES, SRC_DUST_MANIFEST,
    LEDGER_PATH, HEAD_PATH, OVERRIDES_PATH, RETIREMENTS_PATH, REINSTATEMENTS_PATH,
    ...scriptFiles,
  ]);
  return binMtime > newest;
}

// Clear a prior build's chunk set so a shrunk chunk count can't strand stale
// higher-index chunks the manifest no longer lists.
async function removeStaleCatalogChunks(dir: string): Promise<void> {
  for (const name of await readdir(dir)) {
    if (/^catalog\.bin\.\d+$/.test(name)) {
      await unlink(resolve(dir, name));
    }
  }
}

async function main() {
  if (!existsSync(SRC_CSV)) {
    console.error(`Source CSV not found: ${SRC_CSV}`);
    process.exit(1);
  }
  if (!existsSync(SRC_STELLARIUM)) {
    console.error(`Stellarium sky culture JSON not found: ${SRC_STELLARIUM}`);
    process.exit(1);
  }

  // The UPDATE_* snapshot-refresh flags rewrite artifacts written at the end
  // of a full build, so they must force one even when the sources are
  // unchanged (the snapshot assert/refresh is unreachable otherwise).
  const forceRebuild =
    process.env.UPDATE_BUILD_COUNTS === '1' || process.env.UPDATE_DISTANCE_OUTLIERS === '1';
  if (!forceRebuild && isUpToDate()) {
    console.log('catalog.bin is up to date with source CSV; skipping rebuild.');
    return;
  }

  // Accumulator for the headline counts asserted against
  // scripts/catalog/build-catalog-expected.json at the end of the
  // build. Every field has a default so a code path that legitimately
  // skips a section (missing GCVS files, no Sol) doesn't leave the
  // field undefined.
  const counts: BuildCounts = {
    recordCount: 0,
    binaryPairs: 0,
    binaryMutualPairs: 0,
    gcvsEntries: 0,
    gcvsHipXrefs: 0,
    gcvsHdXrefs: 0,
    gcvsGaiaXrefs: 0,
    gcvsMatched: 0,
    gcvsMatchedByGaia: 0,
    gcvsMatchedByHip: 0,
    gcvsMatchedByHd: 0,
    gcvsNamed: 0,
    ccdmGroups: 0,
    ccdmResolved: 0,
    ccdmFlagged: 0,
    ccdmSuppressedOptical: 0,
    eclipsingWinged: 0,
    renderableCompanionWinged: 0,
    multiplicityResolved: 0,
    multiplicityUnresolved: 0,
    componentDesignations: 0,
    bjEntries: 0,
    bjEligible: 0,
    bjOverridden: 0,
    bjOverriddenByDistSrc: emptyDistSrcPartition(),
    lmcCandidates: 0,
    lmcOverridden: 0,
    lmcOverriddenByDistSrc: emptyDistSrcPartition(),
    nameTableEntries: 0,
    variableCount: 0,
    searchEntries: 0,
    solIndex: -1,
    figureCount: 0,
    figureConstellations: 0,
    gaiaSourceIdResolved: 0,
    gaiaSourceIdBackfilled: 0,
    gaiaBindingMagRejected: 0,
    gaiaBindingSiblingRejected: 0,
    simbadWdsXidsEntries: 0,
    apsisEntries: 0,
    apsisMatched: 0,
    apsisTeffEither: 0,
    simbadSptypeEntries: 0,
    spectralByCurated: 0,
    spectralBySimbad: 0,
    spectralByGspspec: 0,
    spectralFallback: 0,
    ciSpectralDerived: 0,
    multiplesIdentifierBackfill: 0,
    systemCoherenceSystems: 0,
    systemCoherenceRepositioned: 0,
    systemCoherenceMemberAnchorWins: 0,
    systemCoherenceSignificantDepthKept: 0,
    systemCoherenceAnchorInconsistent: 0,
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
    companionRepositionedCollocatedDouble: 0,
    companionConstellationInherited: 0,
    componentLettersStamped: 0,
    gaiaAstrometryEntries: 0,
    hip2Entries: 0,
    nssSourceIdEntries: 0,
    hipDistFullPrecision: 0,
    directionGaia5p: 0,
    directionGaiaNssSystemic: 0,
    directionHip2Saturated: 0,
    directionHip2PmDiscrepant: 0,
    directionAthygPrinted: 0,
    velocityGaiaPm: 0,
    velocityHip2Pm: 0,
    velocityAthygPm: 0,
    velocityZero: 0,
    velocityClamped: 0,
    velocityAboveEscape: 0,
    velocityRvApplied: 0,
  };

  // Bailer-Jones DR3 distance posteriors. Optional in CI / fresh-clone
  // builds where the LFS file hasn't pulled yet — without it every star
  // keeps its naive 1/π AT-HYG distance.
  let bjMap = new Map<string, number>();
  if (existsSync(SRC_BAILER_JONES)) {
    console.log('Parsing Bailer-Jones DR3 distance posteriors...');
    const tBj = Date.now();
    bjMap = parseBailerJonesTsv(readFileSync(SRC_BAILER_JONES, 'utf8'));
    console.log(`  ${bjMap.size} entries in ${Date.now() - tBj}ms`);
    counts.bjEntries = bjMap.size;
  } else {
    console.log('Bailer-Jones DR3 file not found; skipping distance override.');
  }

  // Gaia DR3 Apsis (gspphot ∪ gspspec) astrophysical parameters. Optional
  // in CI / fresh-clone builds where the LFS file hasn't pulled yet —
  // without it every record gets the NO_APSIS sentinel.
  let apsisMap = new Map<string, ApsisRow>();
  if (existsSync(SRC_GAIA_APSIS)) {
    console.log('Parsing Gaia DR3 Apsis astrophysical parameters...');
    const tApsis = Date.now();
    apsisMap = parseGaiaApsisTsv(readFileSync(SRC_GAIA_APSIS, 'utf8'));
    console.log(`  ${apsisMap.size} entries in ${Date.now() - tApsis}ms`);
    counts.apsisEntries = apsisMap.size;
  } else {
    console.log('Gaia DR3 Apsis file not found; skipping astrophysical-parameter surface.');
  }

  // SIMBAD sp_type indexed by Gaia DR3 source_id and by HIP. First tier
  // of the spectral resolver; the binary defaults to GSP-Spec + unknown
  // sentinel without it.
  let simbadSpectral: SimbadSpectralIndex = { bySource: new Map(), byHip: new Map() };
  if (existsSync(SRC_SIMBAD_SPTYPE)) {
    console.log('Parsing SIMBAD sp_type catalogue...');
    const tSimbad = Date.now();
    simbadSpectral = parseSimbadSptypeTsv(readFileSync(SRC_SIMBAD_SPTYPE, 'utf8'));
    console.log(`  ${simbadSpectral.bySource.size} entries in ${Date.now() - tSimbad}ms`);
    counts.simbadSptypeEntries = simbadSpectral.bySource.size;
  } else {
    console.warn(
      `WARNING: ${SRC_SIMBAD_SPTYPE} not found — spectral classification will\n` +
      `         fall through to Gaia DR3 GSP-Spec and the unknown sentinel.\n` +
      `         Re-run scripts/refresh/refresh-simbad-sptype.py to restore\n` +
      `         the SIMBAD tier.`,
    );
  }

  // SIMBAD WDS cross-IDs — the sibling-letter gate's attribution source.
  // Optional: without it the gate never fires and a mis-keyed blend row
  // keeps its cross-walk source (pre-gate behaviour).
  let wdsXids: SimbadWdsXidIndex | null = null;
  if (existsSync(SRC_SIMBAD_WDS_XIDS)) {
    console.log('Parsing SIMBAD WDS cross-IDs...');
    const tXids = Date.now();
    wdsXids = parseSimbadWdsXidsTsv(readFileSync(SRC_SIMBAD_WDS_XIDS, 'utf8'));
    console.log(`  ${wdsXids.bySource.size} sources in ${Date.now() - tXids}ms`);
    counts.simbadWdsXidsEntries = wdsXids.bySource.size;
  } else {
    console.warn(
      `WARNING: ${SRC_SIMBAD_WDS_XIDS} not found — the sibling-letter\n` +
      `         attribution gate is disabled. Re-run\n` +
      `         scripts/refresh/refresh-simbad-wds-xids.py to restore it.`,
    );
  }

  // HIP → Gaia DR3 source_id cross-walk: loaded once and shared between
  // the AT-HYG single-star backfill in readStars and the GCVS byGaia
  // bridge below.
  let hipToGaia: Map<number, string> | null = null;
  if (existsSync(SRC_GAIA_HIP_XMATCH)) {
    console.log('Parsing Gaia DR3 ↔ HIP cross-walk...');
    const tHx = Date.now();
    hipToGaia = readGaiaHipXmatch(SRC_GAIA_HIP_XMATCH);
    console.log(`  ${hipToGaia.size} entries in ${Date.now() - tHx}ms`);
  } else {
    console.log('Gaia DR3 ↔ HIP cross-walk not found; backfill + GCVS bridge skipped.');
  }

  // Direction-cascade inputs: Gaia DR3 5p astrometry, HIP2 van Leeuwen,
  // and the NSS two-body source_id set. Each optional in CI / fresh-clone
  // builds — a missing file degrades that tier and the cascade falls
  // through (ultimately to AT-HYG's printed ra/dec), which the
  // build-counts assertion then flags.
  const directions: DirectionSources = {
    gaiaAstrometry: new Map(),
    hip2: new Map(),
    nssSourceIds: new Set(),
  };
  if (existsSync(SRC_GAIA_ASTROMETRY)) {
    console.log('Parsing Gaia DR3 5p astrometry (full catalog)...');
    const tAstro = Date.now();
    directions.gaiaAstrometry = parseGaiaAstrometryCatalogTsv(readFileSync(SRC_GAIA_ASTROMETRY, 'utf8'));
    console.log(`  ${directions.gaiaAstrometry.size} entries in ${Date.now() - tAstro}ms`);
    counts.gaiaAstrometryEntries = directions.gaiaAstrometry.size;
  } else {
    console.warn(
      `WARNING: ${SRC_GAIA_ASTROMETRY} not found — direction cascade tier 1\n` +
      `         unavailable; sky directions fall back to HIP2 / AT-HYG printed\n` +
      `         ra/dec. Re-run scripts/refresh/refresh-gaia-astrometry-catalog.py.`,
    );
  }
  if (existsSync(SRC_HIP2)) {
    console.log('Parsing HIP2 van Leeuwen astrometry...');
    const tHip2 = Date.now();
    directions.hip2 = parseHip2Tsv(readFileSync(SRC_HIP2, 'utf8'));
    console.log(`  ${directions.hip2.size} entries in ${Date.now() - tHip2}ms`);
    counts.hip2Entries = directions.hip2.size;
  } else {
    console.warn(
      `WARNING: ${SRC_HIP2} not found — direction cascade tier 2 unavailable\n` +
      `         and dist_src=HIP rows keep AT-HYG's 4-dp distance print.`,
    );
  }
  if (existsSync(SRC_GAIA_NSS)) {
    console.log('Parsing Gaia DR3 NSS two-body source_ids...');
    const tNss = Date.now();
    directions.nssSourceIds = parseNssSourceIdSet(readFileSync(SRC_GAIA_NSS, 'utf8'));
    console.log(`  ${directions.nssSourceIds.size} source_ids in ${Date.now() - tNss}ms`);
    counts.nssSourceIdEntries = directions.nssSourceIds.size;
  } else {
    console.warn(
      `WARNING: ${SRC_GAIA_NSS} not found — NSS-systemic tagging disabled\n` +
      `         (affects routing counts only; positions stay Gaia 5p).`,
    );
  }

  // Build-time de-extinction integral. Absent dust is a HARD FAIL (not
  // the Bailer-Jones soft-continue): a soft-continue would carry
  // extincted absmags into a runtime that assumes de-extincted, silently
  // reintroducing the double-count the runtime raymarch fixes.
  console.log('Loading dust grid for build-time de-extinction...');
  const tDust = Date.now();
  const dustGrid = loadDustGrid(SRC_DUST_DIR);
  console.log(
    `  loaded ${dustGrid.gridSize}³ voxel grid in ${Date.now() - tDust}ms`,
  );

  console.log(`Reading ${SRC_CSV}...`);
  const t0 = Date.now();
  const { stars, stats } = await readStars(
    SRC_CSV, CON_INDEX, bjMap, hipToGaia, simbadSpectral, apsisMap, directions,
    dustGrid, wdsXids,
  );
  console.log(`  parsed ${stats.total} rows in ${Date.now() - t0}ms`);
  console.log(`  kept ${stars.length} stars`);
  console.log(`  dropped:`, stats.dropped);
  if (stats.bjEligible > 0) {
    const pct = ((stats.bjOverridden / stats.bjEligible) * 100).toFixed(1);
    console.log(
      `  Bailer-Jones override: ${stats.bjOverridden} / ${stats.bjEligible} ` +
        `Gaia-inverse-distance stars (${pct}%)`,
    );
    console.log(
      `    by dist_src: ${formatDistSrcPartition(stats.bjOverriddenByDistSrc)}`,
    );
  }
  if (stats.lmcCandidates > 0) {
    const pct = ((stats.lmcOverridden / stats.lmcCandidates) * 100).toFixed(1);
    console.log(
      `  LMC kinematic override: ${stats.lmcOverridden} / ${stats.lmcCandidates} ` +
        `LMC-cone stars (${pct}%)`,
    );
    console.log(
      `    by dist_src: ${formatDistSrcPartition(stats.lmcOverriddenByDistSrc)}`,
    );
  }
  if (stats.gaiaSourceIdBackfilled > 0) {
    console.log(
      `  gaia_source_id backfill: ${stats.gaiaSourceIdBackfilled} rows via HIP→Gaia cross-walk`,
    );
  }
  const dv = stats.directionVia;
  console.log(
    `  direction cascade: gaia_5p ${dv.gaia_5p}, ` +
      `gaia_nss_systemic ${dv.gaia_nss_systemic}, ` +
      `hip2_saturated ${dv.hip2_saturated}, ` +
      `hip2_pm_discrepant ${dv.hip2_pm_discrepant}, ` +
      `athyg_printed ${dv.athyg_printed}`,
  );
  const vv = stats.velocityVia;
  console.log(
    `  velocity cascade: gaia_pm ${vv.gaia_pm}, hip2_pm ${vv.hip2_pm}, ` +
      `athyg_pm ${vv.athyg_pm}, zero ${vv.zero} (clamped ${stats.velocityClamped}); ` +
      `rv applied ${stats.rvApplied}`,
  );
  if (stats.velocityClampedSample.length > 0) {
    console.log(`  velocity clamped (>${VELOCITY_SANITY_CEILING_KM_S} km/s, zeroed as artifacts):`);
    for (const s of stats.velocityClampedSample) console.log(`    ${s}`);
  }
  console.log(
    `  velocity above escape (>${GALACTIC_ESCAPE_VELOCITY_KM_S} km/s, kept + tracked): ${stats.velocityAboveEscape} ` +
      `— sample (first ${stats.velocityAboveEscapeSample.length}):`,
  );
  for (const s of stats.velocityAboveEscapeSample) console.log(`    ${s}`);
  if (stats.hipDistFullPrecision > 0) {
    console.log(
      `  HIP2 full-precision distances: ${stats.hipDistFullPrecision} dist_src=HIP rows`,
    );
  }
  // recordCount is the final post-promotion count; populated after the
  // companion-promotion pass below.
  counts.bjEligible = stats.bjEligible;
  counts.bjOverridden = stats.bjOverridden;
  counts.bjOverriddenByDistSrc = stats.bjOverriddenByDistSrc;
  counts.hipDistFullPrecision = stats.hipDistFullPrecision;
  counts.lmcCandidates = stats.lmcCandidates;
  counts.lmcOverridden = stats.lmcOverridden;
  counts.lmcOverriddenByDistSrc = stats.lmcOverriddenByDistSrc;
  counts.gaiaSourceIdBackfilled = stats.gaiaSourceIdBackfilled;
  counts.gaiaBindingMagRejected = stats.gaiaBindingMagRejected;
  counts.gaiaBindingSiblingRejected = stats.gaiaBindingSiblingRejected;
  counts.directionGaia5p = dv.gaia_5p;
  counts.directionGaiaNssSystemic = dv.gaia_nss_systemic;
  counts.directionHip2Saturated = dv.hip2_saturated;
  counts.directionHip2PmDiscrepant = dv.hip2_pm_discrepant;
  counts.directionAthygPrinted = dv.athyg_printed;
  counts.velocityGaiaPm = vv.gaia_pm;
  counts.velocityHip2Pm = vv.hip2_pm;
  counts.velocityAthygPm = vv.athyg_pm;
  counts.velocityZero = vv.zero;
  counts.velocityClamped = stats.velocityClamped;
  counts.velocityAboveEscape = stats.velocityAboveEscape;
  counts.velocityRvApplied = stats.rvApplied;
  counts.spectralByCurated = stats.spectralByCurated;
  counts.spectralBySimbad = stats.spectralBySimbad;
  counts.spectralByGspspec = stats.spectralByGspspec;
  counts.spectralFallback = stats.spectralFallback;
  counts.ciSpectralDerived = stats.ciSpectralDerived;

  const simbadPct = ((stats.spectralBySimbad / stars.length) * 100).toFixed(1);
  const gspspecPct = ((stats.spectralByGspspec / stars.length) * 100).toFixed(1);
  const fallbackPct = ((stats.spectralFallback / stars.length) * 100).toFixed(1);
  console.log(
    `  spectral classification: curated ${stats.spectralByCurated}, ` +
      `SIMBAD ${stats.spectralBySimbad} (${simbadPct}%), ` +
      `GSP-Spec ${stats.spectralByGspspec} (${gspspecPct}%), ` +
      `unknown ${stats.spectralFallback} (${fallbackPct}%)`,
  );

  // Companion promotion — read data/binaries/multiples.tsv and add
  // first-class catalog records for the secondary of every physical pair
  // whose identifier isn't already in AT-HYG. Promoted companions ride
  // catalog.bin with FLAG_BINARY_COMPANION_ONLY set; the renderer/picker
  // hover/focus stack picks them up with zero code change.
  const multiplesRows = existsSync(SRC_MULTIPLES)
    ? readMultiplesTsv(SRC_MULTIPLES)
    : null;
  if (multiplesRows !== null) {
    // Identifier backfill BEFORE promotion: HD-only AT-HYG primaries
    // (ξ UMa) gain the HIP + Gaia source_id the binaries pipeline
    // resolved, so promotion's cursor-primary anchor and every
    // downstream HIP/Gaia lookup address the record.
    counts.multiplesIdentifierBackfill =
      backfillPrimaryIdentifiers(multiplesRows, stars, (star) => {
        if (star.spectClass !== UNKNOWN_CLASS_IDX) return;
        const spectral = resolveSpectralInfo(
          star.gaiaSourceId, star.hip, simbadSpectral, apsisMap,
        );
        if (spectral.info.classIdx === UNKNOWN_CLASS_IDX) return;
        const apsisTeff = resolveApsisTeff(
          star.gaiaSourceId ? apsisMap.get(star.gaiaSourceId) : null,
        );
        star.spectClass = spectral.info.classIdx;
        star.lumClass = spectral.info.lumClass;
        star.spectDisplay = resolveSpectDisplay(
          spectral.spectDisplay, star.spectDisplay ?? '',
        );
        star.physicalRadius = physicalRadius(star.absmag, spectral.info, apsisTeff);
      });
    console.log(
      `  backfilled identifiers onto ${counts.multiplesIdentifierBackfill} ` +
        `HD-only primaries from multiples.tsv`,
    );
    // Intra-system radial coherence BEFORE promotion, so minted members
    // project off already-coherent anchor positions.
    const coherence = applySystemDistanceCoherence(multiplesRows, stars, {
      gaiaAstrometry: directions.gaiaAstrometry,
      hip2: directions.hip2,
      bjMap,
    });
    console.log(
      `  system distance coherence: ${coherence.membersRepositioned} ` +
        `members repositioned across ${coherence.systemsProcessed} systems ` +
        `(${coherence.memberAnchorWins} member-anchor wins, ` +
        `${coherence.significantDepthKept} significant depths kept)`,
    );
    counts.systemCoherenceRepositioned = coherence.membersRepositioned;
    counts.systemCoherenceSystems = coherence.systemsProcessed;
    counts.systemCoherenceMemberAnchorWins = coherence.memberAnchorWins;
    counts.systemCoherenceSignificantDepthKept =
      coherence.significantDepthKept;
    counts.systemCoherenceAnchorInconsistent =
      coherence.anchorPlacementInconsistent;
    console.log('Promoting binary companions from multiples.tsv...');
    const tProm = Date.now();
    const { newStars, stats: ps, groups } = promoteCompanions(multiplesRows, stars, CONSTELLATIONS, dustGrid);
    for (const ns of newStars) stars.push(ns);
    console.log(
      `  scanned ${ps.pairRowsScanned} pair rows; promoted ${ps.promoted} ` +
        `(${ps.promotedSynthetic} via synthetic ID); ` +
        `already-in-catalog ${ps.alreadyInCatalog}; ` +
        `dropped (no-identifier=${ps.droppedNoIdentifier}, ` +
        `no-position=${ps.droppedNoPosition}, ` +
        `beyond-tidal=${ps.droppedBeyondTidalLimit}, ` +
        `no-absmag=${ps.droppedNoAbsmag}, ` +
        `no-primary=${ps.droppedNoPrimary}, ` +
        `compound-comp=${ps.droppedCompoundComp}, ` +
        `collocated-primary=${ps.droppedCollocatedPrimary}); ` +
        `absmag spectral-derived=${ps.absmagSpectralDerived}, ` +
        `spect ms-from-own-absmag=${ps.spectMsFromOwnAbsmag}, ` +
        `wds-mag-derived=${ps.absmagWdsMagDerived}, ` +
        `inherited-twin-orbital=${ps.absmagInheritedTwinOrbital}, ` +
        `blend-split=${ps.blendSplitRecords}, ` +
        `dimmed-anchors=${ps.blendDimmedAnchors} (skipped ${ps.blendDimSkipped}, ` +
        `unfit ${ps.blendDimMembersUnfit}, outside ${ps.blendDimMembersOutside}), ` +
        `repositioned-collocated-double=${ps.repositionedCollocatedDouble} ` +
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
    counts.companionRepositionedCollocatedDouble = ps.repositionedCollocatedDouble;
    counts.companionConstellationInherited = ps.constellationInherited;

    // Stamp component letters onto pairs AT-HYG left anonymous — both
    // halves first-class but printing the same Bayer/Flamsteed label
    // (61 Cyg A/B). Mutates proper/flags in place, so it must precede
    // the name-table + search-index write below.
    const stampStats = stampComponentLetters(groups, stars, CONSTELLATIONS);
    if (stampStats.rowsStamped > 0) {
      console.log(
        `  stamped ${stampStats.rowsStamped} component names across ` +
          `${stampStats.systemsStamped} anonymous-pair systems`,
      );
    }
    counts.componentLettersStamped = stampStats.rowsStamped;
  } else {
    console.log('multiples.tsv not found; skipping companion promotion.');
  }

  counts.recordCount = stars.length;

  // Sort by absolute magnitude ascending (brightest first). Record indices
  // are final after this point.
  stars.sort((a, b) => a.absmag - b.absmag);

  // HIP → record index over the absmag-sorted star array. Shared with the
  // CCDM doubles pass below so duplicate HIPs resolve identically.
  const hipToIndex = buildHipToIndex(stars);

  // Resolve Stellarium stick-figure lines to star indices. Throws if any
  // referenced HIP is missing from the catalog.
  const figureLines = buildFigureLines(SRC_STELLARIUM, hipToIndex);

  // Geometric binary inference.
  console.log('Inferring binary/multiple systems...');
  const tBin = Date.now();
  const binStats = inferBinaries(stars);
  console.log(
    `  ${binStats.pairs} companion assignments, ${binStats.mutualPairs} mutual pairs in ${Date.now() - tBin}ms`,
  );
  counts.binaryPairs = binStats.pairs;
  counts.binaryMutualPairs = binStats.mutualPairs;

  // GCVS variable-star cross-match. Optional — if the files aren't present
  // we just skip, no variability rendered. xref.byGaia is bridged from
  // byHip via gaia_dr3_hip_xmatch.tsv when present, so AT-HYG rows that
  // carry a gaia_source_id but no HIP cell still resolve.
  if (existsSync(SRC_GCVS) && existsSync(SRC_GCVS_XREF)) {
    console.log('Parsing GCVS variable-star catalogue...');
    const tGcvs = Date.now();
    const gcvsData = parseGcvsMain(SRC_GCVS);
    const xref = parseGcvsCrossref(SRC_GCVS_XREF);
    if (hipToGaia) {
      bridgeGcvsByGaia(xref, hipToGaia);
    }
    const m = applyVariability(stars, gcvsData, xref);
    console.log(
      `  ${gcvsData.size} GCVS entries, ${xref.byHip.size} Hip + ` +
        `${xref.byHd.size} HD + ${xref.byGaia.size} Gaia xrefs, ` +
        `${m.named} named for search (${m.matched} with a renderable period: ` +
        `gaia=${m.matchedByGaia}, hip=${m.matchedByHip}, hd=${m.matchedByHd}) ` +
        `in ${Date.now() - tGcvs}ms`,
    );
    counts.gcvsEntries = gcvsData.size;
    counts.gcvsHipXrefs = xref.byHip.size;
    counts.gcvsHdXrefs = xref.byHd.size;
    counts.gcvsGaiaXrefs = xref.byGaia.size;
    counts.gcvsMatched = m.matched;
    counts.gcvsMatchedByGaia = m.matchedByGaia;
    counts.gcvsMatchedByHip = m.matchedByHip;
    counts.gcvsMatchedByHd = m.matchedByHd;
    counts.gcvsNamed = m.named;
  } else {
    console.log('GCVS files not found; skipping variability cross-match.');
  }

  // Hipparcos CCDM double-star cross-match. Optional. Marks a primary on
  // the same FLAG_BINARY_PRIMARY bit the geometric pass uses, picking
  // exactly one primary per CCDM system so chart-mode wings surface both
  // sources without double-flagging components of the same system.
  if (existsSync(SRC_HIP_CCDM)) {
    console.log('Parsing Hipparcos CCDM double-star cross-reference...');
    const tCcdm = Date.now();
    const ccdmGroups = parseHipCcdm(SRC_HIP_CCDM);
    const { systems, flagged, suppressed } = applyDoublesFlag(
      stars,
      ccdmGroups,
      hipToIndex,
      collectPhysicalPairKeys(multiplesRows),
    );
    console.log(
      `  ${ccdmGroups.size} CCDM systems → ${systems} resolved in catalog, ${flagged} new primaries flagged, ${suppressed} suppressed as optical doubles in ${Date.now() - tCcdm}ms`,
    );
    counts.ccdmGroups = ccdmGroups.size;
    counts.ccdmResolved = systems;
    counts.ccdmFlagged = flagged;
    counts.ccdmSuppressedOptical = suppressed;
  } else {
    console.log('Hipparcos CCDM file not found; skipping double-star cross-match.');
  }

  // Reuse FLAG_BINARY_PRIMARY (the wings bit) for every varType ==
  // ECLIPSING record the geometric / CCDM passes didn't already flag —
  // eclipsers surface as multi-star systems, not intrinsic-variable rings
  // (see scripts/catalog/README.md § GCVS variability cross-match).
  // companionIdx stays unset where inference found no partner; the
  // renderer guards on companionIdx >= 0, so a flagged-but-companionless
  // primary is safe.
  let eclipsingWinged = 0;
  for (const s of stars) {
    if (s.varType === VAR_TYPE_ECLIPSING && (s.flags & FLAG_BINARY_PRIMARY) === 0) {
      s.flags |= FLAG_BINARY_PRIMARY;
      eclipsingWinged++;
    }
  }
  counts.eclipsingWinged = eclipsingWinged;
  console.log(`  ${eclipsingWinged} eclipsing binaries flagged as multi-star (wings)`);

  // Built here (not at the sidecar write below) so the wings pass resolves
  // multiples.tsv rows exactly as the runtime binaries loader will.
  const rowIndexMap = buildCatalogRowIndexMap(stars);

  let componentDesignations = new Map<number, ComponentDesignation>();
  let multiplesMemberIndices = new Set<number>();
  if (multiplesRows !== null) {
    const { winged: renderableCompanionWinged, memberIndices } = wingRenderablePrimaries(
      multiplesRows,
      stars,
      rowIndexMap,
    );
    multiplesMemberIndices = memberIndices;
    counts.renderableCompanionWinged = renderableCompanionWinged;
    console.log(
      `  ${renderableCompanionWinged} renderable-companion primaries flagged as multi-star (wings)`,
    );

    componentDesignations = buildComponentDesignations(multiplesRows, rowIndexMap);
    counts.componentDesignations = componentDesignations.size;
    console.log(
      `  ${componentDesignations.size} component designations for "<system> <letter>" search`,
    );
  }

  // Per-record multiplicity status (v9): resolved = a multiples.tsv member
  // row backs the record; unresolved = SIMBAD otype '**' by Gaia source_id
  // with no resolved member row (spectroscopic binaries invisible to
  // WDS/CCDM/NSS — 64 Vir).
  const multiplicityStatus = new Uint8Array(stars.length);
  for (const idx of multiplesMemberIndices) multiplicityStatus[idx] = MULTIPLICITY_RESOLVED;
  for (let i = 0; i < stars.length; i++) {
    if (multiplicityStatus[i] !== MULTIPLICITY_SINGLE) continue;
    const srcId = stars[i].gaiaSourceId;
    if (!srcId) continue;
    if (simbadSpectral.bySource.get(srcId)?.otype === SIMBAD_OTYPE_MULTIPLE) {
      multiplicityStatus[i] = MULTIPLICITY_UNRESOLVED;
    }
  }
  counts.multiplicityResolved = multiplesMemberIndices.size;
  counts.multiplicityUnresolved = multiplicityStatus.reduce(
    (n, v) => n + (v === MULTIPLICITY_UNRESOLVED ? 1 : 0), 0,
  );
  console.log(
    `  multiplicity: ${counts.multiplicityResolved} resolved, ` +
      `${counts.multiplicityUnresolved} unresolved (SIMBAD '**', nothing resolved)`,
  );

  // Resolve every record to its frozen Stellata ID from the committed
  // ledger. The build never mints — sid:allocate is the sole writer
  // (docs/sid.md § 4.4). Unallocated records get NO_SID and hard-fail the
  // build after the artifact lands, so sid:allocate can still consume it
  // (scripts/catalog/README.md § SID allocation).
  const registry = loadRegistry();
  const sidObjects: SidObject[] = stars.map((s, i) => ({
    designations: starDesignations({
      isSol: (s.flags & FLAG_IS_SOL) !== 0,
      hip: s.hip,
      hd: s.hd,
      hr: s.hr,
      gl: s.gl,
      gaiaSourceId: s.gaiaSourceId,
      syntheticId: s.syntheticId,
    }),
    kind: 'star',
    label: `record ${i}${s.proper ? ` (${s.proper})` : ''}`,
  }));
  const sidResolution = resolveSids({
    objects: sidObjects,
    storedEdges: registry.storedEdges,
    ledger: registry.ledger,
    retirements: registry.retirements,
    reinstatements: registry.reinstatements,
  });
  const recordSids = sidResolution.objectSids;

  // Build name table — just proper names. Bayer/Flam/HIP/etc. go in
  // search-index.json so the main binary stays compact.
  const encoder = new TextEncoder();
  const nameChunks: Uint8Array[] = [];
  const nameOffsets = new Uint32Array(stars.length);
  // Offset 0 is reserved as the "no name" sentinel. Real names start at
  // offset >= NAME_TABLE_PADDING after the leading zero-bytes.
  let nameTableLength = NAME_TABLE_PADDING;
  nameChunks.push(new Uint8Array(NAME_TABLE_PADDING));
  for (let i = 0; i < stars.length; i++) {
    if (!stars[i].proper) continue;
    const bytes = encoder.encode(stars[i].proper!);
    if (bytes.length > 0xffff) {
      throw new Error(`Name too long: ${stars[i].proper}`);
    }
    nameOffsets[i] = nameTableLength;
    const lenHeader = new Uint8Array(NAME_LENGTH_PREFIX_BYTES);
    new DataView(lenHeader.buffer).setUint16(0, bytes.length, true);
    nameChunks.push(lenHeader);
    nameChunks.push(bytes);
    nameTableLength += NAME_LENGTH_PREFIX_BYTES + bytes.length;
    counts.nameTableEntries++;
  }

  // Allocate output buffer.
  const recordsLength = stars.length * RECORD_SIZE;
  const totalLength = HEADER_SIZE + recordsLength + nameTableLength;
  const out = new ArrayBuffer(totalLength);
  const view = new DataView(out);
  const bytes = new Uint8Array(out);

  // Header.
  writeCatalogHeader(view, {
    count: stars.length,
    nameTableOffset: HEADER_SIZE + recordsLength,
    nameTableLength,
  });

  // Records.
  let off = HEADER_SIZE;
  let solIndex = -1;
  let variableCount = 0;
  let gaiaSourceIdResolved = 0;
  let apsisMatched = 0;
  let apsisTeffEither = 0;
  for (let i = 0; i < stars.length; i++) {
    const s = stars[i];
    // Variability: amplitude clamps at 12.75 mag (extreme Miras), period at
    // 6553 days (rare long-period symbiotics). Period = 0 is the shader's
    // "not variable" sentinel.
    const isVariable = s.periodDays > 0 && s.amplitudeMag > 0;
    const ampUnits = isVariable ? encodeAmpUnits(s.amplitudeMag) : 0;
    const periodUnits = isVariable ? encodePeriodUnits(s.periodDays) : 0;
    if (ampUnits > 0 && periodUnits > 0) variableCount++;
    // Gaia DR3 source_ids exceed Number.MAX_SAFE_INTEGER; parse the
    // AT-HYG column as BigInt to preserve every bit before writing.
    const gaiaSourceId = s.gaiaSourceId ? BigInt(s.gaiaSourceId) : NO_GAIA_SOURCE_ID;
    if (gaiaSourceId !== NO_GAIA_SOURCE_ID) gaiaSourceIdResolved++;

    // Apsis lookup keyed by gaia_source_id string (BigInt key would
    // require a parallel string map). NO_APSIS (NaN) fills every cell
    // when the source_id is absent from the TSV or the row's cell is blank.
    const apsisRow = s.gaiaSourceId ? apsisMap.get(s.gaiaSourceId) : undefined;
    const apsis = {} as Record<ApsisField, number>;
    for (const name of APSIS_FIELDS) apsis[name] = apsisRow?.[name] ?? NO_APSIS;
    if (apsisRow) apsisMatched++;
    if (apsisRow && (apsisRow.teffGspphot !== null || apsisRow.teffGspspec !== null)) {
      apsisTeffEither++;
    }

    writeStarRecord(view, off, {
      x: s.x, y: s.y, z: s.z,
      vx: s.vx, vy: s.vy, vz: s.vz,
      absmag: s.absmag,
      ci: s.ci,
      physRadius: s.physicalRadius,
      companionIdx: s.companionIdx >= 0 ? s.companionIdx : NO_COMPANION,
      nameOffset: s.proper ? nameOffsets[i] : 0,
      spectClass: s.spectClass,
      lumClass: s.lumClass,
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

    if (s.flags & FLAG_IS_SOL) solIndex = i;
    off += RECORD_SIZE;
  }

  // Name table.
  for (const chunk of nameChunks) {
    bytes.set(chunk, off);
    off += chunk.length;
  }

  if (off !== totalLength) {
    throw new Error(`Size mismatch: wrote ${off}, expected ${totalLength}`);
  }

  await mkdir(PUBLIC_DIR, { recursive: true });
  await removeStaleCatalogChunks(PUBLIC_DIR);
  const chunkBytes = planCatalogChunks(totalLength);
  const sidSuccessors = sidSuccessorPairs(registry.retirements, registry.reinstatements);
  const manifest: CatalogManifest = {
    chunkBytes,
    totalBytes: totalLength,
    ...(sidSuccessors.length > 0 ? { sidSuccessors } : {}),
  };
  let chunkOff = 0;
  for (let i = 0; i < chunkBytes.length; i++) {
    await writeFile(
      resolve(PUBLIC_DIR, catalogChunkFilename(i)),
      Buffer.from(out, chunkOff, chunkBytes[i]),
    );
    chunkOff += chunkBytes[i];
  }
  await writeFile(OUT_MANIFEST, JSON.stringify(manifest) + '\n');

  // Constellations JSON (unchanged from v1 format).
  const constellationsOut = CONSTELLATIONS.map((c, idx) => {
    const lines = figureLines.get(idx);
    return lines ? { ...c, lines } : { ...c };
  });
  await writeFile(OUT_CON, JSON.stringify(constellationsOut) + '\n');

  // Search index — one entry per star with at least one identifier the
  // user might type. buildSearchEntry owns the wire shape (catalog-pure.ts).
  const searchEntries: SearchEntry[] = [];
  for (let i = 0; i < stars.length; i++) {
    const entry = buildSearchEntry(stars[i], i, componentDesignations.get(i));
    if (entry) searchEntries.push(entry);
  }
  await writeFile(OUT_SEARCH, JSON.stringify(searchEntries) + '\n');

  // Catalog row-index map sidecar — lets the runtime binaries loader
  // resolve a multiples.tsv row's identifier to a catalog.bin record
  // index without scanning every record at startup. Keyed by Gaia DR3
  // source_id (decimal string, since source_ids exceed 2^53), HIP, and
  // synthetic identifier (`synth-<wds_id>-<comp>` for promoted companions
  // that carry no real ID — Algol Ab). Built once above, after the sort.
  await writeFile(OUT_ROW_INDEX_MAP, JSON.stringify(rowIndexMap) + '\n');
  console.log(
    `Wrote ${OUT_ROW_INDEX_MAP} (${Object.keys(rowIndexMap.byGaia).length} ` +
      `Gaia entries, ${Object.keys(rowIndexMap.byHip).length} HIP entries, ` +
      `${Object.keys(rowIndexMap.bySynth).length} synthetic entries)`,
  );

  const figureCount = [...figureLines.values()].reduce(
    (n, arr) => n + arr.length,
    0,
  );
  const mb = (totalLength / 1024 / 1024).toFixed(2);
  console.log(
    `Wrote ${chunkBytes.length} catalog chunk(s) + ${OUT_MANIFEST} ` +
      `(${mb} MB, ${stars.length} records, v${BINARY_VERSION})`,
  );
  console.log(
    `Wrote ${OUT_CON} (${CONSTELLATIONS.length} constellations, ${figureCount} stick-figure polylines across ${figureLines.size})`,
  );
  const searchMb = (statSync(OUT_SEARCH).size / 1024 / 1024).toFixed(2);
  console.log(`Wrote ${OUT_SEARCH} (${searchEntries.length} searchable entries, ${searchMb} MB)`);
  if (solIndex >= 0) {
    console.log(
      `Sol at record index ${solIndex} (absmag=${stars[solIndex].absmag}, R=${stars[solIndex].physicalRadius.toFixed(3)} R☉)`,
    );
  } else {
    console.warn(`Warning: Sol not found in catalog.`);
  }

  counts.variableCount = variableCount;
  counts.searchEntries = searchEntries.length;
  counts.solIndex = solIndex;
  counts.figureCount = figureCount;
  counts.figureConstellations = figureLines.size;
  counts.gaiaSourceIdResolved = gaiaSourceIdResolved;
  counts.apsisMatched = apsisMatched;
  counts.apsisTeffEither = apsisTeffEither;

  if (apsisMap.size > 0) {
    const matchedPct = ((apsisMatched / stars.length) * 100).toFixed(1);
    const teffPct = ((apsisTeffEither / stars.length) * 100).toFixed(1);
    console.log(
      `Gaia DR3 Apsis: ${apsisMatched} / ${stars.length} records matched (${matchedPct}%), ` +
        `Teff (gspphot OR gspspec) on ${apsisTeffEither} (${teffPct}%)`,
    );
  }

  const sidResolved = recordSids.reduce((n, sid) => (sid !== 0 ? n + 1 : n), 0);
  console.log(`SID: ${sidResolved} / ${stars.length} records resolved to a ledger SID`);
  if (sidResolution.errors.length > 0) {
    const preview = sidResolution.errors.slice(0, 10);
    console.error(
      `\nSID resolution failed for ${sidResolution.errors.length} record(s):\n  ` +
        preview.join('\n  ') +
        (sidResolution.errors.length > preview.length
          ? `\n  … and ${sidResolution.errors.length - preview.length} more`
          : '') +
        `\ncatalog.bin was written with NO_SID placeholders so the ledger can be ` +
        `updated.\nRun \`pnpm run sid:allocate\` to mint the missing SIDs, then rebuild.`,
    );
    process.exit(1);
  }

  await assertOrUpdateBuildCounts(counts);
  await assertOrUpdateDistanceOutliers(stars);
}

async function assertOrUpdateSnapshot<T>(opts: {
  envVar: string;
  snapshotPath: string;
  actual: T;
  compare: (expected: T, actual: T) => { drifted: boolean; report: string };
  refreshTransform?: (expected: T, actual: T) => T;
  failureLabel: string;
  refreshCommand: string;
}): Promise<void> {
  const shouldUpdate = process.env[opts.envVar] === '1';
  const expected = existsSync(opts.snapshotPath)
    ? (JSON.parse(readFileSync(opts.snapshotPath, 'utf8')) as T)
    : null;

  if (shouldUpdate || !expected) {
    const toWrite = expected && opts.refreshTransform
      ? opts.refreshTransform(expected, opts.actual)
      : opts.actual;
    await writeFile(opts.snapshotPath, JSON.stringify(toWrite, null, 2) + '\n');
    console.log(`${shouldUpdate ? 'Updated' : 'Wrote initial'} ${opts.snapshotPath}`);
    return;
  }

  const { drifted, report } = opts.compare(expected, opts.actual);
  console.log(report);
  if (drifted) {
    console.error(
      `\n${opts.failureLabel} assertion failed. If the change is intentional,\n` +
        `refresh the snapshot with: ${opts.refreshCommand}`,
    );
    process.exit(1);
  }
}

async function assertOrUpdateBuildCounts(actual: BuildCounts): Promise<void> {
  await assertOrUpdateSnapshot<BuildCounts>({
    envVar: 'UPDATE_BUILD_COUNTS',
    snapshotPath: EXPECTED_COUNTS,
    actual,
    compare: (expected, actual) => {
      const diff = compareBuildCounts(expected, actual);
      return {
        drifted: diff.some((d) => d.status === 'mismatch'),
        report: formatCountDiff(diff),
      };
    },
    failureLabel: 'build-catalog count',
    refreshCommand: 'UPDATE_BUILD_COUNTS=1 pnpm run build:catalog',
  });
}

// Missing simbad_sample.tsv is a hard fail — the file is committed (LFS)
// and absence indicates a broken working tree.
async function assertOrUpdateDistanceOutliers(stars: readonly Star[]): Promise<void> {
  if (!existsSync(SRC_SIMBAD_SAMPLE)) {
    console.error(
      `Missing ${SRC_SIMBAD_SAMPLE} — committed SIMBAD sample is unavailable.\n` +
        `Confirm git LFS is pulled (\`git lfs pull\`) and the file is present.`,
    );
    process.exit(1);
  }
  const simbadSample = parseSimbadSampleTsv(readFileSync(SRC_SIMBAD_SAMPLE, 'utf8'));
  const report = buildRegressionReport(stars, simbadSample);
  console.log(
    `distance-regression: SIMBAD sample loaded (${simbadSample.size} keys); ` +
      `selfConsistency outliers=${report.selfConsistency.length}, ` +
      `SIMBAD outliers=${report.simbad.length}`,
  );

  await assertOrUpdateSnapshot<RegressionReport>({
    envVar: 'UPDATE_DISTANCE_OUTLIERS',
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
    refreshCommand: 'UPDATE_DISTANCE_OUTLIERS=1 pnpm run build:catalog',
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
