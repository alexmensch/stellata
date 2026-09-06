// Source paths and loaders for every reference table readStars consumes,
// plus the membership manifest it walks as the membership term. See README.md.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  parseBailerJonesTsv,
  parseGaiaApsisTsv,
  type ApsisRow,
} from '../catalog-pure';
import {
  type SimbadSpectralIndex,
  emptySimbadSpectralIndex,
  parseSimbadSptypeTsv,
} from '../spectral/spectral-resolve';
import type { BuildCounts } from '../build-counts';
import {
  parseGaiaAstrometryCatalogTsv,
  parseHip2Tsv,
  parseNssSourceIdSet,
  type DirectionSources,
} from '../distance/direction-cascade';
import { loadDustGrid } from '../distance/dust-deextinction';
import type { DustGrid } from '../distance/dust-deextinction-pure';
import {
  createConstellationAssignment,
  STELLARIUM_SKYCULTURE_JSON,
} from './constellations';
import { parseGspcTsv, type GspcColour } from '../photometry/gspc-parse';
import { parseHipPhotometryTsv } from '../photometry/hip-photometry-parse';
import {
  emptySimbadValueIndex,
  parseSimbadValuesTsv,
  type SimbadValueIndex,
} from '../simbad-values-parse';
import { parseTycho2Tsvs } from '../tycho2-parse';
import { cns5AstrometryByGj, parseCns5Tsv } from '../classic-ids/classic-ids-parse';
import {
  emptyGlieseIndex,
  parseGlieseTsv,
  type GlieseIndex,
} from '../gliese-parse';
import {
  MULTIPLES_TSV,
  readMultiplesTsv,
} from '../companions/companion-promotion';
import {
  buildPairMemberParallaxIndex,
  emptyPairMemberParallaxIndex,
  type PairMemberParallaxIndex,
} from '../distance/parallax/pair-member-parallax';
import { MEMBERSHIP_MANIFEST_FILE } from '../membership/membership-manifest-pure';
import type { ReadStarsOptions } from './stars-parse';
import { REPO_ROOT as ROOT } from '../../util/paths';

export const MEMBERSHIP_MANIFEST_TSV = resolve(ROOT, MEMBERSHIP_MANIFEST_FILE);
const SRC_BAILER_JONES = resolve(ROOT, 'data/bailer-jones/bailer-jones-dr3.tsv');
const SRC_GAIA_APSIS = resolve(ROOT, 'data/gaia/gaia_dr3_apsis.tsv');
const SRC_GAIA_GSPC = resolve(ROOT, 'data/gaia/gaia_dr3_gspc.tsv');
const SRC_GAIA_ASTROMETRY = resolve(ROOT, 'data/gaia/gaia_dr3_astrometry_catalog.tsv');
const SRC_GAIA_NSS = resolve(ROOT, 'data/gaia/gaia_dr3_nss_two_body.tsv');
const SRC_HIP2 = resolve(ROOT, 'data/hipparcos/hip2_van_leeuwen.tsv');
const SRC_HIP_VMAG = resolve(ROOT, 'data/hipparcos/hip_main_vmag.tsv');
const SRC_SIMBAD_SPTYPE = resolve(ROOT, 'data/simbad/simbad_sptype.tsv');
const SRC_SIMBAD_VALUES = resolve(ROOT, 'data/simbad/simbad_values.tsv');
const SRC_TYCHO2_MAIN = resolve(ROOT, 'data/tycho2/tycho2_main.tsv');
const SRC_TYCHO2_SUPPL1 = resolve(ROOT, 'data/tycho2/tycho2_suppl1.tsv');
const SRC_CNS5 = resolve(ROOT, 'data/classic-ids/cns5.tsv');
const SRC_GLIESE = resolve(ROOT, 'data/gliese/gliese_v70a.tsv');
const SRC_DUST_DIR = resolve(ROOT, 'data/dust');
const SRC_DUST_MANIFEST = resolve(SRC_DUST_DIR, 'manifest.json');

/** Every file a readStars walk reads — the mtime set an artifact derived
 *  from that walk must invalidate against. */
