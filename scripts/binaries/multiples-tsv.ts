// Codec for data/binaries/multiples.tsv. See README.md#files-in-this-area.

import { resolve } from 'node:path';

import { REPO_ROOT } from '../util/paths';
import { defineArtifact, nullableCell } from '../util/tsv/artifact-pure';

export const MULTIPLES_COLUMNS = [
  'system_id', 'comp', 'hip', 'gaia_source_id', 'hd',
  'x_pc', 'y_pc', 'z_pc', 'absmag', 'ci', 'spect', 'name',
  'source', 'regime',
  'resolve_via', 'astrometry_via', 'orbit_via', 'spect_via',
  'photometry_via', 'a_via',
  'orbit_role',
  'P_days', 'T_jd', 'e', 'a_AU', 'i_rad', 'omega_rad', 'Omega_rad', 'q', 'dist_pc',
  'sep_arcsec', 'pa_deg', 'sep_pa_epoch_jd', 'dmag',
  'anchor_sep_arcsec', 'anchor_pa_deg', 'anchor_comp', 'mag_pri', 'mag_sec',
] as const;
type Column = (typeof MULTIPLES_COLUMNS)[number];

export const MULTIPLES_SOURCES = ['athyg', 'wds', 'simbad'] as const;
export const RESOLVE_VIA = [
  'orb6_hip', 'athyg_gaia_native', 'simbad_xid', 'ccdm_hip', 'position_pm', 'position_nopm', 'unresolved',
] as const;
export const ASTROMETRY_VIA = [
  'gaia_nss_systemic', 'hip2_long_baseline', 'gaia_5p', 'athyg_position', 'unresolved', 'system_inherited',
] as const;
export const ORBIT_VIA = ['orb6', 'gaia_nss', 'orb6_spectroscopic', 'msc', 'none'] as const;
export const SPECT_VIA = ['curated', 'simbad', 'msc', 'athyg', 'none'] as const;
export const PHOTOMETRY_VIA = ['athyg_own', 'athyg_system_inherited', 'gaia_photometry', 'none'] as const;
export const A_VIA = ['catalog', 'kepler_mass_estimate', 'none'] as const;
export const ORBIT_ROLES = ['primary', 'secondary', 'standalone'] as const;

export type AstrometryVia = (typeof ASTROMETRY_VIA)[number];
export type SpectVia = (typeof SPECT_VIA)[number];
export type PhotometryVia = (typeof PHOTOMETRY_VIA)[number];
export type OrbitRole = (typeof ORBIT_ROLES)[number];

export interface MultiplesRecord {
  systemId: string;
  comp: string;
  hip: number | null;
  /** Kept as a string: a DR3 source_id exceeds Number.MAX_SAFE_INTEGER. */
  gaiaSourceId: string | null;
  hd: number | null;
  x_pc: number | null;
  y_pc: number | null;
  z_pc: number | null;
  absmag: number | null;
  ci: number | null;
  spect: string;
  name: string;
  source: (typeof MULTIPLES_SOURCES)[number];
  regime: number;
  resolveVia: (typeof RESOLVE_VIA)[number];
  astrometryVia: AstrometryVia;
  orbitVia: (typeof ORBIT_VIA)[number];
  spectVia: SpectVia;
  photometryVia: PhotometryVia;
  aVia: (typeof A_VIA)[number];
  orbitRole: OrbitRole;
  pDays: number | null;
  tJd: number | null;
  e: number | null;
  aAU: number | null;
  iRad: number | null;
  omegaRad: number | null;
  OmegaRad: number | null;
  q: number | null;
  distPc: number | null;
  sepArcsec: number | null;
  paDeg: number | null;
  sepPaEpochJd: number | null;
  dmag: number | null;
  anchorSepArcsec: number | null;
  anchorPaDeg: number | null;
  anchorComp: string | null;
  magPri: number | null;
  magSec: number | null;
}

/** Each float column's decimal places, as the Stage 6 writer prints them. */
const PLACES = {
  x_pc: 6, y_pc: 6, z_pc: 6, absmag: 4, ci: 4,
  P_days: 6, T_jd: 4, e: 6, a_AU: 6, i_rad: 6, omega_rad: 6, Omega_rad: 6, q: 6, dist_pc: 6,
  sep_arcsec: 3, pa_deg: 2, sep_pa_epoch_jd: 4, dmag: 4,
  anchor_sep_arcsec: 3, anchor_pa_deg: 2, mag_pri: 2, mag_sec: 2,
} as const satisfies Partial<Record<Column, number>>;

function fixed(v: number | null, places: number): string {
  if (v === null) return '';
  const s = v.toFixed(places);
  return Object.is(v, -0) ? `-${s}` : s;
}

