// Codec for data/binaries/multiples.tsv. See README.md#files-in-this-area.

import { resolve } from 'node:path';

import { REPO_ROOT } from '../util/paths';
import { defineArtifact, nullableCell } from '../util/tsv/artifact-pure';
import { MULTIPLES_ROW_KEY } from './multiples-row-key-pure';
import { wdsRootOf } from './component-tokens-pure';
import { DATA_FILES } from '../../src/catalog-format/pipeline-outputs/data-files';

export const MULTIPLES_COLUMNS = [
  'system_id', 'comp', 'hip', 'gaia_source_id', 'hd',
  'x_pc', 'y_pc', 'z_pc', 'absmag', 'ci', 'spect', 'name',
  'source', 'regime',
  'resolve_via', 'gaia_origin', 'hip_origin', 'astrometry_via', 'orbit_via', 'spect_via',
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

export type ResolveVia = (typeof RESOLVE_VIA)[number];
export type AstrometryVia = (typeof ASTROMETRY_VIA)[number];

/** Whether a tier anchors on a Gaia source_id: `ccdm_hip` anchors on a HIP
 *  and reaches the source through it. */
export const RESOLVE_VIA_ANCHORS_SOURCE_ID: Readonly<Record<ResolveVia, boolean>> = {
  orb6_hip: true,
  athyg_gaia_native: true,
  simbad_xid: true,
  ccdm_hip: false,
  position_pm: true,
  position_nopm: true,
  unresolved: false,
};

export type OrbitVia = (typeof ORBIT_VIA)[number];

/** `hasElements`: the route selected orbital elements. `regime`: the legacy
 *  column's 2 (a measured orbit) / 3 (spectroscopic or compiled) / 0 (none).
 *  `estimatedElements`: Stage 6 backfills q, a circular ω and a Kepler a —
 *  never on a visual orbit, whose pair carries a measured placement. */
export const ORBIT_VIA_PROPERTIES = {
  orb6: { hasElements: true, regime: 2, estimatedElements: false },
  gaia_nss: { hasElements: true, regime: 2, estimatedElements: true },
  orb6_spectroscopic: { hasElements: true, regime: 3, estimatedElements: true },
  msc: { hasElements: true, regime: 3, estimatedElements: true },
  none: { hasElements: false, regime: 0, estimatedElements: false },
} as const satisfies Record<OrbitVia, { hasElements: boolean; regime: 0 | 2 | 3; estimatedElements: boolean }>;

/** The routes that carry elements. */
export type OrbitViaOnFile = {
  [K in OrbitVia]: (typeof ORBIT_VIA_PROPERTIES)[K]['hasElements'] extends true ? K : never;
}[OrbitVia];
export const ORBIT_VIA_ON_FILE: readonly OrbitViaOnFile[] = ORBIT_VIA.filter(
  (v): v is OrbitViaOnFile => ORBIT_VIA_PROPERTIES[v].hasElements,
);
/** How a component came by an identifier another component holds: `blend`, a
 *  ρ = 0 pair's secondary from its primary; `letter`, a bare letter from its
 *  sub-letter (A ← Aa); `parent`, a sub-letter from its parent (Aa ← A);
 *  `partner`, a pair's secondary from its primary at a measured or unmeasured ρ. */
export const INHERITANCE_KINDS = ['blend', 'letter', 'parent', 'partner'] as const;
export type InheritanceKind = (typeof INHERITANCE_KINDS)[number];

/** Where one bound identifier came from: earned by the component itself, or
 *  copied from the component `from` (a WDS token of the same system). */
export type IdOrigin =
  | { readonly kind: 'own' }
  | { readonly kind: 'inherited'; readonly from: string; readonly how: InheritanceKind };

export const OWN: IdOrigin = Object.freeze({ kind: 'own' });

export function inheritedFrom(from: string, how: InheritanceKind): IdOrigin {
  return Object.freeze({ kind: 'inherited', from, how });
}

/** `own`, or `<how>:<from>` (`blend:A`, `letter:Aa`). */
export function formatIdOrigin(origin: IdOrigin): string {
  return origin.kind === 'own' ? 'own' : `${origin.how}:${origin.from}`;
}

export function parseIdOrigin(cell: string): IdOrigin | null {
  if (cell === 'own') return OWN;
  const colon = cell.indexOf(':');
  const how = cell.slice(0, colon);
  const from = cell.slice(colon + 1);
  if (colon < 0 || from === '' || !(INHERITANCE_KINDS as readonly string[]).includes(how)) return null;
  return inheritedFrom(from, how as InheritanceKind);
}

export type SpectVia = (typeof SPECT_VIA)[number];
export type PhotometryVia = (typeof PHOTOMETRY_VIA)[number];
export type OrbitRole = (typeof ORBIT_ROLES)[number];

/** An identifier and where the component came by it, or neither. */
interface IdentifierWithOrigin<T> {
  readonly value: T;
  readonly origin: IdOrigin;
}

/** A DR3 source_id is kept as a string: it exceeds Number.MAX_SAFE_INTEGER. */
export type GaiaFields = { gaiaSourceId: null; gaiaOrigin: null } | { gaiaSourceId: string; gaiaOrigin: IdOrigin };
export type HipFields = { hip: null; hipOrigin: null } | { hip: number; hipOrigin: IdOrigin };

export function gaiaFields(id: IdentifierWithOrigin<string> | null): GaiaFields {
  return id === null ? { gaiaSourceId: null, gaiaOrigin: null } : { gaiaSourceId: id.value, gaiaOrigin: id.origin };
}

export function hipFields(id: IdentifierWithOrigin<number> | null): HipFields {
  return id === null ? { hip: null, hipOrigin: null } : { hip: id.value, hipOrigin: id.origin };
}

/** Every field but the identifiers and their origins. */
export interface MultiplesRecordFields {
  systemId: string;
  comp: string;
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
  resolveVia: ResolveVia;
  astrometryVia: AstrometryVia;
  orbitVia: OrbitVia;
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

export type MultiplesRecord = MultiplesRecordFields & GaiaFields & HipFields;

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
  file: DATA_FILES.multiples,
  columns: MULTIPLES_COLUMNS,
  hint: 'Re-run `pnpm run build:binaries`.',
  order: 'as-given',
  rowKey: MULTIPLES_ROW_KEY,
  decode: (row): MultiplesRecord => {
    const regime = row.int('regime') ?? row.fail('regime is empty');
    const positive = (column: 'P_days' | 'a_AU'): number | null => {
      const v = row.float(column);
      return v === null || v > 0 ? v : row.fail(`${column} ${v} is not positive`);
    };
    const eccentricity = row.float('e');
    if (eccentricity !== null && !(eccentricity >= 0 && eccentricity < 1)) {
      row.fail(`e ${eccentricity} is not a bound orbit's eccentricity`);
    }
    const systemId = row.raw('system_id');
    if (wdsRootOf(systemId) === null) row.fail(`system_id "${systemId}" names no WDS id`);
    const comp = row.raw('comp');
    if (comp.trim() === '') row.fail('comp is empty');
    const withOrigin = <T>(value: T | null, column: 'gaia_origin' | 'hip_origin'): IdentifierWithOrigin<T> | null => {
      const cell = row.raw(column);
      if (value === null) return cell === '' ? null : row.fail(`${column} "${cell}" names the origin of no identifier`);
      return { value, origin: parseIdOrigin(cell) ?? row.fail(`${column} "${cell}" is not own or <kind>:<token>`) };
    };
    return {
      systemId,
      comp,
      ...hipFields(withOrigin(row.int('hip'), 'hip_origin')),
      ...gaiaFields(withOrigin(row.sourceId('gaia_source_id'), 'gaia_origin')),
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
      pDays: positive('P_days'),
      tJd: row.float('T_jd'),
      e: eccentricity,
      aAU: positive('a_AU'),
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
    gaia_origin: r.gaiaOrigin === null ? '' : formatIdOrigin(r.gaiaOrigin),
    hip_origin: r.hipOrigin === null ? '' : formatIdOrigin(r.hipOrigin),
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
