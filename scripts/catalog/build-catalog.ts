// Orchestration shell: AT-HYG + GCVS + CCDM + Bailer-Jones + Gaia Apsis
// + Stellarium → public/catalog.bin (v6 binary),
// public/constellations.json, public/search-index.json. Per-input parsing
// lives in sibling modules (constellations, visual-doubles, gcvs-parse,
// stars-parse) with shared algebra + binary-layout constants in
// catalog-pure.

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
  type SimbadSpectralRow,
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
  parseGcvsMain,
  parseGcvsCrossref,
  bridgeGcvsByGaia,
  applyVariability,
} from './gcvs-parse';
import { readGaiaHipXmatch } from './gaia-xmatch';
import { readStars, type Star } from './stars-parse';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..', '..');

const SRC_CSV = resolve(ROOT, 'data/athyg/athyg_33_classic_ids.csv');
const SRC_STELLARIUM = resolve(ROOT, 'data/stellarium/stellarium-modern-skyculture.json');
const SRC_GCVS = resolve(ROOT, 'data/gcvs/gcvs5.txt');
const SRC_GCVS_XREF = resolve(ROOT, 'data/gcvs/crossid.txt');
const SRC_HIP_CCDM = resolve(ROOT, 'data/hipparcos/hip_ccdm.tsv');
const SRC_BAILER_JONES = resolve(ROOT, 'data/bailer-jones/bailer-jones-dr3.tsv');
const SRC_GAIA_HIP_XMATCH = resolve(ROOT, 'data/gaia/gaia_dr3_hip_xmatch.tsv');
const SRC_GAIA_APSIS = resolve(ROOT, 'data/gaia/gaia_dr3_apsis.tsv');
const SRC_SIMBAD_SPTYPE = resolve(ROOT, 'data/simbad/simbad_sptype.tsv');
const SRC_SIMBAD_SAMPLE = resolve(ROOT, 'data/simbad/simbad_sample.tsv');
const OUT_BIN = resolve(ROOT, 'public/catalog.bin');
const OUT_CON = resolve(ROOT, 'public/constellations.json');
const OUT_SEARCH = resolve(ROOT, 'public/search-index.json');
const EXPECTED_COUNTS = resolve(__dirname, 'build-catalog-expected.json');
const EXPECTED_OUTLIERS = resolve(__dirname, 'build-distance-outliers-expected.json');