export const READ_STARS_INPUT_PATHS: readonly string[] = [
  MEMBERSHIP_MANIFEST_TSV, SRC_BAILER_JONES, SRC_GAIA_APSIS, SRC_GAIA_GSPC,
  SRC_GAIA_ASTROMETRY, SRC_GAIA_NSS, SRC_HIP2, SRC_HIP_VMAG, SRC_SIMBAD_SPTYPE,
  SRC_SIMBAD_VALUES, SRC_TYCHO2_MAIN, SRC_TYCHO2_SUPPL1, SRC_CNS5, SRC_GLIESE,
  SRC_DUST_MANIFEST, STELLARIUM_SKYCULTURE_JSON, MULTIPLES_TSV,
];

/** Upstream table sizes — the `BuildCounts` fields this loader owns, so a
 *  consumer folds them in wholesale rather than field by field. */
export type ReadStarsInputSizes = Pick<
  BuildCounts,
  | 'bjEntries'
  | 'apsisEntries'
  | 'gspcEntries'
  | 'simbadSptypeEntries'
  | 'simbadValuesEntries'
  | 'gaiaAstrometryEntries'
  | 'hip2Entries'
  | 'hipVMagEntries'
  | 'hipBvEntries'
  | 'nssSourceIdEntries'
  | 'tycho2Entries'
  | 'cns5AstrometryEntries'
  | 'glieseEntries'
  | 'pairMemberParallaxEntries'
>;

/** The loaded form of `ReadStarsOptions`: every table present, none optional,
 *  so passing this bundle to `readStars` cannot omit one. Extends the walk's
 *  own option shape rather than restating it — a new table added there is a
 *  compile error here until this loader supplies it. */
export interface ReadStarsInputs extends Required<ReadStarsOptions> {
  /** Loaded unconditionally: absent dust is a hard fail below, not a
   *  soft-continue, so consumers never see the nullable form. */
  dustGrid: DustGrid;
  sizes: ReadStarsInputSizes;
}

