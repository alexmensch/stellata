// Orchestrator for the catalog build pipeline — writes
// public/catalog.bin, public/constellations.json, and
// public/search-index.json. See scripts/catalog/README.md.

import { statSync, existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseBailerJonesTsv,
  parseGaiaApsisTsv,
  parseSimbadSptypeTsv,
  buildHipToIndex,
  inferBinaries,
  DIST_SRC_BAILER_JONES,
  DIST_SRC_LMC_KIN,
  FLAG_IS_SOL,
  HEADER_LAYOUT,
  RECORD_LAYOUT,
  HEADER_SIZE,
  RECORD_SIZE,
  BINARY_VERSION,
  MAGIC,
  NO_COMPANION,
  NO_GAIA_SOURCE_ID,
  NO_APSIS,
  NAME_TABLE_PADDING,
  NAME_LENGTH_PREFIX_BYTES,
  type ApsisRow,
  type SearchEntry,
  type SimbadSpectralIndex,
} from './catalog-pure';
import {
  compareBuildCounts,
  formatCountDiff,
  type BuildCounts,
} from './build-counts';
import {
  buildRegressionReport,
  compareRegressionReports,
  formatRegressionDiff,
  mergeReasonsFromSnapshot,
  parseSimbadSampleTsv,
  type RegressionReport,
} from './distance-regression-check';
import {
  CONSTELLATIONS,
  CON_INDEX,
  buildFigureLines,
} from './constellations';
import {
  parseHipCcdm,
  applyDoublesFlag,
} from './visual-doubles';
import {
  buildCatalogRowIndexMap,
  promoteCompanions,
  readMultiplesTsv,
  stampComponentLetters,
} from './companion-promotion';
import {
  parseGcvsMain,
  parseGcvsCrossref,
  bridgeGcvsByGaia,
  applyVariability,
} from './gcvs-parse';
import { readGaiaHipXmatch } from './gaia-xmatch';
import {
  parseGaiaAstrometryCatalogTsv,
  parseHip2Tsv,
  parseNssSourceIdSet,
  type DirectionSources,
} from './direction-cascade';
import { readStars, type Star } from './stars-parse';
import { loadDustGrid } from './dust-deextinction';
import { REPO_ROOT as ROOT, mtimeIfExists } from '../util/paths';

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
const SRC_SIMBAD_SAMPLE = resolve(ROOT, 'data/simbad/simbad_sample.tsv');
const SRC_MULTIPLES = resolve(ROOT, 'data/binaries/multiples.tsv');
const SRC_DUST_DIR = resolve(ROOT, 'data/dust');
const SRC_DUST_MANIFEST = resolve(SRC_DUST_DIR, 'manifest.json');
const OUT_BIN = resolve(ROOT, 'public/catalog.bin');
const OUT_CON = resolve(ROOT, 'public/constellations.json');
const OUT_SEARCH = resolve(ROOT, 'public/search-index.json');
const OUT_ROW_INDEX_MAP = resolve(ROOT, 'public/catalog-row-index-map.json');
const EXPECTED_COUNTS = resolve(__dirname, 'build-catalog-expected.json');
const EXPECTED_OUTLIERS = resolve(__dirname, 'build-distance-outliers-expected.json');