function isUpToDate(): boolean {
  if (!existsSync(OUT_BIN) || !existsSync(OUT_CON) || !existsSync(OUT_SEARCH)) return false;
  const binMtime = statSync(OUT_BIN).mtimeMs;
  const srcMtime = statSync(SRC_CSV).mtimeMs;
  const stellariumMtime = existsSync(SRC_STELLARIUM)
    ? statSync(SRC_STELLARIUM).mtimeMs
    : 0;
  const gcvsMtime = existsSync(SRC_GCVS) ? statSync(SRC_GCVS).mtimeMs : 0;
  const xrefMtime = existsSync(SRC_GCVS_XREF) ? statSync(SRC_GCVS_XREF).mtimeMs : 0;
  const hipCcdmMtime = existsSync(SRC_HIP_CCDM) ? statSync(SRC_HIP_CCDM).mtimeMs : 0;
  const bjMtime = existsSync(SRC_BAILER_JONES) ? statSync(SRC_BAILER_JONES).mtimeMs : 0;
  const gaiaHipXmatchMtime = existsSync(SRC_GAIA_HIP_XMATCH)
    ? statSync(SRC_GAIA_HIP_XMATCH).mtimeMs
    : 0;
  const apsisMtime = existsSync(SRC_GAIA_APSIS) ? statSync(SRC_GAIA_APSIS).mtimeMs : 0;
  const simbadMtime = existsSync(SRC_SIMBAD_SPTYPE) ? statSync(SRC_SIMBAD_SPTYPE).mtimeMs : 0;
  const simbadSampleMtime = existsSync(SRC_SIMBAD_SAMPLE) ? statSync(SRC_SIMBAD_SAMPLE).mtimeMs : 0;
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
    binMtime > simbadMtime &&
    binMtime > simbadSampleMtime
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

  // SIMBAD sp_type per Gaia DR3 source_id. First tier of the spectral
  // resolver; the binary defaults to GSP-Spec + unknown sentinel without it.
  let simbadSpectralMap = new Map<string, SimbadSpectralRow>();
  if (existsSync(SRC_SIMBAD_SPTYPE)) {
    console.log('Parsing SIMBAD sp_type catalogue...');
    const tSimbad = Date.now();
    simbadSpectralMap = parseSimbadSptypeTsv(readFileSync(SRC_SIMBAD_SPTYPE, 'utf8'));
    console.log(`  ${simbadSpectralMap.size} entries in ${Date.now() - tSimbad}ms`);
    counts.simbadSptypeEntries = simbadSpectralMap.size;
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

  console.log(`Reading ${SRC_CSV}...`);
  const t0 = Date.now();
  const { stars, stats } = await readStars(
    SRC_CSV, CON_INDEX, bjMap, hipToGaia, simbadSpectralMap, apsisMap,
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
  counts.recordCount = stars.length;
  counts.bjEligible = stats.bjEligible;
  counts.bjOverridden = stats.bjOverridden;
  counts.lmcCandidates = stats.lmcCandidates;
  counts.lmcOverridden = stats.lmcOverridden;
  counts.gaiaSourceIdBackfilled = stats.gaiaSourceIdBackfilled;
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

/** Compare actual build counts against the committed expected manifest
 *  (or refresh the manifest when run with UPDATE_BUILD_COUNTS=1). */
async function assertOrUpdateBuildCounts(actual: BuildCounts): Promise<void> {
  const shouldUpdate = process.env.UPDATE_BUILD_COUNTS === '1';
  const expectedExists = existsSync(EXPECTED_COUNTS);

  if (shouldUpdate || !expectedExists) {
    await writeFile(EXPECTED_COUNTS, JSON.stringify(actual, null, 2) + '\n');
    console.log(
      `${shouldUpdate ? 'Updated' : 'Wrote initial'} ${EXPECTED_COUNTS}`,
    );
    return;
  }

  const expected = JSON.parse(readFileSync(EXPECTED_COUNTS, 'utf8')) as BuildCounts;
  const diff = compareBuildCounts(expected, actual);
  const report = formatCountDiff(diff);
  console.log(report);
  if (diff.some((d) => d.status === 'mismatch')) {
    console.error(
      `\nbuild-catalog count assertion failed. If the change is intentional,\n` +
      `refresh the snapshot with: UPDATE_BUILD_COUNTS=1 npm run build:catalog`,
    );
    process.exit(1);
  }
}

/** Cross-check the pipeline's final distances against (a) the AT-HYG input
 *  value's category-aware threshold and (b) the committed SIMBAD sample.
 *  Diff against the snapshot in `build-distance-outliers-expected.json`;
 *  refresh with `UPDATE_DISTANCE_OUTLIERS=1`. Missing `simbad_sample.tsv`
 *  is a hard fail — the file is committed (LFS), and absence indicates
 *  the working tree is in a broken state. */
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

  const shouldUpdate = process.env.UPDATE_DISTANCE_OUTLIERS === '1';
  const expectedExists = existsSync(EXPECTED_OUTLIERS);
  const expected = expectedExists
    ? (JSON.parse(readFileSync(EXPECTED_OUTLIERS, 'utf8')) as RegressionReport)
    : null;

  if (shouldUpdate || !expected) {
    const toWrite = expected ? mergeReasonsFromSnapshot(expected, report) : report;
    await writeFile(EXPECTED_OUTLIERS, JSON.stringify(toWrite, null, 2) + '\n');
    console.log(
      `${shouldUpdate ? 'Updated' : 'Wrote initial'} ${EXPECTED_OUTLIERS}`,
    );
    return;
  }

  const diff = compareRegressionReports(expected, report);
  console.log(formatRegressionDiff(diff));
  if (diff.some((d) => d.status !== 'unchanged')) {
    console.error(
      `\ndistance-regression assertion failed. If the change is intentional,\n` +
        `refresh the snapshot with: UPDATE_DISTANCE_OUTLIERS=1 npm run build:catalog`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
