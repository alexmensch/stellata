// Source paths and loaders for every reference table readStars consumes.
// Shared by build-catalog.ts and the inherited-spine generator so both
// walk the AT-HYG CSV against identical inputs. See README.md.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  parseBailerJonesTsv,
  parseGaiaApsisTsv,
  parseSimbadSptypeTsv,
  parseSimbadWdsXidsTsv,
  type ApsisRow,
  type SimbadSpectralIndex,
  type SimbadWdsXidIndex,
} from '../catalog-pure';
import type { BuildCounts } from '../build-counts';
import {
  parseGaiaAstrometryCatalogTsv,
  parseHip2Tsv,
  parseNssSourceIdSet,
  type DirectionSources,
} from '../distance/direction-cascade';
import { loadDustGrid } from '../distance/dust-deextinction';
import type { DustGrid } from '../distance/dust-deextinction-pure';
import { readGaiaHipXmatch } from './gaia-xmatch';
import { REPO_ROOT as ROOT } from '../../util/paths';

export const ATHYG_CSV = resolve(ROOT, 'data/athyg/athyg_33_classic_ids.csv');
const SRC_BAILER_JONES = resolve(ROOT, 'data/bailer-jones/bailer-jones-dr3.tsv');
const SRC_GAIA_HIP_XMATCH = resolve(ROOT, 'data/gaia/gaia_dr3_hip_xmatch.tsv');
const SRC_GAIA_APSIS = resolve(ROOT, 'data/gaia/gaia_dr3_apsis.tsv');
const SRC_GAIA_ASTROMETRY = resolve(ROOT, 'data/gaia/gaia_dr3_astrometry_catalog.tsv');
const SRC_GAIA_NSS = resolve(ROOT, 'data/gaia/gaia_dr3_nss_two_body.tsv');
const SRC_HIP2 = resolve(ROOT, 'data/hipparcos/hip2_van_leeuwen.tsv');
const SRC_SIMBAD_SPTYPE = resolve(ROOT, 'data/simbad/simbad_sptype.tsv');
const SRC_SIMBAD_WDS_XIDS = resolve(ROOT, 'data/simbad/simbad_wds_xids.tsv');
const SRC_DUST_DIR = resolve(ROOT, 'data/dust');
const SRC_DUST_MANIFEST = resolve(SRC_DUST_DIR, 'manifest.json');

/** Every file a readStars walk reads — the mtime set an artifact derived
 *  from that walk must invalidate against. */
export const READ_STARS_INPUT_PATHS: readonly string[] = [
  ATHYG_CSV, SRC_BAILER_JONES, SRC_GAIA_HIP_XMATCH, SRC_GAIA_APSIS,
  SRC_GAIA_ASTROMETRY, SRC_GAIA_NSS, SRC_HIP2, SRC_SIMBAD_SPTYPE,
  SRC_SIMBAD_WDS_XIDS, SRC_DUST_MANIFEST,
];

/** Upstream table sizes — the `BuildCounts` fields this loader owns, so a
 *  consumer folds them in wholesale rather than field by field. */
export type ReadStarsInputSizes = Pick<
  BuildCounts,
  | 'bjEntries'
  | 'apsisEntries'
  | 'simbadSptypeEntries'
  | 'simbadWdsXidsEntries'
  | 'gaiaAstrometryEntries'
  | 'hip2Entries'
  | 'nssSourceIdEntries'
>;

export interface ReadStarsInputs {
  bjMap: Map<string, number>;
  apsisMap: Map<string, ApsisRow>;
  simbadSpectral: SimbadSpectralIndex;
  wdsXids: SimbadWdsXidIndex | null;
  /** Also feeds build-catalog's GCVS byGaia bridge. */
  hipToGaia: Map<number, string> | null;
  directions: DirectionSources;
  dustGrid: DustGrid;
  sizes: ReadStarsInputSizes;
}