export function loadReadStarsInputs(): ReadStarsInputs {
  const sizes: ReadStarsInputSizes = {
    bjEntries: 0,
    apsisEntries: 0,
    gspcEntries: 0,
    simbadSptypeEntries: 0,
    simbadValuesEntries: 0,
    gaiaAstrometryEntries: 0,
    hip2Entries: 0,
    hipVMagEntries: 0,
    hipBvEntries: 0,
    nssSourceIdEntries: 0,
    tycho2Entries: 0,
    cns5AstrometryEntries: 0,
    glieseEntries: 0,
    pairMemberParallaxEntries: 0,
  };

  // Bailer-Jones DR3 distance posteriors. Optional in CI / fresh-clone
  // builds where the LFS file hasn't pulled yet — without it every star
  // keeps the cascade's naive 1/π inversion.
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

  // Gaia DR3 synthetic photometry — the ci cascade's tier below the
  // Table-5.9 relation. Optional on the same terms as Apsis; without it the
  // red rows fall to printed I/239 B−V and then to the derived tiers, which
  // shows up as a ciVia drift in the count snapshot.
  let gspcMap = new Map<string, GspcColour>();
  if (existsSync(SRC_GAIA_GSPC)) {
    console.log('Parsing Gaia DR3 synthetic photometry...');
    const t = Date.now();
    gspcMap = parseGspcTsv(readFileSync(SRC_GAIA_GSPC, 'utf8'));
    console.log(`  ${gspcMap.size} entries in ${Date.now() - t}ms`);
    sizes.gspcEntries = gspcMap.size;
  } else {
    console.warn(
      `WARNING: ${SRC_GAIA_GSPC} not found — the ci cascade's synthetic tier\n` +
      `         is unavailable; red rows fall to printed I/239 B−V and the\n` +
      `         derived tiers. Re-run \`pnpm run refresh:gaia-gspc\`.`,
    );
  }

  // SIMBAD sp_type under all four namespaces. First tier of the spectral
  // resolver; the binary defaults to GSP-Spec + unknown sentinel without it.
  let simbadSpectral: SimbadSpectralIndex = emptySimbadSpectralIndex();
  if (existsSync(SRC_SIMBAD_SPTYPE)) {
    console.log('Parsing SIMBAD sp_type catalogue...');
    const t = Date.now();
    simbadSpectral = parseSimbadSptypeTsv(readFileSync(SRC_SIMBAD_SPTYPE, 'utf8'));
    console.log(`  ${simbadSpectral.bySourceId.size} entries in ${Date.now() - t}ms`);
    sizes.simbadSptypeEntries = simbadSpectral.bySourceId.size;
  } else {
    console.warn(
      `WARNING: ${SRC_SIMBAD_SPTYPE} not found — spectral classification will\n` +
      `         fall through to Gaia DR3 GSP-Spec and the unknown sentinel.\n` +
      `         Re-run scripts/refresh/refresh-simbad-sptype.py to restore\n` +
      `         the SIMBAD tier.`,
    );
  }

  // SIMBAD bibcoded values over the § 5 cohort — the bottom tier of the rv
  // cascade. Optional on the same terms as the tables above; without it the
  // rows no first-order catalogue reaches take a zero radial term, which
  // shows up as an rvVia drift in the count snapshot.
  let simbadValues: SimbadValueIndex = emptySimbadValueIndex();
  if (existsSync(SRC_SIMBAD_VALUES)) {
    console.log('Parsing SIMBAD bibcoded values...');
    const t = Date.now();
    simbadValues = parseSimbadValuesTsv(readFileSync(SRC_SIMBAD_VALUES, 'utf8'));
    sizes.simbadValuesEntries = simbadValues.rowCount;
    console.log(`  ${sizes.simbadValuesEntries} rows in ${Date.now() - t}ms`);
  } else {
    console.warn(
      `WARNING: ${SRC_SIMBAD_VALUES} not found — the rv cascade's SIMBAD tier\n` +
      `         is unavailable; its rows fall to a zero radial term.\n` +
      `         Re-run \`pnpm run refresh:simbad-values\`.`,
    );
  }

  // Direction-cascade inputs: Gaia DR3 5p astrometry, HIP2 van Leeuwen,
  // and the NSS two-body source_id set. Each optional in CI / fresh-clone
  // builds — a missing file degrades that tier and the cascade falls
  // through, which the build-counts assertion then flags.
  const directions: DirectionSources = {
    gaiaAstrometry: new Map(),
    hip2: new Map(),
    nssSourceIds: new Set(),
    tycho2: new Map(),
    cns5: new Map(),
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
      `         unavailable; sky directions fall back to HIP2 / Tycho-2 / CNS5.\n` +
      `         Re-run scripts/refresh/refresh-gaia-astrometry-catalog.py.`,
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
      `WARNING: ${SRC_HIP2} not found — direction cascade tier 2 and the\n` +
      `         parallax cascade's hip2_parallax tier are unavailable.`,
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

  // Printed Johnson V and B−V per HIP — the V cascade's bright tier and the
  // ci cascade's printed tier. Optional on the same terms as the
  // direction-cascade tables: without it saturated and out-of-range rows fall
  // to the tier below, which shows up as a vVia / ciVia drift in the count
  // snapshot.
  let hipVMag = new Map<number, number>();
  let hipBv = new Map<number, number>();
  if (existsSync(SRC_HIP_VMAG)) {
    console.log('Parsing printed Hipparcos V magnitudes and colours...');
    const t = Date.now();
    ({ vmag: hipVMag, bv: hipBv } = parseHipPhotometryTsv(readFileSync(SRC_HIP_VMAG, 'utf8')));
    console.log(`  ${hipVMag.size} V / ${hipBv.size} B−V entries in ${Date.now() - t}ms`);
    sizes.hipVMagEntries = hipVMag.size;
    sizes.hipBvEntries = hipBv.size;
  } else {
    console.warn(
      `WARNING: ${SRC_HIP_VMAG} not found — the V cascade's bright tier and\n` +
      `         the ci cascade's printed tier are unavailable.\n` +
      `         Re-run \`pnpm run refresh:hip-vmag\`.`,
    );
  }

  // Tycho-2 mean positions, PM and BT/VT — the direction, PM and V cascades'
  // tier for TYC-bearing rows Gaia and HIP2 both miss. Both tables are read
  // together because the main one wins on the identifiers they share.
  if (existsSync(SRC_TYCHO2_MAIN) && existsSync(SRC_TYCHO2_SUPPL1)) {
    console.log('Parsing Tycho-2 astrometry and BT/VT photometry...');
    const t = Date.now();
    directions.tycho2 = parseTycho2Tsvs(
      readFileSync(SRC_TYCHO2_MAIN, 'utf8'),
      readFileSync(SRC_TYCHO2_SUPPL1, 'utf8'),
    );
    console.log(`  ${directions.tycho2.size} entries in ${Date.now() - t}ms`);
    sizes.tycho2Entries = directions.tycho2.size;
  } else {
    console.warn(
      `WARNING: ${SRC_TYCHO2_MAIN} not found — the direction, PM and V\n` +
      `         cascades lose their Tycho-2 tier; its rows fall through and\n` +
      `         those with no tier below lose their record. Re-run\n` +
      `         \`pnpm run refresh:tycho2\`.`,
    );
  }

  // CNS5's own astrometry, keyed on the record's GJ — the direction tier
  // under Tycho-2 for the Gliese cohort.
  if (existsSync(SRC_CNS5)) {
    console.log('Parsing CNS5 astrometry...');
    const t = Date.now();
    directions.cns5 = cns5AstrometryByGj(parseCns5Tsv(readFileSync(SRC_CNS5, 'utf8')));
    console.log(`  ${directions.cns5.size} entries in ${Date.now() - t}ms`);
    sizes.cns5AstrometryEntries = directions.cns5.size;
  } else {
    console.warn(
      `WARNING: ${SRC_CNS5} not found — the direction cascade's CNS5 tier is\n` +
      `         unavailable; its rows fall to SIMBAD. Re-run\n` +
      `         \`pnpm run refresh:classic-ids\`.`,
    );
  }

  // Printed Gliese V/70A values — the V cascade's tier under Tycho-2, and the
  // only source reaching the GJ-only cohort at all (SIMBAD holds no V flux
  // for those rows). Absent costs each of them its V, and a row with no V
  // parks, so this shows up on the § 6.1 ledger rather than as a routing
  // drift.
  let gliese: GlieseIndex = emptyGlieseIndex();
  if (existsSync(SRC_GLIESE)) {
    console.log('Parsing printed Gliese V/70A values...');
    const t = Date.now();
    gliese = parseGlieseTsv(readFileSync(SRC_GLIESE, 'utf8'));
    console.log(`  ${gliese.rowCount} rows in ${Date.now() - t}ms`);
    sizes.glieseEntries = gliese.rowCount;
  } else {
    console.warn(
      `WARNING: ${SRC_GLIESE} not found — the V cascade's Gliese tier is\n` +
      `         unavailable and the GJ-only cohort loses its records.\n` +
      `         Re-run \`pnpm run refresh:gliese\`.`,
    );
  }

  // The kept-physical pair rows crossed with the Gaia table already loaded —
  // the parallax cascade's sibling tier. Absent multiples.tsv leaves it empty
  // and its rows park, which the distPairMemberParallax pin then flags.
  let pairMemberParallax: PairMemberParallaxIndex = emptyPairMemberParallaxIndex();
  if (existsSync(MULTIPLES_TSV)) {
    console.log('Indexing bound-pair sibling parallaxes...');
    const t = Date.now();
    pairMemberParallax = buildPairMemberParallaxIndex(
      readMultiplesTsv(MULTIPLES_TSV), directions.gaiaAstrometry,
    );
    console.log(`  ${pairMemberParallax.entryCount} anchor-grade siblings in ${Date.now() - t}ms`);
    sizes.pairMemberParallaxEntries = pairMemberParallax.entryCount;
  } else {
    console.warn(
      `WARNING: ${MULTIPLES_TSV} not found — the parallax cascade's sibling\n` +
      `         tier is unavailable and its rows park instead of shipping.`,
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

  // IAU boundary decomposition. Committed alongside the stick figures and
  // never optional: it is the sole source of catalog byte 34, and its own
  // 89-region invariant throws rather than resolving a partial sky.
  console.log('Decomposing the IAU B1875 constellation boundaries...');
  const tCon = Date.now();
  const conAssignment = createConstellationAssignment();
  console.log(`  built the region grid in ${Date.now() - tCon}ms`);

  return {
    bjMap, apsisMap, gspcMap, simbadSpectral, simbadValues, directions,
    hipVMag, hipBv, gliese, pairMemberParallax, dustGrid, conAssignment, sizes,
  };
}
