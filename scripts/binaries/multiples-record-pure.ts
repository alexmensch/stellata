// The multiples.tsv record and its closed value sets, apart from the file's codec. See README.md#files-in-this-area.

import { isComponentToken } from './component-tokens-pure';

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
  if (colon < 0 || !isComponentToken(from) || !(INHERITANCE_KINDS as readonly string[]).includes(how)) return null;
  return inheritedFrom(from, how as InheritanceKind);
}

export type SpectVia = (typeof SPECT_VIA)[number];
export type PhotometryVia = (typeof PHOTOMETRY_VIA)[number];
export type OrbitRole = (typeof ORBIT_ROLES)[number];

/** An identifier and where the component came by it, or neither. */
export interface IdentifierWithOrigin<T> {
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