function isUpToDate(): boolean {
  if (!existsSync(OUT_BIN) || !existsSync(OUT_CON) || !existsSync(OUT_SEARCH)) return false;
  if (!existsSync(OUT_ROW_INDEX_MAP)) return false;
  const binMtime = statSync(OUT_BIN).mtimeMs;
  const srcMtime = statSync(SRC_CSV).mtimeMs;
  const stellariumMtime = mtimeIfExists(SRC_STELLARIUM);
  const gcvsMtime = mtimeIfExists(SRC_GCVS);
  const xrefMtime = mtimeIfExists(SRC_GCVS_XREF);
  const hipCcdmMtime = mtimeIfExists(SRC_HIP_CCDM);
  const bjMtime = mtimeIfExists(SRC_BAILER_JONES);
  const gaiaHipXmatchMtime = mtimeIfExists(SRC_GAIA_HIP_XMATCH);
  const apsisMtime = mtimeIfExists(SRC_GAIA_APSIS);
  const gaiaAstrometryMtime = mtimeIfExists(SRC_GAIA_ASTROMETRY);
  const gaiaNssMtime = mtimeIfExists(SRC_GAIA_NSS);
  const hip2Mtime = mtimeIfExists(SRC_HIP2);
  const simbadMtime = mtimeIfExists(SRC_SIMBAD_SPTYPE);
  const simbadSampleMtime = mtimeIfExists(SRC_SIMBAD_SAMPLE);
  const multiplesMtime = mtimeIfExists(SRC_MULTIPLES);
  const dustMtime = mtimeIfExists(SRC_DUST_MANIFEST);
  const scriptMtime = statSync(__filename).mtimeMs;
  return (
    binMtime > srcMtime &&
    binMtime > scriptMtime &&
    binMtime > stellariumMtime &&
    binMtime > gcvsMtime &&
    binMtime > xrefMtime &&
    binMtime > hipCcdmMtime &&
    binMtime > bjMtime &&
    binMtime > gaiaHipXmatchMtime &&
    binMtime > apsisMtime &&
    binMtime > gaiaAstrometryMtime &&
    binMtime > gaiaNssMtime &&
    binMtime > hip2Mtime &&
    binMtime > simbadMtime &&
    binMtime > simbadSampleMtime &&
    binMtime > multiplesMtime &&
    binMtime > dustMtime
  );
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

  if (isUpToDate()) {
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
    ccdmGroups: 0,
    ccdmResolved: 0,
    ccdmFlagged: 0,
    bjEntries: 0,
    bjEligible: 0,
    bjOverridden: 0,
    lmcCandidates: 0,
    lmcOverridden: 0,
    nameTableEntries: 0,
    variableCount: 0,
    searchEntries: 0,
    solIndex: -1,
    figureCount: 0,
    figureConstellations: 0,
    gaiaSourceIdResolved: 0,
    gaiaSourceIdBackfilled: 0,
    apsisEntries: 0,
    apsisMatched: 0,
    apsisTeffEither: 0,
    simbadSptypeEntries: 0,
    spectralBySimbad: 0,
    spectralByGspspec: 0,
    spectralFallback: 0,
    companionRowsScanned: 0,
    companionPromoted: 0,
    companionPromotedSynthetic: 0,
    companionAlreadyInCatalog: 0,
    companionDroppedNoIdentifier: 0,
    companionDroppedNoPosition: 0,
    companionDroppedNoAbsmag: 0,
    companionDroppedCompoundComp: 0,
    companionDroppedCollocatedPrimary: 0,
    companionAbsmagSpectralDerived: 0,
    companionAbsmagAnchorCollocated: 0,
    companionAbsmagInheritedTwinOrbital: 0,
    companionRepositionedCollocatedDouble: 0,
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
    dustGrid,
  );
  console.log(`  parsed ${stats.total} rows in ${Date.now() - t0}ms`);
  console.log(`  kept ${stars.length} stars`);
  console.log(`  dropped:`, stats.dropped);
  if (stats.bjEligible > 0) {
    const pct = ((stats.bjOverridden / stats.bjEligible) * 100).toFixed(1);
    console.log(
      `  Bailer-Jones override: ${stats.bjOverridden} / ${stats.bjEligible} ` +
        `Gaia-inverse-distance stars (${pct}%) → dist_src='${DIST_SRC_BAILER_JONES}'`,
    );
  }
  if (stats.lmcCandidates > 0) {
    const pct = ((stats.lmcOverridden / stats.lmcCandidates) * 100).toFixed(1);
    console.log(
      `  LMC kinematic override: ${stats.lmcOverridden} / ${stats.lmcCandidates} ` +
        `LMC-cone stars (${pct}%) → dist_src='${DIST_SRC_LMC_KIN}'`,
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
  if (stats.hipDistFullPrecision > 0) {
    console.log(
      `  HIP2 full-precision distances: ${stats.hipDistFullPrecision} dist_src=HIP rows`,
    );
  }
  // recordCount is the final post-promotion count; populated after the
  // companion-promotion pass below.
  counts.bjEligible = stats.bjEligible;
  counts.bjOverridden = stats.bjOverridden;
  counts.hipDistFullPrecision = stats.hipDistFullPrecision;
  counts.lmcCandidates = stats.lmcCandidates;
  counts.lmcOverridden = stats.lmcOverridden;
  counts.gaiaSourceIdBackfilled = stats.gaiaSourceIdBackfilled;
  counts.directionGaia5p = dv.gaia_5p;
  counts.directionGaiaNssSystemic = dv.gaia_nss_systemic;
  counts.directionHip2Saturated = dv.hip2_saturated;
  counts.directionHip2PmDiscrepant = dv.hip2_pm_discrepant;
  counts.directionAthygPrinted = dv.athyg_printed;
  counts.spectralBySimbad = stats.spectralBySimbad;
  counts.spectralByGspspec = stats.spectralByGspspec;
  counts.spectralFallback = stats.spectralFallback;

  const simbadPct = ((stats.spectralBySimbad / stars.length) * 100).toFixed(1);
  const gspspecPct = ((stats.spectralByGspspec / stars.length) * 100).toFixed(1);
  const fallbackPct = ((stats.spectralFallback / stars.length) * 100).toFixed(1);
  console.log(
    `  spectral classification: SIMBAD ${stats.spectralBySimbad} (${simbadPct}%), ` +
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
    console.log('Promoting binary companions from multiples.tsv...');
    const tProm = Date.now();
    const { newStars, stats: ps, groups } = promoteCompanions(multiplesRows, stars, CONSTELLATIONS, dustGrid);
    for (const ns of newStars) stars.push(ns);
    console.log(
      `  scanned ${ps.pairRowsScanned} pair rows; promoted ${ps.promoted} ` +
        `(${ps.promotedSynthetic} via synthetic ID); ` +
        `already-in-catalog ${ps.alreadyInCatalog}; ` +
        `dropped (no-identifier=${ps.droppedNoIdentifier}, ` +
        `no-position=${ps.droppedNoPosition}, no-absmag=${ps.droppedNoAbsmag}, ` +
        `no-primary=${ps.droppedNoPrimary}, ` +
        `compound-comp=${ps.droppedCompoundComp}, ` +
        `collocated-primary=${ps.droppedCollocatedPrimary}); ` +
        `absmag spectral-derived=${ps.absmagSpectralDerived}, ` +
        `inherited-twin-orbital=${ps.absmagInheritedTwinOrbital}, ` +
        `repositioned-collocated-double=${ps.repositionedCollocatedDouble} ` +
        `in ${Date.now() - tProm}ms`,
    );
    counts.companionRowsScanned = ps.pairRowsScanned;
    counts.companionPromoted = ps.promoted;
    counts.companionPromotedSynthetic = ps.promotedSynthetic;
    counts.companionAlreadyInCatalog = ps.alreadyInCatalog;
    counts.companionDroppedNoIdentifier = ps.droppedNoIdentifier;
    counts.companionDroppedNoPosition = ps.droppedNoPosition;
    counts.companionDroppedNoAbsmag = ps.droppedNoAbsmag;
    counts.companionDroppedCompoundComp = ps.droppedCompoundComp;
    counts.companionDroppedCollocatedPrimary = ps.droppedCollocatedPrimary;
    counts.companionAbsmagSpectralDerived = ps.absmagSpectralDerived;
    counts.companionAbsmagAnchorCollocated = ps.absmagAnchorCollocated;
    counts.companionAbsmagInheritedTwinOrbital = ps.absmagInheritedTwinOrbital;
    counts.companionRepositionedCollocatedDouble = ps.repositionedCollocatedDouble;

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
        `${m.matched} catalog stars matched ` +
        `(via gaia=${m.matchedByGaia}, hip=${m.matchedByHip}, hd=${m.matchedByHd}) ` +
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
    const { systems, flagged } = applyDoublesFlag(stars, ccdmGroups, hipToIndex);
    console.log(
      `  ${ccdmGroups.size} CCDM systems → ${systems} resolved in catalog, ${flagged} new primaries flagged in ${Date.now() - tCcdm}ms`,
    );
    counts.ccdmGroups = ccdmGroups.size;
    counts.ccdmResolved = systems;
    counts.ccdmFlagged = flagged;
  } else {
    console.log('Hipparcos CCDM file not found; skipping double-star cross-match.');
  }

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
  const magicBytes = encoder.encode(MAGIC);
  bytes.set(magicBytes, HEADER_LAYOUT.magic);
  view.setUint32(HEADER_LAYOUT.version, BINARY_VERSION, true);
  view.setUint32(HEADER_LAYOUT.count, stars.length, true);
  view.setUint32(HEADER_LAYOUT.nameTableOffset, HEADER_SIZE + recordsLength, true);
  view.setUint32(HEADER_LAYOUT.nameTableLength, nameTableLength, true);

  // Records.
  let off = HEADER_SIZE;
  let solIndex = -1;
  let variableCount = 0;
  let gaiaSourceIdResolved = 0;
  let apsisMatched = 0;
  let apsisTeffEither = 0;
  for (let i = 0; i < stars.length; i++) {
    const s = stars[i];
    view.setFloat32(off + RECORD_LAYOUT.x, s.x, true);
    view.setFloat32(off + RECORD_LAYOUT.y, s.y, true);
    view.setFloat32(off + RECORD_LAYOUT.z, s.z, true);
    view.setFloat32(off + RECORD_LAYOUT.absmag, s.absmag, true);
    view.setFloat32(off + RECORD_LAYOUT.ci, s.ci, true);
    view.setFloat32(off + RECORD_LAYOUT.physRadius, s.physicalRadius, true);
    view.setUint32(off + RECORD_LAYOUT.companion, s.companionIdx >= 0 ? s.companionIdx : NO_COMPANION, true);
    view.setUint32(off + RECORD_LAYOUT.nameOffset, s.proper ? nameOffsets[i] : 0, true);
    view.setUint8(off + RECORD_LAYOUT.spectClass, s.spectClass);
    view.setUint8(off + RECORD_LAYOUT.lumClass, s.lumClass);
    view.setUint8(off + RECORD_LAYOUT.conIndex, s.conIndex);
    view.setUint8(off + RECORD_LAYOUT.flags, s.flags);
    // Variability: amplitude clamps at 12.75 mag (extreme Miras), period at
    // 6553 days (rare long-period symbiotics). Period = 0 is the shader's
    // "not variable" sentinel.
    if (s.periodDays > 0 && s.amplitudeMag > 0) {
      const ampUnits = Math.min(255, Math.max(0, Math.round(s.amplitudeMag * 20)));
      const periodUnits = Math.min(65535, Math.max(0, Math.round(s.periodDays * 10)));
      view.setUint8(off + RECORD_LAYOUT.ampUnits, ampUnits);
      view.setUint16(off + RECORD_LAYOUT.period, periodUnits, true);
      if (ampUnits > 0 && periodUnits > 0) variableCount++;
    } else {
      view.setUint8(off + RECORD_LAYOUT.ampUnits, 0);
      view.setUint16(off + RECORD_LAYOUT.period, 0, true);
    }
    view.setUint8(off + RECORD_LAYOUT.varType, (s.varType ?? 0) & 0xff);
    view.setUint32(off + RECORD_LAYOUT.hip, s.hip ?? 0, true);
    // Gaia DR3 source_ids exceed Number.MAX_SAFE_INTEGER; parse the
    // AT-HYG column as BigInt to preserve every bit before writing.
    const gaiaSourceId = s.gaiaSourceId ? BigInt(s.gaiaSourceId) : NO_GAIA_SOURCE_ID;
    view.setBigUint64(off + RECORD_LAYOUT.gaiaSourceId, gaiaSourceId, true);
    if (gaiaSourceId !== NO_GAIA_SOURCE_ID) gaiaSourceIdResolved++;

    // Apsis lookup keyed by gaia_source_id string (BigInt key would
    // require a parallel string map). NO_APSIS (NaN) fills every cell
    // when the source_id is absent from the TSV or the row's cell is blank.
    const apsis = s.gaiaSourceId ? apsisMap.get(s.gaiaSourceId) : undefined;
    const f = (v: number | null | undefined): number =>
      v === null || v === undefined ? NO_APSIS : v;
    view.setFloat32(off + RECORD_LAYOUT.teffGspphot, f(apsis?.teffGspphot), true);
    view.setFloat32(off + RECORD_LAYOUT.loggGspphot, f(apsis?.loggGspphot), true);
    view.setFloat32(off + RECORD_LAYOUT.mhGspphot, f(apsis?.mhGspphot), true);
    view.setFloat32(off + RECORD_LAYOUT.azeroGspphot, f(apsis?.azeroGspphot), true);
    view.setFloat32(off + RECORD_LAYOUT.teffGspspec, f(apsis?.teffGspspec), true);
    view.setFloat32(off + RECORD_LAYOUT.loggGspspec, f(apsis?.loggGspspec), true);
    view.setFloat32(off + RECORD_LAYOUT.mhGspspec, f(apsis?.mhGspspec), true);
    if (apsis) apsisMatched++;
    if (apsis && (apsis.teffGspphot !== null || apsis.teffGspspec !== null)) {
      apsisTeffEither++;
    }

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

  await mkdir(dirname(OUT_BIN), { recursive: true });
  await writeFile(OUT_BIN, Buffer.from(out));

  // Constellations JSON (unchanged from v1 format).
  const constellationsOut = CONSTELLATIONS.map((c, idx) => {
    const lines = figureLines.get(idx);
    return lines ? { ...c, lines } : { ...c };
  });
  await writeFile(OUT_CON, JSON.stringify(constellationsOut) + '\n');

  // Search index — one entry per star with at least one identifier the user
  // might type. SearchEntry is the shared writer↔reader contract (see
  // catalog-pure.ts); keep field names there in sync.
  const searchEntries: SearchEntry[] = [];
  for (let i = 0; i < stars.length; i++) {
    const s = stars[i];
    if (!s.proper && !s.bayer && s.hip === null && s.hd === null && s.hr === null && s.flam === null && !s.gl) continue;
    const entry: SearchEntry = { i };
    if (s.proper) entry.p = s.proper;
    if (s.bayer) entry.b = s.bayer;
    if (s.flam !== null) entry.f = s.flam;
    if (s.hip !== null) entry.hip = s.hip;
    if (s.hd !== null) entry.hd = s.hd;
    if (s.hr !== null) entry.hr = s.hr;
    if (s.gl) entry.gl = s.gl;
    if (s.conIndex !== 255) entry.c = s.conIndex;
    if (s.spectDisplay) entry.s = s.spectDisplay;
    searchEntries.push(entry);
  }
  await writeFile(OUT_SEARCH, JSON.stringify(searchEntries) + '\n');

  // Catalog row-index map sidecar — lets the runtime binaries loader
  // resolve a multiples.tsv row's identifier to a catalog.bin record
  // index without scanning every record at startup. Keyed by Gaia DR3
  // source_id (decimal string, since source_ids exceed 2^53), HIP, and
  // synthetic identifier (`synth-<wds_id>-<comp>` for promoted companions
  // that carry no real ID — Algol Ab).
  const rowIndexMap = buildCatalogRowIndexMap(stars);
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
  console.log(`Wrote ${OUT_BIN} (${mb} MB, ${stars.length} records, v${BINARY_VERSION})`);
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
    refreshCommand: 'UPDATE_BUILD_COUNTS=1 npm run build:catalog',
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
    refreshCommand: 'UPDATE_DISTANCE_OUTLIERS=1 npm run build:catalog',
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