export function loadReadStarsInputs(): ReadStarsInputs {
  const sizes: ReadStarsInputSizes = {
    bjEntries: 0,
    apsisEntries: 0,
    simbadSptypeEntries: 0,
    simbadWdsXidsEntries: 0,
    gaiaAstrometryEntries: 0,
    hip2Entries: 0,
    nssSourceIdEntries: 0,
  };

  // Bailer-Jones DR3 distance posteriors. Optional in CI / fresh-clone
  // builds where the LFS file hasn't pulled yet — without it every star
  // keeps its naive 1/π AT-HYG distance.
  let bjMap = new Map<string, number>();
  if (existsSync(SRC_BAILER_JONES)) {
    console.log('Parsing Bailer-Jones DR3 distance posteriors...');
    const t = Date.now();
    bjMap = parseBailerJonesTsv(readFileSync(SRC_BAILER_JONES, 'utf8'));
    console.log(`  ${bjMap.size} entries in ${Date.now() - t}ms`);
    sizes.bjEntries = bjMap.size;
  } else {
    console.log('Bailer-Jones DR3 file not found; skipping distance override.');
  }

  // Gaia DR3 Apsis (gspphot ∪ gspspec) astrophysical parameters. Optional
  // in CI / fresh-clone builds where the LFS file hasn't pulled yet —
  // without it every record gets the NO_APSIS sentinel.
  let apsisMap = new Map<string, ApsisRow>();
  if (existsSync(SRC_GAIA_APSIS)) {
    console.log('Parsing Gaia DR3 Apsis astrophysical parameters...');
    const t = Date.now();
    apsisMap = parseGaiaApsisTsv(readFileSync(SRC_GAIA_APSIS, 'utf8'));
    console.log(`  ${apsisMap.size} entries in ${Date.now() - t}ms`);
    sizes.apsisEntries = apsisMap.size;
  } else {
    console.log('Gaia DR3 Apsis file not found; skipping astrophysical-parameter surface.');
  }

  // SIMBAD sp_type indexed by Gaia DR3 source_id and by HIP. First tier
  // of the spectral resolver; the binary defaults to GSP-Spec + unknown
  // sentinel without it.
  let simbadSpectral: SimbadSpectralIndex = { bySource: new Map(), byHip: new Map() };
  if (existsSync(SRC_SIMBAD_SPTYPE)) {
    console.log('Parsing SIMBAD sp_type catalogue...');
    const t = Date.now();
    simbadSpectral = parseSimbadSptypeTsv(readFileSync(SRC_SIMBAD_SPTYPE, 'utf8'));
    console.log(`  ${simbadSpectral.bySource.size} entries in ${Date.now() - t}ms`);
    sizes.simbadSptypeEntries = simbadSpectral.bySource.size;
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
    const t = Date.now();
    wdsXids = parseSimbadWdsXidsTsv(readFileSync(SRC_SIMBAD_WDS_XIDS, 'utf8'));
    console.log(`  ${wdsXids.bySource.size} sources in ${Date.now() - t}ms`);
    sizes.simbadWdsXidsEntries = wdsXids.bySource.size;
  } else {
    console.warn(
      `WARNING: ${SRC_SIMBAD_WDS_XIDS} not found — the sibling-letter\n` +
      `         attribution gate is disabled. Re-run\n` +
      `         scripts/refresh/refresh-simbad-wds-xids.py to restore it.`,
    );
  }

  let hipToGaia: Map<number, string> | null = null;
  if (existsSync(SRC_GAIA_HIP_XMATCH)) {
    console.log('Parsing Gaia DR3 ↔ HIP cross-walk...');
    const t = Date.now();
    hipToGaia = readGaiaHipXmatch(SRC_GAIA_HIP_XMATCH);
    console.log(`  ${hipToGaia.size} entries in ${Date.now() - t}ms`);
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
    const t = Date.now();
    directions.gaiaAstrometry = parseGaiaAstrometryCatalogTsv(readFileSync(SRC_GAIA_ASTROMETRY, 'utf8'));
    console.log(`  ${directions.gaiaAstrometry.size} entries in ${Date.now() - t}ms`);
    sizes.gaiaAstrometryEntries = directions.gaiaAstrometry.size;
  } else {
    console.warn(
      `WARNING: ${SRC_GAIA_ASTROMETRY} not found — direction cascade tier 1\n` +
      `         unavailable; sky directions fall back to HIP2 / AT-HYG printed\n` +
      `         ra/dec. Re-run scripts/refresh/refresh-gaia-astrometry-catalog.py.`,
    );
  }
  if (existsSync(SRC_HIP2)) {
    console.log('Parsing HIP2 van Leeuwen astrometry...');
    const t = Date.now();
    directions.hip2 = parseHip2Tsv(readFileSync(SRC_HIP2, 'utf8'));
    console.log(`  ${directions.hip2.size} entries in ${Date.now() - t}ms`);
    sizes.hip2Entries = directions.hip2.size;
  } else {
    console.warn(
      `WARNING: ${SRC_HIP2} not found — direction cascade tier 2 unavailable\n` +
      `         and dist_src=HIP rows keep AT-HYG's 4-dp distance print.`,
    );
  }
  if (existsSync(SRC_GAIA_NSS)) {
    console.log('Parsing Gaia DR3 NSS two-body source_ids...');
    const t = Date.now();
    directions.nssSourceIds = parseNssSourceIdSet(readFileSync(SRC_GAIA_NSS, 'utf8'));
    console.log(`  ${directions.nssSourceIds.size} source_ids in ${Date.now() - t}ms`);
    sizes.nssSourceIdEntries = directions.nssSourceIds.size;
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
  console.log(`  loaded ${dustGrid.gridSize}³ voxel grid in ${Date.now() - tDust}ms`);

  return { bjMap, apsisMap, simbadSpectral, wdsXids, hipToGaia, directions, dustGrid, sizes };
}