export const MULTIPLES_TSV = defineArtifact({
  file: 'data/binaries/multiples.tsv',
  columns: MULTIPLES_COLUMNS,
  hint: 'Re-run `pnpm run build:binaries`.',
  order: 'as-given',
  decode: (row): MultiplesRecord => {
    const regime = row.int('regime') ?? row.fail('regime is empty');
    return {
      systemId: row.raw('system_id'),
      comp: row.raw('comp'),
      hip: row.int('hip'),
      gaiaSourceId: row.sourceId('gaia_source_id'),
      hd: row.int('hd'),
      x_pc: row.float('x_pc'),
      y_pc: row.float('y_pc'),
      z_pc: row.float('z_pc'),
      absmag: row.float('absmag'),
      ci: row.float('ci'),
      spect: row.raw('spect'),
      name: row.raw('name'),
      source: row.oneOf('source', MULTIPLES_SOURCES),
      regime,
      resolveVia: row.oneOf('resolve_via', RESOLVE_VIA),
      astrometryVia: row.oneOf('astrometry_via', ASTROMETRY_VIA),
      orbitVia: row.oneOf('orbit_via', ORBIT_VIA),
      spectVia: row.oneOf('spect_via', SPECT_VIA),
      photometryVia: row.oneOf('photometry_via', PHOTOMETRY_VIA),
      aVia: row.oneOf('a_via', A_VIA),
      orbitRole: row.oneOf('orbit_role', ORBIT_ROLES),
      pDays: row.float('P_days'),
      tJd: row.float('T_jd'),
      e: row.float('e'),
      aAU: row.float('a_AU'),
      iRad: row.float('i_rad'),
      omegaRad: row.float('omega_rad'),
      OmegaRad: row.float('Omega_rad'),
      q: row.float('q'),
      distPc: row.float('dist_pc'),
      sepArcsec: row.float('sep_arcsec'),
      paDeg: row.float('pa_deg'),
      sepPaEpochJd: row.float('sep_pa_epoch_jd'),
      dmag: row.float('dmag'),
      anchorSepArcsec: row.float('anchor_sep_arcsec'),
      anchorPaDeg: row.float('anchor_pa_deg'),
      anchorComp: row.text('anchor_comp'),
      magPri: row.float('mag_pri'),
      magSec: row.float('mag_sec'),
    };
  },
  encode: (r) => ({
    system_id: r.systemId,
    comp: r.comp,
    hip: nullableCell(r.hip),
    gaia_source_id: nullableCell(r.gaiaSourceId),
    hd: nullableCell(r.hd),
    x_pc: fixed(r.x_pc, PLACES.x_pc),
    y_pc: fixed(r.y_pc, PLACES.y_pc),
    z_pc: fixed(r.z_pc, PLACES.z_pc),
    absmag: fixed(r.absmag, PLACES.absmag),
    ci: fixed(r.ci, PLACES.ci),
    spect: r.spect,
    name: r.name,
    source: r.source,
    regime: String(r.regime),
    resolve_via: r.resolveVia,
    astrometry_via: r.astrometryVia,
    orbit_via: r.orbitVia,
    spect_via: r.spectVia,
    photometry_via: r.photometryVia,
    a_via: r.aVia,
    orbit_role: r.orbitRole,
    P_days: fixed(r.pDays, PLACES.P_days),
    T_jd: fixed(r.tJd, PLACES.T_jd),
    e: fixed(r.e, PLACES.e),
    a_AU: fixed(r.aAU, PLACES.a_AU),
    i_rad: fixed(r.iRad, PLACES.i_rad),
    omega_rad: fixed(r.omegaRad, PLACES.omega_rad),
    Omega_rad: fixed(r.OmegaRad, PLACES.Omega_rad),
    q: fixed(r.q, PLACES.q),
    dist_pc: fixed(r.distPc, PLACES.dist_pc),
    sep_arcsec: fixed(r.sepArcsec, PLACES.sep_arcsec),
    pa_deg: fixed(r.paDeg, PLACES.pa_deg),
    sep_pa_epoch_jd: fixed(r.sepPaEpochJd, PLACES.sep_pa_epoch_jd),
    dmag: fixed(r.dmag, PLACES.dmag),
    anchor_sep_arcsec: fixed(r.anchorSepArcsec, PLACES.anchor_sep_arcsec),
    anchor_pa_deg: fixed(r.anchorPaDeg, PLACES.anchor_pa_deg),
    anchor_comp: r.anchorComp ?? '',
    mag_pri: fixed(r.magPri, PLACES.mag_pri),
    mag_sec: fixed(r.magSec, PLACES.mag_sec),
  }),
});

export const MULTIPLES_TSV_PATH = resolve(REPO_ROOT, MULTIPLES_TSV.file);
