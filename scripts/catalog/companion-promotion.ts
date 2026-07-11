// Reads data/binaries/multiples.tsv and promotes physical-pair
// secondaries not in AT-HYG into first-class catalog.bin records.
// See scripts/catalog/README.md § Companion promotion.

import { readFileSync } from 'node:fs';

import {
  FLAG_HAS_NAME,
  FLAG_BINARY_PRIMARY,
  FLAG_BINARY_COMPANION_ONLY,
  FLAG_BINARY_COMPANION_SYNTHETIC,
  SPECTRAL_UNKNOWN,
  NO_CONSTELLATION_INDEX,
  OPTICAL_DOUBLE_MIN_SEP_PC,
  absmagFromSpectral,
  classifyFromSimbad,
  spectralClassCi,
  spectralFromAbsmag,
  parseGaiaSourceIdStr,
  physicalRadius,
  resolveSpectDisplay,
  type SpectralInfo,
} from './catalog-pure';
import { R_V, avSolToStar, type DustGrid } from './dust-deextinction-pure';
import { ARCSEC_TO_RAD } from '../../src/client/util/astronomy-constants';
import type { Star } from './stars-parse';

// Stage 3 astrometry routes that re-anchor a secondary per-component
// rather than reproducing the system anchor under a different float path.
// Only secondaries whose route is one of these AND that carry their own
// (non-inherited) identifier are treated as having independent xyz.
const INDEPENDENT_FIT_ROUTES: ReadonlySet<string> = new Set([
  'gaia_5p',
  'hip2_long_baseline',
]);

// ---- TSV row schema -----------------------------------------------------

export type OrbitRole = 'primary' | 'secondary' | 'standalone';

export interface MultiplesTsvRow {
  systemId: string;
  comp: string;
  hip: number | null;
  gaiaSourceId: string | null;
  /** HD number (AT-HYG row's, ORB6 fallback for pair primaries) — the
   *  join key for the HD-only identifier backfill in build-catalog. */
  hd: number | null;
  x_pc: number | null;
  y_pc: number | null;
  z_pc: number | null;
  absmag: number | null;
  ci: number | null;
  spect: string;
  name: string;
  source: string;
  astrometryVia: string;
  spectVia: string;
  /** Stage 6's per-row photometry provenance. `athyg_own` /
   *  `athyg_system_inherited` / `none`. Companion promotion reads
   *  this to detect inherited photometry directly instead of
   *  comparing absmag to the primary's by float equality. */
  photometryVia: string;
  orbitRole: OrbitRole;
  distPc: number | null;
  /** Stage 4 orbital elements. Promotion consults them only through
   *  hasRenderableOrbit — placement and brightness rules fork on
   *  whether the runtime BinaryOrbitField will animate the pair. */
  pDays: number | null;
  tJd: number | null;
  e: number | null;
  aAU: number | null;
  iRad: number | null;
  omegaRad: number | null;
  q: number | null;
  sepArcsec: number | null;
  paDeg: number | null;
  sepPaEpochJd: number | null;
  dmag: number | null;
  /** Stage 6's per-component offset from the system anchor letter (BFS
   *  over kept → Stage-5-rejected → compound-proxy WDS geometry). Feeds
   *  the pair-row-primary escape's projection off the WDS-root anchor;
   *  null when no geometry chain reaches the component. */
  anchorSepArcsec: number | null;
  anchorPaDeg: number | null;
  /** The pair row's published WDS apparent magnitudes (a row's OWN mag
   *  is magPri when it is the pair primary, magSec when secondary).
   *  Feeds the wds_mag absmag path. */
  magPri: number | null;
  magSec: number | null;
}

export const PHOTOMETRY_VIA_OWN = 'athyg_own';
export const PHOTOMETRY_VIA_SYSTEM_INHERITED = 'athyg_system_inherited';
export const PHOTOMETRY_VIA_GAIA = 'gaia_photometry';
export const PHOTOMETRY_VIA_NONE = 'none';

/** spect_via values whose `spect` string genuinely describes THIS
 *  component rather than the whole system: Stage 6's curated-override
 *  tier and the SIMBAD per-component join. `athyg` is the system
 *  primary's string inherited by every component. */
export const PER_COMPONENT_SPECT_VIA: ReadonlySet<string> = new Set([
  'curated',
  'simbad',
]);

/** Mirrors the runtime has_orbit contract (binaries-loader FLAG_HAS_ORBIT
 *  + orbit-relation-cache finite-elements gate): BinaryOrbitField
 *  animates the pair only when P, T, e, a, ω, q are all present.
 *  i and Ω are optional (Tier-2 galactic-plane fallback). */
export function hasRenderableOrbit(row: MultiplesTsvRow): boolean {
  return row.pDays !== null && row.tJd !== null && row.e !== null
    && row.aAU !== null && row.omegaRad !== null && row.q !== null;
}

function nonEmpty(s: string | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  return t ? t : null;
}

function parseFloatOrNull(s: string | undefined): number | null {
  const t = nonEmpty(s);
  if (t === null) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

function parseIntOrNull(s: string | undefined): number | null {
  const v = parseFloatOrNull(s);
  return v === null ? null : Math.trunc(v);
}

export function parseMultiplesTsv(text: string): MultiplesTsvRow[] {
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return [];
  const header = lines[0].split('\t');
  const col = (name: string): number => {
    const idx = header.indexOf(name);
    if (idx < 0) {
      throw new Error(
        `multiples.tsv is missing required column "${name}". ` +
          `Re-run npm run build:binaries.`,
      );
    }
    return idx;
  };
  // Resolve every needed column up front so a header rename fails
  // loudly at parse start, not deep into row iteration.
  const idx = {
    systemId: col('system_id'),
    comp: col('comp'),
    hip: col('hip'),
    gaiaSourceId: col('gaia_source_id'),
    hd: col('hd'),
    x_pc: col('x_pc'),
    y_pc: col('y_pc'),
    z_pc: col('z_pc'),
    absmag: col('absmag'),
    ci: col('ci'),
    spect: col('spect'),
    name: col('name'),
    source: col('source'),
    astrometryVia: col('astrometry_via'),
    spectVia: col('spect_via'),
    photometryVia: col('photometry_via'),
    orbitRole: col('orbit_role'),
    distPc: col('dist_pc'),
    pDays: col('P_days'),
    tJd: col('T_jd'),
    e: col('e'),
    aAU: col('a_AU'),
    iRad: col('i_rad'),
    omegaRad: col('omega_rad'),
    q: col('q'),
    sepArcsec: col('sep_arcsec'),
    paDeg: col('pa_deg'),
    sepPaEpochJd: col('sep_pa_epoch_jd'),
    dmag: col('dmag'),
    anchorSepArcsec: col('anchor_sep_arcsec'),
    anchorPaDeg: col('anchor_pa_deg'),
    magPri: col('mag_pri'),
    magSec: col('mag_sec'),
  };

  const rows: MultiplesTsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cells = line.split('\t');
    const role = cells[idx.orbitRole] as OrbitRole;
    rows.push({
      systemId: cells[idx.systemId],
      comp: cells[idx.comp],
      hip: parseIntOrNull(cells[idx.hip]),
      gaiaSourceId: parseGaiaSourceIdStr(cells[idx.gaiaSourceId]),
      hd: parseIntOrNull(cells[idx.hd]),
      x_pc: parseFloatOrNull(cells[idx.x_pc]),
      y_pc: parseFloatOrNull(cells[idx.y_pc]),
      z_pc: parseFloatOrNull(cells[idx.z_pc]),
      absmag: parseFloatOrNull(cells[idx.absmag]),
      ci: parseFloatOrNull(cells[idx.ci]),
      spect: cells[idx.spect] ?? '',
      name: cells[idx.name] ?? '',
      source: cells[idx.source] ?? '',
      astrometryVia: cells[idx.astrometryVia] ?? '',
      spectVia: cells[idx.spectVia] ?? '',
      photometryVia: cells[idx.photometryVia] ?? '',
      orbitRole: role,
      distPc: parseFloatOrNull(cells[idx.distPc]),
      pDays: parseFloatOrNull(cells[idx.pDays]),
      tJd: parseFloatOrNull(cells[idx.tJd]),
      e: parseFloatOrNull(cells[idx.e]),
      aAU: parseFloatOrNull(cells[idx.aAU]),
      iRad: parseFloatOrNull(cells[idx.iRad]),
      omegaRad: parseFloatOrNull(cells[idx.omegaRad]),
      q: parseFloatOrNull(cells[idx.q]),
      sepArcsec: parseFloatOrNull(cells[idx.sepArcsec]),
      paDeg: parseFloatOrNull(cells[idx.paDeg]),
      sepPaEpochJd: parseFloatOrNull(cells[idx.sepPaEpochJd]),
      dmag: parseFloatOrNull(cells[idx.dmag]),
      anchorSepArcsec: parseFloatOrNull(cells[idx.anchorSepArcsec]),
      anchorPaDeg: parseFloatOrNull(cells[idx.anchorPaDeg]),
      magPri: parseFloatOrNull(cells[idx.magPri]),
      magSec: parseFloatOrNull(cells[idx.magSec]),
    });
  }
  return rows;
}

export function readMultiplesTsv(path: string): MultiplesTsvRow[] {
  return parseMultiplesTsv(readFileSync(path, 'utf8'));
}

// ---- Tangent-plane projection ------------------------------------------

export interface CompanionPlacement {
  x: number;
  y: number;
  z: number;
  distPc: number;
}

// Project a secondary's xyz from the primary's ICRS xyz + WDS (rho, theta)
// at the primary's distance. The maths is identical to what the runtime
// BinaryOrbitField will use for its Tier-3 placement — keep both call sites
// reading the same helper so a coordinate-convention drift here surfaces
// in both places.
//
// theta is WDS position angle: degrees east of north, measured at the
// primary. east_hat / north_hat are the ICRS tangent basis at the primary's
// sky position.
export function projectFromSepPa(
  primaryX: number,
  primaryY: number,
  primaryZ: number,
  sepArcsec: number,
  paDeg: number,
): CompanionPlacement | null {
  const distPc = Math.sqrt(
    primaryX * primaryX + primaryY * primaryY + primaryZ * primaryZ,
  );
  if (!(distPc > 0)) return null;
  const ra = Math.atan2(primaryY, primaryX);
  const dec = Math.asin(primaryZ / distPc);
  const sinRa = Math.sin(ra), cosRa = Math.cos(ra);
  const sinDec = Math.sin(dec), cosDec = Math.cos(dec);
  // East at the primary: direction of increasing RA on the celestial sphere.
  const eastX = -sinRa, eastY = cosRa, eastZ = 0;
  // North at the primary: direction of increasing Dec.
  const northX = -sinDec * cosRa;
  const northY = -sinDec * sinRa;
  const northZ = cosDec;
  const paRad = paDeg * (Math.PI / 180.0);
  const sepRad = sepArcsec * ARCSEC_TO_RAD;
  const offsetN = sepRad * Math.cos(paRad);  // north component (rad)
  const offsetE = sepRad * Math.sin(paRad);  // east component (rad)
  // Small-angle: linear in parsecs at the primary's distance.
  const dxPc = (offsetN * northX + offsetE * eastX) * distPc;
  const dyPc = (offsetN * northY + offsetE * eastY) * distPc;
  const dzPc = (offsetN * northZ + offsetE * eastZ) * distPc;
  const cx = primaryX + dxPc;
  const cy = primaryY + dyPc;
  const cz = primaryZ + dzPc;
  return {
    x: cx,
    y: cy,
    z: cz,
    distPc: Math.sqrt(cx * cx + cy * cy + cz * cz),
  };
}

// A tangent-projected companion is placed at the primary's distance, so
// its projected physical separation ρ·d is a lower bound on the pair's
// true 3D separation. Beyond OPTICAL_DOUBLE_MIN_SEP_PC (the Galactic
// tidal-disruption limit) no pair can be bound — refuse to fabricate a
// companion there. Only the projection branch consults this; a secondary
// with its own resolved astrometry is already vetted by Stage 5's
// parallax gate, which can't reach an unresolved (parallax-less) one.
function projectionBeyondTidalLimit(
  anchorX: number,
  anchorY: number,
  anchorZ: number,
  sepArcsec: number,
): boolean {
  const distPc = Math.sqrt(
    anchorX * anchorX + anchorY * anchorY + anchorZ * anchorZ,
  );
  return sepArcsec * ARCSEC_TO_RAD * distPc > OPTICAL_DOUBLE_MIN_SEP_PC;
}

// ---- Promotion --------------------------------------------------------

export interface PromotionStats {
  /** Pair rows scanned (excludes standalone-orbit-role rows). */
  pairRowsScanned: number;
  /** Rows whose identifier already resolves to an existing catalog row. */
  alreadyInCatalog: number;
  /** Newly minted companion records added to the catalog. */
  promoted: number;
  /** Subset of `promoted` addressable only via the synthetic-ID path. */
  promotedSynthetic: number;
  /** Dropped because no identifier could be formed (gaia + hip both
   *  blank AND synthetic key uncomposable). */
  droppedNoIdentifier: number;
  /** Dropped because no anchor — neither own astrometry nor sep+PA. */
  droppedNoPosition: number;
  /** Dropped because the tangent projection ρ·d exceeds the Galactic
   *  tidal-disruption limit (OPTICAL_DOUBLE_MIN_SEP_PC): a fabricated
   *  companion that far can't be gravitationally bound, so an unresolved
   *  WDS secondary there is a line-of-sight optical double. The projected
   *  separation is a lower bound on the true 3D separation, and Stage 5's
   *  parallax gate can't reach it (the secondary has no parallax). */
  droppedBeyondTidalLimit: number;
  /** Dropped because primary's catalog row wasn't found (orphaned pair). */
  droppedNoPrimary: number;
  /** Dropped because no honest absmag path existed: own photometry
   *  missing or inherited, no Δmag, no per-component spectral type,
   *  and no renderable orbit forcing the record to survive. */
  droppedNoAbsmag: number;
  /** Subset of `promoted` whose absmag came from the class→M_V
   *  spectral calibration (inherited/missing photometry, no Δmag). */
  absmagSpectralDerived: number;
  /** Subset of `promoted` whose spectral info was re-derived as a
   *  main-sequence estimate from the component's own de-extincted
   *  absmag (`spectralFromAbsmag`) because the row's spect string is
   *  the system primary's inherited type (or blank) — the population
   *  that previously rendered hot-but-tiny (Algol Ab as B8V). */
  spectMsFromOwnAbsmag: number;
  /** Subset of `promoted` whose absmag came from the row's own WDS
   *  apparent magnitude at the system distance (both Δmag paths
   *  unavailable, or an escape row whose "own" photometry is the
   *  anchor's blend). */
  absmagWdsMagDerived: number;
  /** Subset of `promoted` (pair-row-primary escapes) whose absmag fell
   *  back to the anchor's collocated brightness (see imputeCompanionAbsmag).
   *  Ratchet-down: curate WD absmags. */
  absmagAnchorCollocated: number;
  /** Existing AT-HYG records repositioned in place because they ARE
   *  the companion (same composed name, bit-identical to the anchor —
   *  AT-HYG blend-coordinate double entries like ξ UMa B). Not counted
   *  in `promoted`; no new record is minted. */
  repositionedCollocatedDouble: number;
  /** Subset of `promoted` still carrying the inherited primary absmag
   *  (full-luminosity twin) because the pair has a renderable orbit
   *  and no per-component type is curated yet. Each is a known
   *  residual of the twin-brightness bug. */
  absmagInheritedTwinOrbital: number;
  /** Dropped because the secondary's comp letter is an unresolved
   *  compound aggregate (e.g. "BC" / "AB" / "ABC") whose constituent
   *  single-letter components appear as sibling cursors in the same
   *  WDS root — not a single star. */
  droppedCompoundComp: number;
  /** Pair-row primary dropped because no position was derivable —
   *  neither own per-component astrometry nor a Stage-6 anchor_sep/pa
   *  offset. Collocating on the anchor would render a false coincident
   *  star (Alsephina C). */
  droppedCollocatedPrimary: number;
  /** Sub-resolution inner-pair secondaries re-collocated onto their true
   *  parent component in the post-pass. Their cursor primary's blended
   *  identifier baked them on a sibling (Castor Bb on A); this moves them
   *  onto B so the catalog placement matches the binaries.bin pair anchor
   *  (build-runtime-binaries.py's override_inner_primary_indices). */
  repositionedInnerToParent: number;
  /** Promoted gaia_photometry records whose absmag was reduced by the
   *  blend-split post-pass: when N≥2 collocated records share one Gaia
   *  source (an unresolved sub-arcsec pair Gaia fit as a single source,
   *  e.g. YY Gem Ca/Cb), that source's G is the pair's COMBINED light, so
   *  each component is fainter than the derived combined M by
   *  2.5·log10(N). Counts every record so adjusted. */
  blendSplitRecords: number;
  /** Anchor records dimmed by the flux-conservation post-pass: a synth
   *  member whose ids were inherited-then-stripped from an athyg_own
   *  anchor got a wds_mag / dmag absmag, so its flux is part of the
   *  anchor's AT-HYG blend magnitude and is subtracted back out
   *  (M′ = −2.5·log₁₀(10^(−0.4·M_blend) − 10^(−0.4·M_member))). */
  blendDimmedAnchors: number;
  /** Dim candidates skipped by the guard M_member > M_blend + 0.05 —
   *  a member as bright as (or brighter than) its anchor's blend would
   *  zero or invert the residual flux. */
  blendDimSkipped: number;
}

export function emptyPromotionStats(): PromotionStats {
  return {
    pairRowsScanned: 0,
    alreadyInCatalog: 0,
    promoted: 0,
    promotedSynthetic: 0,
    droppedNoIdentifier: 0,
    droppedNoPosition: 0,
    droppedBeyondTidalLimit: 0,
    droppedNoPrimary: 0,
    droppedNoAbsmag: 0,
    absmagSpectralDerived: 0,
    spectMsFromOwnAbsmag: 0,
    absmagWdsMagDerived: 0,
    absmagAnchorCollocated: 0,
    absmagInheritedTwinOrbital: 0,
    repositionedCollocatedDouble: 0,
    droppedCompoundComp: 0,
    droppedCollocatedPrimary: 0,
    repositionedInnerToParent: 0,
    blendSplitRecords: 0,
    blendDimmedAnchors: 0,
    blendDimSkipped: 0,
  };
}

/** Compose `synth-<wds_id>-<comp>`. See scripts/catalog/README.md
 *  § Companion promotion for when this fires. */
export function composeSyntheticId(
  systemId: string,
  comp: string,
): string | null {
  const c = comp.trim();
  if (!c) return null;
  const dash = systemId.lastIndexOf('-');
  if (dash < 0) return null;
  const wdsId = systemId.slice(0, dash);
  if (!wdsId) return null;
  return `synth-${wdsId}-${c}`;
}

/** Re-anchor WDS prefix-truncation on a secondary's `comp` cell.
 *  Stage 6 emits `comp="2"` for the secondary side of `"Aa1,2"`
 *  pairs; canonical WDS form is `"Aa2"` (primary stem + secondary
 *  digit). Used for both the synthetic-ID key and the display name
 *  so the catalog and runtime share one canonical comp form. */
export function canonicalCompLetter(
  primaryComp: string,
  secondaryComp: string,
): string {
  const sec = secondaryComp.trim();
  const pri = primaryComp.trim();
  if (sec && /^\d+$/.test(sec) && pri.length >= 2 && /\d$/.test(pri)) {
    return pri.slice(0, -1) + sec;
  }
  return sec;
}

/** Parent component token: ``"Ba" → "B"``, ``"Aa1" → "Aa"``, ``"A" → null``.
 *  Drops the rightmost designator; mirrors
 *  `component_tokens.py:parent_component_token` on the Python side. */
export function parentComponentToken(comp: string): string | null {
  const c = comp.trim();
  return c.length > 1 ? c.slice(0, -1) : null;
}

interface ExistingIndexes {
  byGaia: Map<string, number>;
  byHip: Map<number, number>;
  /** Proper name → record index, first-wins. Drives the collocated
   *  AT-HYG double-entry merge (see promoteRow). */
  byProper: Map<string, number>;
}

function buildExistingIndexes(stars: Star[]): ExistingIndexes {
  const byGaia = new Map<string, number>();
  const byHip = new Map<number, number>();
  const byProper = new Map<string, number>();
  for (let i = 0; i < stars.length; i++) {
    const s = stars[i];
    if (s.gaiaSourceId && !byGaia.has(s.gaiaSourceId)) {
      byGaia.set(s.gaiaSourceId, i);
    }
    if (s.hip !== null && s.hip > 0 && !byHip.has(s.hip)) {
      byHip.set(s.hip, i);
    }
    if (s.proper && !byProper.has(s.proper)) {
      byProper.set(s.proper, i);
    }
  }
  return { byGaia, byHip, byProper };
}

function findExisting(
  row: MultiplesTsvRow,
  existing: ExistingIndexes,
): number | null {
  if (row.gaiaSourceId) {
    const hit = existing.byGaia.get(row.gaiaSourceId);
    if (hit !== undefined) return hit;
  }
  // HIP fall-through fires only when the row carries no gaia_source_id
  // at all. Companions that share the primary's HIP (Sirius A and B
  // both list HIP 32349) dodge the collision when their own gaia is
  // set — the gaia lookup above already returned null, so promotion
  // proceeds without HIP-collapsing them onto the primary's record.
  if (row.gaiaSourceId === null && row.hip !== null && row.hip > 0) {
    const hit = existing.byHip.get(row.hip);
    if (hit !== undefined) return hit;
  }
  return null;
}

// A proper-name anchor hit must also agree on position — names are
// effectively unique in AT-HYG, but the guard keeps a hypothetical
// collision from anchoring a system on an unrelated star.
const NAME_ANCHOR_MAX_POS_DELTA_PC = 0.1;

// Cursor-primary lookup. More permissive than findExisting: tries HIP
// even when gaia is set, because AT-HYG sometimes carries only HIP for
// the primary while multiples.tsv has the Gaia source_id from SIMBAD's
// cross-walk (70 Oph A — HIP 88601 in AT-HYG, no own gaia; multiples
// row carries gaia=4468557611984384512 from simbad_xid). For primaries
// the shared-HIP-with-secondary ambiguity doesn't apply — the cursor
// primary IS the system anchor, not a sibling that might collide.
// The proper-name tier is the last resort for GJ-only AT-HYG rows
// carrying neither id (ξ UMa A) — without it the whole cursor runs
// anchor-less and the collocated-double merge can never fire.
function findExistingPrimary(
  row: MultiplesTsvRow,
  existing: ExistingIndexes,
  existingStars: Star[],
): number | null {
  if (row.gaiaSourceId) {
    const hit = existing.byGaia.get(row.gaiaSourceId);
    if (hit !== undefined) return hit;
  }
  if (row.hip !== null && row.hip > 0) {
    const hit = existing.byHip.get(row.hip);
    if (hit !== undefined) return hit;
  }
  const name = row.name.trim();
  if (name && row.x_pc !== null && row.y_pc !== null && row.z_pc !== null) {
    const hit = existing.byProper.get(name);
    if (hit !== undefined) {
      const s = existingStars[hit];
      if (Math.abs(s.x - row.x_pc) < NAME_ANCHOR_MAX_POS_DELTA_PC
          && Math.abs(s.y - row.y_pc) < NAME_ANCHOR_MAX_POS_DELTA_PC
          && Math.abs(s.z - row.z_pc) < NAME_ANCHOR_MAX_POS_DELTA_PC) {
        return hit;
      }
    }
  }
  return null;
}

interface PairCursor {
  primary: MultiplesTsvRow | null;
  secondaries: MultiplesTsvRow[];
}

// Group decomposing-pair rows by system_id so the promotion of a secondary
// can read the primary's resolved AT-HYG absmag for the Δmag imputation.
// Standalone-role rows are emitted in their own bucket (one per row) since
// they aren't sides of a WDS pair.
export function groupBySystem(rows: MultiplesTsvRow[]): Map<string, PairCursor> {
  const groups = new Map<string, PairCursor>();
  for (const r of rows) {
    let cursor = groups.get(r.systemId);
    if (!cursor) {
      cursor = { primary: null, secondaries: [] };
      groups.set(r.systemId, cursor);
    }
    if (r.orbitRole === 'primary') cursor.primary = r;
    else cursor.secondaries.push(r);
  }
  return groups;
}

// Companion B-V (ci). When Stage 6 tags the row's photometry as
// inherited from the system primary (Sirius B's row carrying Sirius A's
// 0.009 white instead of its own DA1.9 blue), derive an intrinsic colour
// from the spectral class via the shared spectralClassCi.
/** True when the row's `ci` is its OWN observed B−V (dust-reddened), so
 *  build-time de-extinction must de-redden it. False when imputeCompanionCi
 *  derives an intrinsic B−V from spectral type or the solar fallback —
 *  those are already extinction-free and must not be de-reddened. */
export function companionCiIsObserved(secondary: MultiplesTsvRow): boolean {
  return secondary.ci !== null
    && secondary.photometryVia !== PHOTOMETRY_VIA_SYSTEM_INHERITED;
}

export function imputeCompanionCi(
  secondary: MultiplesTsvRow,
  spectralInfo: SpectralInfo,
): number {
  if (companionCiIsObserved(secondary)) {
    return secondary.ci as number;
  }
  return spectralClassCi(spectralInfo);
}


/** Which path produced a companion's absmag. `dmag_imputed` = primary +
 *  WDS Δmag; `own` = the row's own (non-inherited) photometry;
 *  `wds_mag` = the row's own WDS apparent magnitude at the system
 *  distance (M = m − 5·log₁₀(d/10)) — fires when both Δmag paths are
 *  unavailable, ahead of the spectral calibration;
 *  `spectral` = class→M_V from the row's per-component spectral type;
 *  `inherited_twin` = the inherited primary absmag kept ONLY because
 *  the pair has a renderable orbit (dropping the record would also
 *  drop its orbit/eclipse from binaries.bin) and no honest brightness
 *  source exists yet; `anchor_collocated` = a pair-row-primary escape
 *  falling back to the anchor's brightness (see imputeCompanionAbsmag). */
export type CompanionAbsmagSource =
  | 'dmag_imputed'
  | 'own'
  | 'wds_mag'
  | 'spectral'
  | 'inherited_twin'
  | 'anchor_collocated';

export interface CompanionAbsmag {
  absmag: number;
  source: CompanionAbsmagSource;
}

/** Absmag sources that measure THIS component's own light — the gate for
 *  the MS-from-own-absmag spectral re-derivation. `inherited_twin` and
 *  `anchor_collocated` reproduce the anchor's brightness, so deriving a
 *  type from them would just re-mint the primary; `spectral` is itself
 *  type-derived and would be circular. */
export const OWN_BRIGHTNESS_ABSMAG_SOURCES: ReadonlySet<CompanionAbsmagSource> =
  new Set(['dmag_imputed', 'own', 'wds_mag']);

/** True when the anchor's AT-HYG magnitude is the PAIR's blended light
 *  rather than the primary component alone — the flux-conservation dim
 *  applies only then. Hipparcos/Tycho blend close pairs into one entry
 *  (Castor's mag 1.58 is A+B combined) but resolve wide ones
 *  per-component (Polaris' 1.98 is A alone); WDS mag_pri/mag_sec give
 *  both hypotheses and the anchor's observed apparent magnitude picks
 *  the closer. `av` re-adds the build-time de-extinction so the
 *  comparison stays in the observed frame WDS mags live in. Skips
 *  (false) when the hypotheses differ by <0.01 mag — the dim would be
 *  a no-op there anyway, and near-degenerate cases (Sirius, Δmag≈10)
 *  must not flip pinned values on float noise. */
function anchorMagIsPairBlend(
  anchor: Star,
  row: MultiplesTsvRow,
  av: number,
): boolean {
  const { magPri, magSec } = row;
  const distPc = row.distPc;
  if (magPri === null || magSec === null || distPc === null || distPc <= 0) {
    return false;
  }
  const blend = -2.5 * Math.log10(
    Math.pow(10, -0.4 * magPri) + Math.pow(10, -0.4 * magSec),
  );
  if (magPri - blend < 0.01) return false;
  const appMag = anchor.absmag + av + 5 * Math.log10(distPc / 10);
  return Math.abs(appMag - blend) < Math.abs(appMag - magPri);
}

// Companion absmag. Preference order: primary + WDS Δmag when the
// row's photometry is inherited; the row's own absmag when it isn't;
// primary + Δmag fallback; the row's own WDS apparent mag at the
// system distance; class→M_V from a per-component spectral type. A
// row with none of those has NO honest brightness source — returning
// the inherited absmag would mint a full-luminosity twin of the
// primary (Algol Aa2, Betelgeuse Ab). Those rows return null (caller
// drops) unless the pair carries a renderable orbit, where the record
// must survive for binaries.bin's sake and the twin is kept, tagged,
// and counted.
//
// anchorDmagApplies is false for a pair-row-primary escape: that row's
// Δmag describes the SUB-pair it heads (40 Eri B's Δmag is the B→C
// delta), not the anchor→row separation, so adding it to the anchor's
// absmag is meaningless. Both primary+Δmag paths are skipped, and when
// no honest brightness exists the record inherits the anchor's
// collocated brightness rather than a corrupted A+Δmag.
//
// ownPhotometryIsAnchorBlend is true for an escape row whose only ids
// were inherited from the anchor: its "own" AT-HYG photometry was
// reached through the anchor's identifier, so it is the anchor's BLEND
// magnitude, not this component's (Acrux B's row carries A's −4.2
// blend). The own path is skipped and the row's WDS mag wins.
export function imputeCompanionAbsmag(
  secondary: MultiplesTsvRow,
  primary: MultiplesTsvRow | null,
  spectral: SpectralInfo,
  anchorDmagApplies = true,
  ownPhotometryIsAnchorBlend = false,
): CompanionAbsmag | null {
  const primaryAbsmag = primary?.absmag ?? null;
  const dmag = secondary.dmag;
  const inheritedPhotometry =
    secondary.photometryVia === PHOTOMETRY_VIA_SYSTEM_INHERITED;

  if (anchorDmagApplies && inheritedPhotometry
      && primaryAbsmag !== null && dmag !== null) {
    return { absmag: primaryAbsmag + dmag, source: 'dmag_imputed' };
  }
  if (!inheritedPhotometry && !ownPhotometryIsAnchorBlend
      && secondary.absmag !== null) {
    return { absmag: secondary.absmag, source: 'own' };
  }
  if (anchorDmagApplies && primaryAbsmag !== null && dmag !== null) {
    return { absmag: primaryAbsmag + dmag, source: 'dmag_imputed' };
  }
  const ownWdsMag = secondary.orbitRole === 'primary'
    ? secondary.magPri : secondary.magSec;
  const distPc = secondary.distPc ?? primary?.distPc ?? null;
  if (ownWdsMag !== null && distPc !== null && distPc > 0) {
    return {
      absmag: ownWdsMag - 5 * Math.log10(distPc / 10),
      source: 'wds_mag',
    };
  }
  if (PER_COMPONENT_SPECT_VIA.has(secondary.spectVia)) {
    const mv = absmagFromSpectral(spectral);
    if (mv !== null) return { absmag: mv, source: 'spectral' };
  }
  if (inheritedPhotometry && secondary.absmag !== null
      && hasRenderableOrbit(secondary)) {
    return { absmag: secondary.absmag, source: 'inherited_twin' };
  }
  if (!anchorDmagApplies && primaryAbsmag !== null) {
    return { absmag: primaryAbsmag, source: 'anchor_collocated' };
  }
  return null;
}

/** Anchor xyz the sep+PA projection should orbit around. When the
 *  companion's primary already has a catalog.bin record, the existing
 *  star's xyz is the authoritative anchor — AT-HYG and the binaries
 *  pipeline emit positions at different precisions (AT-HYG truncates to
 *  3–4 sig figs, the binaries pipeline keeps 6 from HIP2), so
 *  projecting from the multiples.tsv primary row would offset the
 *  companion by the pipeline-precision gap (~100 AU for Sirius)
 *  instead of just the published sep+PA.
 */
export interface ProjectionAnchor {
  x: number;
  y: number;
  z: number;
}

// A component's xyz is "independent" only when Stage 3 re-anchored it
// per-component. gaia_5p with its own gaia_source_id, or
// hip2_long_baseline with its own HIP, count. Every other route —
// athyg_position, gaia_nss_systemic, system_inherited (and the
// shared-identifier shape inside the routes above) — reproduces the
// SYSTEM anchor under a different float path. Strict xyz equality
// missed this because float residue ranges from µpc at nearby systems
// (Algol Aa↔Ab) to tens of AU at hundreds of pc (Polaris Aa↔Ab); the
// tag itself is the reliable signal. `primaryGaia` / `primaryHip` are
// the anchor primary's identifiers — a component sharing them isn't a
// per-component fit.
function resolveIndependentAstrometry(
  row: MultiplesTsvRow,
  primaryGaia: string | null,
  primaryHip: number | null,
): CompanionPlacement | null {
  const ownAstrometry =
    row.astrometryVia !== 'system_inherited'
    && row.x_pc !== null && row.y_pc !== null && row.z_pc !== null
    && row.distPc !== null;
  const independent =
    ownAstrometry
    && INDEPENDENT_FIT_ROUTES.has(row.astrometryVia)
    && ((row.astrometryVia === 'gaia_5p'
         && row.gaiaSourceId !== null
         && row.gaiaSourceId !== primaryGaia)
      || (row.astrometryVia === 'hip2_long_baseline'
          && row.hip !== null && row.hip > 0
          && row.hip !== primaryHip));
  if (!independent) return null;
  return {
    x: row.x_pc as number, y: row.y_pc as number, z: row.z_pc as number,
    distPc: row.distPc as number,
  };
}

function resolvePosition(
  row: MultiplesTsvRow,
  primary: MultiplesTsvRow | null,
  anchor: ProjectionAnchor | null,
): CompanionPlacement | 'beyond-tidal' | null {
  // The catalog primary's xyz is the authoritative position, and sep+PA
  // tangent projection from it keeps every component of one system
  // rendered coherently. Independent per-component astrometry wins over
  // that projection when Stage 3 supplied it.
  const independent = resolveIndependentAstrometry(
    row, primary?.gaiaSourceId ?? null, primary?.hip ?? null,
  );
  if (independent !== null) return independent;
  // Tangent projection branch. Prefer the existing catalog anchor when
  // one was supplied (primary already in catalog.bin); otherwise fall
  // back to the multiples.tsv primary row's xyz.
  let anchorX: number, anchorY: number, anchorZ: number;
  if (anchor !== null) {
    anchorX = anchor.x; anchorY = anchor.y; anchorZ = anchor.z;
  } else if (primary !== null
      && primary.x_pc !== null && primary.y_pc !== null && primary.z_pc !== null) {
    anchorX = primary.x_pc; anchorY = primary.y_pc; anchorZ = primary.z_pc;
  } else {
    return null;
  }
  const sepArcsec = row.sepArcsec;
  const paDeg = row.paDeg;
  // Sub-resolution (rho 0.000) or unmeasured pairs: there is no static
  // placement to bake. When the runtime animates the pair, collocate
  // the secondary bit-identically on the anchor — a placement choice
  // for the LOD fallback only; the runtime renders the relative offset
  // as R(t) from the orbital elements alone regardless of the baked
  // placement (see src/client/binaries/orbit-relation-cache.ts
  // baseDiffPc). Without a renderable orbit nothing ever separates the
  // two records and the collocated star double-counts the blend
  // photometry (ξ UMa Bb inside A) — drop.
  if (sepArcsec === null || sepArcsec === 0) {
    if (!hasRenderableOrbit(row)) return null;
    return {
      x: anchorX, y: anchorY, z: anchorZ,
      distPc: Math.sqrt(anchorX * anchorX + anchorY * anchorY + anchorZ * anchorZ),
    };
  }
  if (paDeg === null) return null;
  if (projectionBeyondTidalLimit(anchorX, anchorY, anchorZ, sepArcsec)) {
    return 'beyond-tidal';
  }
  return projectFromSepPa(anchorX, anchorY, anchorZ, sepArcsec, paDeg);
}

// A member at M_blend + 0.05 carries ~95% of the blend's flux; anything
// brighter leaves no residual for the anchor to keep.
const ANCHOR_DIM_MIN_DELTA_MAG = 0.05;

/** SpectralInfo for an existing catalog record, for re-deriving its
 *  radius after a brightness change. Re-parses the display string when
 *  possible; otherwise reconstructs the coarse class/lum fields the
 *  record already carries (subclass defaults to the mid-class 5). */
function anchorSpectralInfo(star: Star): SpectralInfo {
  const parsed = star.spectDisplay ? classifyFromSimbad(star.spectDisplay) : null;
  return parsed ?? {
    classIdx: star.spectClass,
    subclass: 5,
    lumClass: star.lumClass,
    isWhiteDwarf: star.lumClass === 0,
    wdSubclass: 5,
  };
}

// Spectral inheritance for a promoted companion. The row's own
// `spect` column carries the SIMBAD-per-component sp_type when available
// (spect_via=simbad); otherwise it inherits the primary's AT-HYG class.
// We re-run the strict SIMBAD parser so we get a SpectralInfo, not just
// a display string. White-dwarf rows like "DA1.9" parse with classIdx=8
// and isWhiteDwarf=true — wdSubclass flows into the colour-temperature
// LUT downstream.
function resolveCompanionSpectral(row: MultiplesTsvRow): {
  info: SpectralInfo;
  display: string | null;
} {
  const raw = row.spect.trim();
  if (raw) {
    const parsed = classifyFromSimbad(raw);
    if (parsed) {
      const display = resolveSpectDisplay(raw, raw);
      return { info: parsed, display };
    }
  }
  return { info: SPECTRAL_UNKNOWN, display: null };
}

// Compose the companion's display name as "<base> <canonicalComp>".
// Base falls through five sources in order of preference:
//   1. row's own `name` cell (Stage 6 populates when source=athyg).
//   2. multiples primary row's `name` cell (Achird / Porrima / Capella
//      class — secondary row is source=wds but primary has AT-HYG
//      proper).
//   3. primary Star's `proper` (post-override; covers cases where
//      Stage 6 didn't carry the AT-HYG proper into multiples.tsv).
//   4. primary Star's Bayer + constellation abbrev → "Xi Boo".
//   5. primary Star's Flamsteed + constellation abbrev → "70 Oph".
// Constellation abbrev alone is NOT a fallback — refuse and return
// null rather than colliding with every other star in the same
// constellation. Without a base the promoted record stays nameless
// (searchable through synth-ID, but no display name).
function composeCompanionName(
  row: MultiplesTsvRow,
  primary: MultiplesTsvRow | null,
  canonicalComp: string,
  primaryStar: Star | null,
  constellations: { code: string; name: string }[],
  systemPrimaryStar: Star | null = null,
): string | null {
  const base = resolveCompanionNameBase(
    row, primary, primaryStar, constellations, systemPrimaryStar, true,
  );
  if (!base) return null;
  const systemBase = starNameBase(systemPrimaryStar, constellations)
    ?? starNameBase(primaryStar, constellations);
  return joinComponentName(
    stripDoubledParentToken(
      stripBlendedSiblingLetter(base, canonicalComp, systemBase),
      canonicalComp, primary?.comp ?? null,
    ),
    canonicalComp,
  );
}

/** Strip a trailing single-letter component token when a blended
 *  top-level component inherited a SIBLING's composed name. Acrab's WDS
 *  E shares β² Sco's (WDS C) Gaia source, so Stage 6 stamps E's row name
 *  as "Acrab B" (β² Sco's own name); appending the canonical top-level
 *  letter would read "Acrab B E". A top-level letter composes flat off
 *  the system base, so strip the trailing " <letter>" when the prefix is
 *  exactly the system's resolved base name — "Acrab B" → "Acrab" →
 *  "Acrab E". A real proper name ending in a capital-letter word never
 *  equals the system base, so it survives; and only a top-level canonical
 *  letter triggers it (sub-letters route through stripDoubledParentToken). */
export function stripBlendedSiblingLetter(
  base: string,
  canonicalComp: string,
  systemBase: string | null,
): string {
  if (systemBase === null || !/^[A-Z]$/.test(canonicalComp)) return base;
  const m = /^(.+) [A-Z]$/.exec(base);
  if (m && m[1] === systemBase) return m[1];
  return base;
}

/** "<base> <comp>", or just base when comp is empty. */
function joinComponentName(base: string, comp: string): string {
  return comp ? `${base} ${comp}` : base;
}

/** proper → "Bayer con" → "Flamsteed con" for a catalog Star, then —
 *  only when `allowDesignation` — a "HIP n"/"HD n"/"HR n"/Gl catalogue
 *  designation tail. The tail mirrors the runtime `buildStarLabels` tier
 *  order (src/client/typeahead/search.ts) so a promoted companion of a
 *  name-less system reads "HIP 22812 Bb" instead of the "Unnamed #idx"
 *  sentinel; it deliberately has no Gaia tier, as buildStarLabels also
 *  stops before Gaia (a Gaia-only system stays name-less on both sides).
 *  The tail is a PRIMARY designation shared down onto the companion, so
 *  it is gated off for stampComponentLetters — two distinct first-class
 *  rows each own their HIP and must not both wear the primary's. */
function starNameBase(
  star: Star | null,
  constellations: { code: string; name: string }[],
  allowDesignation = false,
): string | null {
  if (star === null) return null;
  const proper = (star.proper ?? '').trim();
  if (proper) return proper;
  const conCode = constellationCode(star.conIndex, constellations);
  if (conCode !== null) {
    const bayer = (star.bayer ?? '').trim();
    if (bayer) return `${bayer} ${conCode}`;
    if (star.flam !== null) return `${star.flam} ${conCode}`;
  }
  if (!allowDesignation) return null;
  if (star.hip !== null && star.hip > 0) return `HIP ${star.hip}`;
  if (star.hd !== null) return `HD ${star.hd}`;
  if (star.hr !== null) return `HR ${star.hr}`;
  const gl = (star.gl ?? '').trim();
  if (gl) return gl;
  return null;
}

function resolveCompanionNameBase(
  row: MultiplesTsvRow,
  primary: MultiplesTsvRow | null,
  primaryStar: Star | null,
  constellations: { code: string; name: string }[],
  systemPrimaryStar: Star | null = null,
  allowDesignation = false,
): string | null {
  const ownBase = row.name.trim();
  if (ownBase) return ownBase;
  const primaryBase = (primary?.name ?? '').trim();
  if (primaryBase) return primaryBase;
  // A human name (proper / Bayer / Flamsteed) anywhere in the system wins:
  // local pair anchor first, then the WDS-root system primary — a sub-pair
  // whose local primary is nameless/unpromotable climbs to the system
  // primary (δ Vel CD's C → "Alsephina D"; ε Equ's C climbs past nameless
  // B → "Eps Equ C").
  const humanName = starNameBase(primaryStar, constellations)
    ?? starNameBase(systemPrimaryStar, constellations);
  if (humanName !== null) return humanName;
  // Last resort for a wholly name-less system: the primary's catalogue
  // designation (HIP/HD/HR/Gl), local anchor then system primary, so the
  // companion reads "HIP 22812 Bb" rather than the "Unnamed #idx" sentinel.
  if (!allowDesignation) return null;
  return starNameBase(primaryStar, constellations, true)
    ?? starNameBase(systemPrimaryStar, constellations, true);
}

/** Strip a trailing component-letter token from a name base when the
 *  canonical comp about to be appended would double it. Two shapes:
 *   - The base ends in the comp's own PARENT token — a subdivided inner
 *     pair whose local anchor is the parent component's record, already
 *     carrying that letter (Castor's YY Gem primary Ca resolves onto the
 *     "Castor C" record; "Castor C" + "Cb" → "Castor Cb").
 *   - The base ends in the LOCAL PRIMARY's comp — a chained pair-row
 *     promotion whose anchor is itself a promoted "<designation> <letter>"
 *     record (AR Cas's F,G pair: "HIP 115990 F" + "G" → "HIP 115990 G").
 *  The canonical comp already encodes the full path from the root, so the
 *  intermediate letter belongs to the comp, not the base. Only a trailing
 *  " <token>" that exactly matches one of those component letters is
 *  stripped; a base like "15 Mon" or "HIP 22812" is untouched. */
export function stripDoubledParentToken(
  base: string,
  canonicalComp: string,
  primaryComp: string | null = null,
): string {
  for (const tok of [parentComponentToken(canonicalComp), primaryComp]) {
    if (!tok) continue;
    const suffix = ` ${tok}`;
    if (base.endsWith(suffix)) return base.slice(0, base.length - suffix.length);
  }
  return base;
}

function constellationCode(
  conIndex: number,
  constellations: { code: string; name: string }[],
): string | null {
  if (conIndex < 0 || conIndex >= constellations.length) return null;
  const entry = constellations[conIndex];
  return entry ? entry.code : null;
}

/** Extracts the WDS positional ID from a Stage 6 system_id. The system_id
 *  is `<wds_id>-<pair_components>` (e.g. `04153-0739-BC`), so the WDS
 *  root is everything before the last dash. Matches composeSyntheticId's
 *  split so both promotion and synthetic-ID paths see the same root. */
export function wdsRootOf(systemId: string): string | null {
  const dash = systemId.lastIndexOf('-');
  if (dash < 0) return null;
  const root = systemId.slice(0, dash);
  return root || null;
}

/** Index of single-character comp letters present in each WDS root.
 *  Both primary and secondary slots contribute. Used by
 *  isUnresolvedCompound to confirm a candidate compound's constituent
 *  letters actually appear as resolved components. */
function buildWdsRootSingleLetters(
  groups: Map<string, PairCursor>,
): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const [sysId, cursor] of groups) {
    const root = wdsRootOf(sysId);
    if (root === null) continue;
    let set = m.get(root);
    if (!set) {
      set = new Set<string>();
      m.set(root, set);
    }
    if (cursor.primary !== null && cursor.primary.comp.length === 1) {
      set.add(cursor.primary.comp);
    }
    for (const sec of cursor.secondaries) {
      if (sec.comp.length === 1) set.add(sec.comp);
    }
  }
  return m;
}

/** A comp letter is an "unresolved compound" — WDS shorthand for the
 *  combined light/position of two-or-more components treated as one
 *  source — when it spans 2+ characters AND every character appears as
 *  a single-letter comp on a sibling cursor in the same WDS root.
 *  Pure relational test: the constituent stars must be resolved
 *  elsewhere in the same WDS root for the compound to be confirmed.
 *  40 Eri's "BC" passes (B and C are resolved as primary of BC and
 *  secondary of BC/AC respectively); "Aa" / "Aa2" / "A1" / "A" all
 *  fail (their characters aren't single-letter component comps). */
export function isUnresolvedCompound(
  comp: string,
  wdsRoot: string,
  singleLettersByRoot: Map<string, Set<string>>,
): boolean {
  if (comp.length < 2) return false;
  const singleLetters = singleLettersByRoot.get(wdsRoot);
  if (!singleLetters) return false;
  for (let i = 0; i < comp.length; i++) {
    if (!singleLetters.has(comp[i])) return false;
  }
  return true;
}

/** True when a single-letter cursor-primary comp is DISJOINT from the
 *  anchor's comp token — not the same letter, not an ancestor/descendant,
 *  not contained in a compound anchor token. A disjoint letter resolving
 *  onto the anchor's record is a blended identifier, never a legitimate
 *  photocentre for that letter. */
export function isDisjointSingleLetter(
  comp: string,
  anchorComp: string,
): boolean {
  if (!/^[A-Z]$/.test(comp)) return false;
  const anchorLetters: string[] = anchorComp.match(/[A-Z]/g) ?? [];
  return !anchorLetters.includes(comp);
}

interface SystemAnchor {
  star: Star;
  primaryRow: MultiplesTsvRow;
  catalogIdx: number;
}

/** Pick the more-canonical of two pair primaries sharing a WDS root.
 *  Prefer comp="A" over "Aa" over "B" etc. — the system's canonical
 *  anchor is the row whose comp letter is shortest and alphabetically
 *  first. Used by buildWdsRootAnchors when several cursors map to one
 *  WDS root (40 Eri has A,BC / AC / BC / BD / BE rows all sharing
 *  `04153-0739`; we want A as the system anchor, not B). */
function isMoreCanonicalAnchor(
  candidateComp: string,
  incumbentComp: string,
): boolean {
  if (candidateComp === incumbentComp) return false;
  if (candidateComp === 'A' && incumbentComp !== 'A') return true;
  if (candidateComp !== 'A' && incumbentComp === 'A') return false;
  if (candidateComp.length !== incumbentComp.length) {
    return candidateComp.length < incumbentComp.length;
  }
  return candidateComp < incumbentComp;
}

function buildWdsRootAnchors(
  groups: Map<string, PairCursor>,
  existing: ExistingIndexes,
  existingStars: Star[],
): Map<string, SystemAnchor> {
  const anchors = new Map<string, SystemAnchor>();
  for (const cursor of groups.values()) {
    if (cursor.primary === null) continue;
    const wdsRoot = wdsRootOf(cursor.primary.systemId);
    if (wdsRoot === null) continue;
    const idx = findExistingPrimary(cursor.primary, existing, existingStars);
    if (idx === null) continue;
    const candidate: SystemAnchor = {
      star: existingStars[idx],
      primaryRow: cursor.primary,
      catalogIdx: idx,
    };
    const incumbent = anchors.get(wdsRoot);
    if (!incumbent
        || isMoreCanonicalAnchor(cursor.primary.comp, incumbent.primaryRow.comp)) {
      anchors.set(wdsRoot, candidate);
    }
  }
  return anchors;
}

/** Per-row promotion shared by the secondary loop and the
 *  pair-row-primary escape. Both paths run the same identifier
 *  resolution, dedup, photometry, spectral, and naming pipeline; only
 *  the position and anchor sources differ between callers.
 *  Returns the absolute catalog index of the new record, or null when
 *  any gate (dedup, missing position/absmag/identifier) drops the row.
 *  Increments the matching stats counter on each drop. */
interface PromoteRowContext {
  row: MultiplesTsvRow;
  /** Multiples row of the anchor primary — drives composeCompanionName's
   *  primary-row-name fallback and the inherited-HIP gate. For the
   *  secondary loop this is cursor.primary; for the pair-row-primary
   *  escape this is the WDS-root system anchor's primary row. */
  anchorPrimaryRow: MultiplesTsvRow;
  /** Catalog Star of the anchor primary — drives composeCompanionName's
   *  Bayer/Flamsteed/constellation fallback and the inherited-HIP gate. */
  anchorStar: Star | null;
  /** Catalog Star of the WDS-root system primary — the naming fallback
   *  when the local anchor is nameless/unresolved (δ Vel CD's local
   *  primary C never promotes, so D's name climbs to the system primary
   *  A = "Alsephina" → "Alsephina D" rather than Unnamed). */
  systemAnchorStar: Star | null;
  /** Catalog index of the anchor primary — used by the inherited-HIP
   *  collision escape so the row's HIP-match-against-anchor doesn't
   *  classify as alreadyInCatalog. */
  anchorCatalogIdx: number | null;
  /** Pre-computed position for the row. Caller is responsible for
   *  resolving it (resolvePosition for secondaries; collocate-on-anchor
   *  for pair-row primaries). Null signals the position couldn't be
   *  resolved — drop with droppedNoPosition. */
  position: CompanionPlacement | null;
  /** Canonical comp letter for the row — drives both the synthetic ID
   *  and the display name. */
  canonicalComp: string;
  /** True when this row is a pair-row-primary escape (the cursor primary
   *  itself, promoted as a companion of the WDS-root anchor); drives
   *  anchorDmagApplies=false in imputeCompanionAbsmag. */
  isPairRowPrimary: boolean;
}

interface PromotionState {
  existing: ExistingIndexes;
  existingStars: Star[];
  existingStarsLength: number;
  newStars: Star[];
  promotedByGaia: Map<string, number>;
  promotedByHip: Map<number, number>;
  promotedBySynth: Map<string, number>;
  /** Records whose absmag came from a component's own Gaia photometry
   *  (`gaia_photometry`), keyed by the BACKING source_id (`row.gaiaSourceId`
   *  before any inherited-id strip). A source backing ≥2 of these is an
   *  unresolved blend whose combined light the post-pass splits — see
   *  `blendSplitRecords`. */
  gaiaPhotometryByBackingSource: Map<string, BlendSplitCandidate[]>;
  /** Anchor-dimming candidates for the flux-conservation post-pass —
   *  see `blendDimmedAnchors`. */
  anchorDimCandidates: AnchorDimCandidate[];
}

interface AnchorDimCandidate {
  anchorIdx: number;
  member: Star;
  memberSpectral: SpectralInfo;
  source: 'wds_mag' | 'dmag_imputed';
  dmag: number | null;
}

interface BlendSplitCandidate {
  star: Star;
  spectral: SpectralInfo;
}

function promoteRow(
  ctx: PromoteRowContext,
  state: PromotionState,
  constellations: { code: string; name: string }[],
  stats: PromotionStats,
  dustGrid: DustGrid | null,
): number | null {
  const { row, anchorPrimaryRow, anchorStar, systemAnchorStar, anchorCatalogIdx,
          position, canonicalComp, isPairRowPrimary } = ctx;
  const synthId = composeSyntheticId(row.systemId, canonicalComp);
  const rowHasOwnHip = row.hip !== null && row.hip > 0;
  if (row.gaiaSourceId === null && !rowHasOwnHip && synthId === null) {
    stats.droppedNoIdentifier++;
    return null;
  }
  // Gaia inheritance gate. Gaia resolves only the blended photocentre
  // of sub-arcsec pairs, so Stage 2/3 bind the SAME source_id to both
  // component rows (2090 tight pairs). Like the inherited HIP below,
  // the companion must not adopt it — every gaia-keyed lookup would
  // collapse onto the primary — so it strips to null and the
  // identifier falls through to hip/synth. The anchor-STAR check
  // mirrors the HIP gate's: propagation can bind the shared source to
  // this row while the anchor's own row cell is empty (HIP-only), yet
  // the anchor record already owns that source in every byGaia lookup.
  const inheritedGaia = row.gaiaSourceId !== null
    && (anchorPrimaryRow.gaiaSourceId === row.gaiaSourceId
      || (anchorStar !== null && anchorStar.gaiaSourceId === row.gaiaSourceId));
  const companionGaia = inheritedGaia ? null : row.gaiaSourceId;
  // Dedup against existing catalog + previously-promoted records.
  // The inherited-HIP/Gaia escapes let a secondary match the ANCHOR's
  // record without being classified as alreadyInCatalog (Sirius A+B
  // both list HIP 32349; HD 209942 Aa+Ab share one Gaia source —
  // the catalogue resolved them as one star).
  let existingIdx: number | null = null;
  let inheritedIdCollision = false;
  if (row.gaiaSourceId !== null || rowHasOwnHip) {
    existingIdx = findExisting(row, state.existing);
    inheritedIdCollision =
      existingIdx !== null
      && (row.gaiaSourceId === null || inheritedGaia)
      && anchorCatalogIdx !== null
      && existingIdx === anchorCatalogIdx;
    if (existingIdx !== null && !inheritedIdCollision) {
      stats.alreadyInCatalog++;
      return null;
    }
    // A row whose own gaia missed the index can still BE an existing
    // AT-HYG record: the G−V magnitude gate scrubs a source from the
    // record while multiples.tsv keeps it on the component row
    // (SIMBAD xid). When the row's HIP names an existing NON-anchor
    // record, that record is this component — minting a twin would
    // collide on the HIP (URL focus lands on the wrong star). A hit
    // EQUAL to the anchor keeps the Sirius-B shape promoting: the
    // shared system HIP belongs to the anchor, not the companion.
    if (existingIdx === null && row.gaiaSourceId !== null && rowHasOwnHip) {
      const hipHit = state.existing.byHip.get(row.hip as number);
      if (hipHit !== undefined && hipHit !== anchorCatalogIdx) {
        stats.alreadyInCatalog++;
        return null;
      }
    }
  }
  if (companionGaia && state.promotedByGaia.has(companionGaia)) {
    stats.alreadyInCatalog++;
    return null;
  }
  if (rowHasOwnHip && companionGaia === null
      && state.promotedByHip.has(row.hip as number)) {
    stats.alreadyInCatalog++;
    return null;
  }

  // HIP inheritance gate. The multiples.tsv carries the primary's
  // HIP on both component rows when AT-HYG had a single entry for
  // the system (Sirius A and B both list HIP 32349). Letting the
  // companion adopt that HIP collides with the primary in every
  // HIP-keyed lookup: url-state's refFromIndex encodes by HIP and
  // decodes first-wins, so a shared link or page reload collapses
  // both records onto the primary. Strip when the row's HIP equals
  // the anchor row's HIP — or the anchor catalog STAR's: SIMBAD's
  // cross-IDs can bind the system HIP to the secondary letter while
  // the primary row's hip cell is empty, yet the blended AT-HYG
  // record already owns that HIP in every byHip lookup.
  const inheritedHip = row.hip !== null && row.hip > 0
    && (anchorPrimaryRow.hip === row.hip
      || (anchorStar !== null && anchorStar.hip === row.hip));
  const companionHip = inheritedHip ? null : row.hip;
  const usesSynth = companionGaia === null && companionHip === null;
  if (usesSynth) {
    if (synthId === null) {
      stats.droppedNoIdentifier++;
      return null;
    }
    if (state.promotedBySynth.has(synthId)) {
      stats.alreadyInCatalog++;
      return null;
    }
  }
  if (position === null) {
    stats.droppedNoPosition++;
    return null;
  }
  let spectral = resolveCompanionSpectral(row);
  const idsInheritedFromAnchor = usesSynth && (inheritedGaia || inheritedHip);
  const imputed = imputeCompanionAbsmag(
    row, anchorPrimaryRow, spectral.info, !isPairRowPrimary,
    isPairRowPrimary && idsInheritedFromAnchor,
  );
  if (imputed === null) {
    stats.droppedNoAbsmag++;
    return null;
  }
  let absmag = imputed.absmag;
  if (imputed.source === 'spectral') stats.absmagSpectralDerived++;
  if (imputed.source === 'wds_mag') stats.absmagWdsMagDerived++;
  if (imputed.source === 'anchor_collocated') stats.absmagAnchorCollocated++;
  if (imputed.source === 'inherited_twin') stats.absmagInheritedTwinOrbital++;
  // Build-time de-extinction along the companion's sightline. A
  // spectral-derived absmag (class→M_V) is already intrinsic, so leave
  // it; observed-photometry absmag (dmag-imputed / own / inherited-twin)
  // embeds A_V and gets it subtracted so the runtime raymarch re-adds it
  // without double-counting. Runs before the MS re-derivation below,
  // whose MV_MS_TABLE calibration is intrinsic M_V.
  const av = dustGrid
    ? avSolToStar(dustGrid, position.x, position.y, position.z) : 0;
  if (imputed.source !== 'spectral') absmag -= av;
  if (!PER_COMPONENT_SPECT_VIA.has(row.spectVia)
      && OWN_BRIGHTNESS_ABSMAG_SOURCES.has(imputed.source)) {
    spectral = { info: spectralFromAbsmag(absmag), display: null };
    stats.spectMsFromOwnAbsmag++;
  }
  let ci = imputeCompanionCi(row, spectral.info);
  // The row's own observed ci embeds A_V too; a derived ci (Ballesteros /
  // solar fallback) is already intrinsic.
  if (companionCiIsObserved(row)) ci -= av / R_V;
  const properName = composeCompanionName(
    row, anchorPrimaryRow, canonicalComp, anchorStar, constellations,
    systemAnchorStar,
  );
  // Space-motion velocity: inherit the anchor primary's. A promoted
  // companion carries no own PM (multiples.tsv has no PM columns), and a
  // Tier-3 static companion is baked into catalog.bin and SKIPPED by the
  // runtime BinaryOrbitField — only a shared velocity keeps it glued to
  // the primary through the epoch-advance pass instead of shearing away.
  // The systemic-velocity pass below reconciles the anchor's own velocity
  // for renderable-orbit pairs. Anchor-less escapes fall back to zero.
  const anchorVel = anchorStar
    ? { x: anchorStar.vx, y: anchorStar.vy, z: anchorStar.vz }
    : { x: 0, y: 0, z: 0 };
  // Collocated AT-HYG double-entry merge. AT-HYG occasionally carries
  // BOTH members of a resolved pair at the same printed blend
  // coordinates (ξ UMa: "Alula Australis" + "Alula Australis B" are
  // bit-identical). The companion being promoted here IS that second
  // record — same composed name, sitting exactly on the anchor — so
  // minting a new star would render the pair twice: once collocated
  // with the primary, once at the projected separation. Reposition
  // the existing record instead, and backfill the row's Gaia id so
  // the runtime binaries resolver can address it.
  if (properName !== null && anchorStar !== null && anchorCatalogIdx !== null) {
    const dupIdx = state.existing.byProper.get(properName);
    if (dupIdx !== undefined && dupIdx !== anchorCatalogIdx) {
      const dup = state.existingStars[dupIdx];
      if (dup.x === anchorStar.x && dup.y === anchorStar.y
          && dup.z === anchorStar.z) {
        dup.x = position.x;
        dup.y = position.y;
        dup.z = position.z;
        dup.vx = anchorVel.x;
        dup.vy = anchorVel.y;
        dup.vz = anchorVel.z;
        if (dup.gaiaSourceId === null && companionGaia !== null) {
          dup.gaiaSourceId = companionGaia;
        }
        if (companionGaia) state.promotedByGaia.set(companionGaia, dupIdx);
        if (companionHip !== null) state.promotedByHip.set(companionHip, dupIdx);
        stats.repositionedCollocatedDouble++;
        return dupIdx;
      }
    }
  }
  let flags = FLAG_BINARY_COMPANION_ONLY;
  if (properName) flags |= FLAG_HAS_NAME;
  if (usesSynth) flags |= FLAG_BINARY_COMPANION_SYNTHETIC;

  state.newStars.push({
    x: position.x, y: position.y, z: position.z,
    vx: anchorVel.x, vy: anchorVel.y, vz: anchorVel.z,
    absmag, ci,
    spectClass: spectral.info.classIdx,
    lumClass: spectral.info.lumClass,
    physicalRadius: physicalRadius(absmag, spectral.info),
    conIndex: NO_CONSTELLATION_INDEX,
    flags,
    proper: properName,
    bayer: null,
    hip: companionHip,
    hd: null,
    hr: null,
    flam: null,
    gl: null,
    gaiaSourceId: companionGaia,
    spectDisplay: spectral.display,
    companionIdx: -1,
    periodDays: 0,
    amplitudeMag: 0,
    varType: 0,
    gcvsName: null,
    athygDist: null,
    athygDistSrc: null,
    syntheticId: usesSynth ? synthId : null,
  });
  const newIdx = state.existingStarsLength + state.newStars.length - 1;
  stats.promoted++;
  // Flux conservation: a member whose light is embedded in the
  // anchor's athyg_own BLEND magnitude must dim the anchor or the
  // system double-counts it. Blend membership is structural for
  // inherited-then-stripped ids; for a member with its own real
  // identifier anchorMagIsPairBlend decides; identifier-less synth
  // members never qualify here (multi-member blends misattribute
  // pairwise — see README § Anchor flux conservation). Deferred to a
  // post-pass (an anchor can be dimmed by several members
  // sequentially).
  const dimEligible = idsInheritedFromAnchor
    ? imputed.source === 'wds_mag' || imputed.source === 'dmag_imputed'
    : !usesSynth && imputed.source === 'dmag_imputed'
      && anchorStar !== null && anchorMagIsPairBlend(anchorStar, row, av);
  if (dimEligible
      && anchorPrimaryRow.photometryVia === PHOTOMETRY_VIA_OWN
      && anchorCatalogIdx !== null) {
    state.anchorDimCandidates.push({
      anchorIdx: anchorCatalogIdx,
      member: state.newStars[state.newStars.length - 1],
      memberSpectral: spectral.info,
      source: imputed.source as 'wds_mag' | 'dmag_imputed',
      dmag: row.dmag,
    });
  }
  // A gaia_photometry absmag is the backing source's magnitude. When that
  // source is an unresolved blend shared by ≥2 records, it's the pair's
  // COMBINED light; register the record under the backing source so the
  // post-pass can split it. Keyed on row.gaiaSourceId (pre-strip) so an
  // inherited-Gaia secondary (companionGaia=null → synth) still groups
  // with its blend partner.
  if (imputed.source === 'own' && row.photometryVia === PHOTOMETRY_VIA_GAIA
      && row.gaiaSourceId !== null) {
    const bucket = state.gaiaPhotometryByBackingSource.get(row.gaiaSourceId);
    const cand: BlendSplitCandidate = {
      star: state.newStars[state.newStars.length - 1],
      spectral: spectral.info,
    };
    if (bucket) bucket.push(cand);
    else state.gaiaPhotometryByBackingSource.set(row.gaiaSourceId, [cand]);
  }
  if (usesSynth) {
    stats.promotedSynthetic++;
    state.promotedBySynth.set(synthId as string, newIdx);
  }
  if (companionGaia) state.promotedByGaia.set(companionGaia, newIdx);
  if (companionHip !== null) state.promotedByHip.set(companionHip, newIdx);
  return newIdx;
}

/** Backfill HIP + Gaia source_id onto identifier-less catalog primaries
 *  from multiples.tsv pair-primary rows, joined by HD — never by
 *  position (the nearest-position record to ξ UMa A is ξ UMa B's, so a
 *  position join stamps A's identifiers onto B). AT-HYG rows for some
 *  WDS systems carry only HD; Stage 2 resolves their HIP (ORB6) and
 *  Gaia source_id (SIMBAD xids) into multiples.tsv, and this pass is
 *  what surfaces those onto the catalog record so HIP / Gaia lookups
 *  (URL refs, Tier A) can address it. Guards: the HD must resolve to
 *  exactly one catalog record, that record must carry no identifier of
 *  its own, and an id already present on another record is never
 *  duplicated. Returns the number of records backfilled. */
export function backfillPrimaryIdentifiers(
  multiplesRows: MultiplesTsvRow[],
  stars: Star[],
): number {
  const byHd = new Map<number, number[]>();
  const hipsInCatalog = new Set<number>();
  const gaiaInCatalog = new Set<string>();
  for (let i = 0; i < stars.length; i++) {
    const s = stars[i];
    if (s.hd !== null) {
      const bucket = byHd.get(s.hd);
      if (bucket) bucket.push(i);
      else byHd.set(s.hd, [i]);
    }
    if (s.hip !== null) hipsInCatalog.add(s.hip);
    if (s.gaiaSourceId !== null) gaiaInCatalog.add(s.gaiaSourceId);
  }

  let backfilled = 0;
  for (const row of multiplesRows) {
    if (row.orbitRole !== 'primary' || row.hd === null) continue;
    if (row.hip === null && row.gaiaSourceId === null) continue;
    const candidates = byHd.get(row.hd);
    if (candidates === undefined || candidates.length !== 1) continue;
    const star = stars[candidates[0]];
    if (star.hip !== null || star.gaiaSourceId !== null) continue;
    let wrote = false;
    if (row.hip !== null && !hipsInCatalog.has(row.hip)) {
      star.hip = row.hip;
      hipsInCatalog.add(row.hip);
      wrote = true;
    }
    if (row.gaiaSourceId !== null && !gaiaInCatalog.has(row.gaiaSourceId)) {
      star.gaiaSourceId = row.gaiaSourceId;
      gaiaInCatalog.add(row.gaiaSourceId);
      wrote = true;
    }
    if (wrote) backfilled++;
  }
  return backfilled;
}

export function promoteCompanions(
  multiplesRows: MultiplesTsvRow[],
  existingStars: Star[],
  constellations: { code: string; name: string }[],
  dustGrid: DustGrid | null = null,
): { newStars: Star[]; stats: PromotionStats; groups: Map<string, PairCursor> } {
  const stats = emptyPromotionStats();
  const existing = buildExistingIndexes(existingStars);
  const groups = groupBySystem(multiplesRows);
  const wdsRootAnchors = buildWdsRootAnchors(groups, existing, existingStars);
  const singleLettersByRoot = buildWdsRootSingleLetters(groups);
  const newStars: Star[] = [];
  // Track promotions by gaia + hip + synth so two pair rows in the same
  // system that reference the same record (Sirius A appears as primary
  // in 06451-1643-AB and would have been "primary" again if WDS broke
  // the same components into a sub-pair) don't get double-promoted.
  // Maps (not sets) so the cursor.primary lookup can find a previously-
  // promoted record (40 Eri B promoted in the BC group, then anchored
  // as a parent in the BD/BE groups).
  const state: PromotionState = {
    existing,
    existingStars,
    existingStarsLength: existingStars.length,
    newStars,
    promotedByGaia: new Map(),
    promotedByHip: new Map(),
    promotedBySynth: new Map(),
    gaiaPhotometryByBackingSource: new Map(),
    anchorDimCandidates: [],
  };
  const getStarAt = (idx: number): Star =>
    idx < existingStars.length
      ? existingStars[idx]
      : newStars[idx - existingStars.length];

  // (wds_root, canonical component) → catalog index, accumulated as pairs
  // resolve. The post-pass reads it to find an inner pair's parent
  // component when that parent is a distinctly-resolved star rather than a
  // synth record (a sibling can share a HIP yet split under Gaia — the
  // parent then has its own Gaia row, not a synth key).
  const componentIndex = new Map<string, number>();
  const compKey = (root: string | null, comp: string): string | null =>
    root !== null && comp ? `${root} ${comp}` : null;

  // Renderable-orbit (Tier 1/2) pairs grouped by WDS root, for the
  // systemic-velocity reconciliation post-pass. Members of a bound system
  // share one systemic velocity so the runtime epoch-advance never shears
  // a pair; orbital motion stays owned by BinaryOrbitField's elements-alone
  // walk. See SCIENCE.md § Current-epoch star positions (Composition with
  // binary orbital motion).
  interface SystemicGroup {
    anchorIdx: number | null;
    pairs: { pIdx: number; sIdx: number; q: number | null }[];
  }
  const systemicGroups = new Map<string, SystemicGroup>();
  const recordOrbitPair = (
    root: string, anchorIdx: number | null,
    pIdx: number, sIdx: number, q: number | null,
  ): void => {
    let g = systemicGroups.get(root);
    if (g === undefined) {
      g = { anchorIdx, pairs: [] };
      systemicGroups.set(root, g);
    }
    if (g.anchorIdx === null) g.anchorIdx = anchorIdx;
    g.pairs.push({ pIdx, sIdx, q });
  };

  for (const cursor of groups.values()) {
    // Standalone rows are augmentation entries that aren't sides of a WDS
    // pair; their primary slot is empty. Skip — promoting them without
    // pair geometry needs a different rule than this path.
    if (cursor.primary === null) continue;

    // Resolve the cursor primary's catalog row. Check existing AT-HYG
    // first, then previously-promoted records (40 Eri B class — promoted
    // in BC, then reused as anchor for BD).
    let primaryCatalogIdx = findExistingPrimary(cursor.primary, existing, existingStars);
    const rootAnchorEntry = wdsRootOf(cursor.primary.systemId) !== null
      ? wdsRootAnchors.get(wdsRootOf(cursor.primary.systemId) as string)
      : undefined;
    if (
      primaryCatalogIdx !== null && rootAnchorEntry !== undefined
      && primaryCatalogIdx === rootAnchorEntry.catalogIdx
      && cursor.primary !== rootAnchorEntry.primaryRow
      && isDisjointSingleLetter(
        cursor.primary.comp, rootAnchorEntry.primaryRow.comp,
      )
    ) {
      // Blended-identifier escape: the id landed on the WDS-root anchor's
      // record, but a disjoint top-level letter cannot BE the anchor
      // (Acrux B carries A's shared HIP; omicron And B carries A's
      // source). Its true slot is its own record — the one a sibling
      // cursor already minted, or a fresh pair-row-primary promotion.
      // When neither yields an honest placement, fall back to the anchor
      // hit so the cursor still runs against the blend record as before.
      // Sub-letter primaries (Castor Ca) are excluded: the inner-pair
      // post-pass + writer parent override own that re-homing.
      const synthKey = composeSyntheticId(
        cursor.primary.systemId, cursor.primary.comp,
      );
      const escaped =
        (synthKey !== null ? state.promotedBySynth.get(synthKey) : undefined)
        ?? tryPromoteCursorPrimary(
          cursor, wdsRootAnchors, state, constellations, stats, dustGrid,
        );
      if (escaped !== null && escaped !== undefined) {
        primaryCatalogIdx = escaped;
      }
    }
    if (primaryCatalogIdx === null) {
      primaryCatalogIdx = lookupPromoted(cursor.primary, state);
    }
    if (primaryCatalogIdx === null) {
      // Cursor primary isn't in catalog and hasn't been promoted yet.
      // Pair-row-primary escape: promote it as a companion of the
      // WDS-root system anchor (40 Eri B is the canonical case — it
      // appears as a primary in BC/BD/BE groups but never as a
      // secondary of A, so the existing secondary loop never
      // reached it).
      primaryCatalogIdx = tryPromoteCursorPrimary(
        cursor, wdsRootAnchors, state, constellations, stats, dustGrid,
      );
    }
    const anchor: ProjectionAnchor | null = primaryCatalogIdx !== null
      ? {
          x: getStarAt(primaryCatalogIdx).x,
          y: getStarAt(primaryCatalogIdx).y,
          z: getStarAt(primaryCatalogIdx).z,
        }
      : null;
    const anchorStar = primaryCatalogIdx !== null
      ? getStarAt(primaryCatalogIdx)
      : null;

    const cursorRoot = wdsRootOf(cursor.primary.systemId);
    const primaryKey = compKey(cursorRoot, cursor.primary.comp);
    // Don't let a blended primary (its id resolves onto a sibling)
    // overwrite a correct entry a prior pair recorded for this token.
    if (primaryKey !== null && primaryCatalogIdx !== null
        && !componentIndex.has(primaryKey)) {
      componentIndex.set(primaryKey, primaryCatalogIdx);
    }

    for (const row of cursor.secondaries) {
      if (row.orbitRole !== 'secondary') continue;
      stats.pairRowsScanned++;
      // WDS compound-secondary guard. "BC" / "AB" / "ABC" represent
      // unresolved aggregates of two-or-more components, not single
      // stars; promoting them would double-count the resolved
      // sibling-cursor records (40 Eri's "Keid BC" alongside
      // "Keid B" + "Keid C"). Confirmed via the sibling-cursor
      // relational test, not a string heuristic.
      const wdsRoot = wdsRootOf(row.systemId);
      if (wdsRoot !== null
          && isUnresolvedCompound(row.comp, wdsRoot, singleLettersByRoot)) {
        stats.droppedCompoundComp++;
        continue;
      }
      const canonicalComp = canonicalCompLetter(
        cursor.primary?.comp ?? '', row.comp,
      );
      const resolved = resolvePosition(row, cursor.primary, anchor);
      if (resolved === 'beyond-tidal') {
        stats.droppedBeyondTidalLimit++;
        continue;
      }
      const position = resolved;
      const promotedIdx = promoteRow(
        {
          row,
          anchorPrimaryRow: cursor.primary,
          anchorStar,
          systemAnchorStar: cursorRoot !== null
            ? wdsRootAnchors.get(cursorRoot)?.star ?? null
            : null,
          anchorCatalogIdx: primaryCatalogIdx,
          position,
          canonicalComp,
          isPairRowPrimary: false,
        },
        state, constellations, stats, dustGrid,
      );
      // A promoted secondary is authoritative for its token — it resolves
      // through the inherited-id escape onto its own record, so it
      // overwrites any blended-primary entry a sibling pair left behind.
      const secKey = compKey(wdsRoot, canonicalComp);
      if (secKey !== null && promotedIdx !== null) {
        componentIndex.set(secKey, promotedIdx);
      }
      // Record renderable-orbit pairs for systemic-velocity reconciliation.
      // The secondary's catalog record is its freshly-promoted index, or —
      // when it was already a first-class AT-HYG row (alreadyInCatalog: α Cen
      // B, 61 Cyg B) — its own-identifier existing index. Its own id keys
      // findExisting cleanly here (the shared-primary-id collision only
      // arises for inherited ids, which route to promotion, not this
      // branch).
      if (hasRenderableOrbit(row) && primaryCatalogIdx !== null) {
        const secIdx = promotedIdx
          ?? (row.gaiaSourceId !== null || (row.hip !== null && row.hip > 0)
            ? findExisting(row, existing) : null);
        if (secIdx !== null && secIdx !== primaryCatalogIdx) {
          const root = wdsRoot ?? row.systemId;
          const anchorIdx = (root !== null
            ? wdsRootAnchors.get(root)?.catalogIdx ?? null : null)
            ?? primaryCatalogIdx;
          recordOrbitPair(root, anchorIdx, primaryCatalogIdx, secIdx, row.q);
        }
      }
    }
  }

  // Post-pass: re-place inner-pair secondaries relative to their TRUE
  // parent component. A cursor primary that is a sub-component (Castor Ba)
  // carries the system's blended identifier — a shared Gaia source or a
  // shared HIP that Gaia later split — so it resolved onto a sibling
  // (Castor A) and resolvePosition anchored the secondary there. Now every
  // component is resolved; re-run the placement against the parent's slot
  // so the catalog matches the binaries.bin pair anchor
  // (build-runtime-binaries.py's override_inner_primary_indices) — both the
  // ρ=0 collocation case and a measured sep+PA re-projection. Position
  // only — dedup/naming already resolved, and A_V de-extinction across the
  // sub-arcsec sibling offset is below the dust grid's resolution. Parent
  // resolves synth-first (the blended component's own promoted record),
  // then the per-system component map (a HIP-blended parent keeps its own
  // Gaia row, not a synth key).
  for (const cursor of groups.values()) {
    if (cursor.primary === null) continue;
    const parentTok = parentComponentToken(cursor.primary.comp);
    if (parentTok === null) continue;
    const parentSynth = composeSyntheticId(cursor.primary.systemId, parentTok);
    const parentIdx = (parentSynth !== null
      ? state.promotedBySynth.get(parentSynth)
      : undefined)
      ?? componentIndex.get(compKey(wdsRootOf(cursor.primary.systemId), parentTok) ?? '');
    if (parentIdx === undefined) continue;
    const parentStar = getStarAt(parentIdx);
    const parentAnchor: ProjectionAnchor = {
      x: parentStar.x, y: parentStar.y, z: parentStar.z,
    };
    for (const row of cursor.secondaries) {
      if (row.orbitRole !== 'secondary') continue;
      const secIdx = componentIndex.get(
        compKey(wdsRootOf(row.systemId),
          canonicalCompLetter(cursor.primary.comp, row.comp)) ?? '',
      );
      if (secIdx === undefined || secIdx === parentIdx) continue;
      const placed = resolvePosition(row, cursor.primary, parentAnchor);
      if (placed === null || placed === 'beyond-tidal') continue;
      const secStar = getStarAt(secIdx);
      if (secStar.x === placed.x && secStar.y === placed.y
          && secStar.z === placed.z) continue;
      secStar.x = placed.x;
      secStar.y = placed.y;
      secStar.z = placed.z;
      secStar.vx = parentStar.vx;
      secStar.vy = parentStar.vy;
      secStar.vz = parentStar.vz;
      stats.repositionedInnerToParent++;
    }
  }

  // Systemic-velocity reconciliation over the pairs THIS build resolves.
  // A bound pair's members share one systemic velocity; a lone pair takes
  // the barycentric blend v_sys = (1−q)·v_p + q·v_s (cancelling orbital
  // contamination in the per-member PMs to first order), and a WDS root with
  // ≥2 orbit pairs (a hierarchy sharing components across pairs) takes the
  // root anchor's velocity for every member. This plus the mint-time
  // inheritance above is the load-bearing guarantee: no promoted companion
  // freezes at v=0 while its primary drifts. FULL coherence for
  // binaries.bin's authoritative runtime pairing (which re-homes a handful
  // of inner pairs via override_inner_primary_indices, and owns Tier-3
  // static pairs the catalog build doesn't group) is deferred — and
  // harmless for v1 since Tier-1/2 offsets are elements-owned.
  for (const g of systemicGroups.values()) {
    if (g.pairs.length === 1) {
      const { pIdx, sIdx, q } = g.pairs[0];
      const p = getStarAt(pIdx);
      const s = getStarAt(sIdx);
      const w = Math.max(0, Math.min(1, q ?? 0.5));
      const vx = (1 - w) * p.vx + w * s.vx;
      const vy = (1 - w) * p.vy + w * s.vy;
      const vz = (1 - w) * p.vz + w * s.vz;
      p.vx = vx; p.vy = vy; p.vz = vz;
      s.vx = vx; s.vy = vy; s.vz = vz;
    } else {
      const anchorIdx = g.anchorIdx ?? g.pairs[0].pIdx;
      const a = getStarAt(anchorIdx);
      const av = { x: a.vx, y: a.vy, z: a.vz };
      for (const { pIdx, sIdx } of g.pairs) {
        for (const idx of [pIdx, sIdx]) {
          const star = getStarAt(idx);
          star.vx = av.x; star.vy = av.y; star.vz = av.z;
        }
      }
    }
  }

  // Blend-split post-pass. A Gaia source Gaia fit as ONE 5p solution over
  // a sub-arcsec pair (YY Gem Ca/Cb) surfaces as ≥2 collocated
  // gaia_photometry records here — one per component — each carrying the
  // source's COMBINED G→V magnitude, so the system renders ~2× too bright.
  // Divide the combined light evenly: each of N components is
  // 2.5·log10(N) fainter than the blend (equal split — the honest default
  // for a pair Gaia couldn't resolve, and exact for the near-equal pairs
  // that dominate; WDS Δmag is absent on these ρ=0 sub-pairs). ci is left
  // as the combined colour (near-equal blend ⇒ shared class). Runs before
  // build-catalog's absmag sort and re-derives radius off the split absmag.
  for (const bucket of state.gaiaPhotometryByBackingSource.values()) {
    if (bucket.length < 2) continue;
    const splitMag = 2.5 * Math.log10(bucket.length);
    for (const { star, spectral } of bucket) {
      star.absmag += splitMag;
      star.physicalRadius = physicalRadius(star.absmag, spectral);
      stats.blendSplitRecords++;
    }
  }

  // Anchor-dimming post-pass (flux conservation). Each candidate member's
  // light is embedded in its anchor's athyg_own blend magnitude; total
  // system flux must stay what AT-HYG measured. Two shapes:
  //
  // - dmag_imputed: the member's brightness came from the blend itself
  //   (M_blend + Δ — overbright, since Δ is relative to the PRIMARY, not
  //   the blend), so the pair is re-split jointly by Δmag:
  //   M_A = M_blend + 2.5·log₁₀(1 + 10^(−0.4Δ)), M_B = M_A + Δ. Exact
  //   flux conservation for any Δ; reduces to "anchor barely dims" for a
  //   faint companion (Sirius B shifts 10⁻⁴ mag) and to the equal split
  //   for Δ = 0. A naive flux subtraction here would gut a near-equal
  //   anchor (Capella: −0.51 → +2.1) because the member's error lands
  //   entirely on the anchor.
  // - wds_mag: the member's brightness is independent astrometry, so
  //   subtract its flux: M′ = −2.5·log₁₀(10^(−0.4·M_blend) −
  //   10^(−0.4·M_member)). The guard skips a member as bright as the
  //   blend itself (WDS mag inconsistent with the AT-HYG magnitude);
  //   those keep the anchor untouched and are counted for the ratchet.
  //
  // Sequential when several members share one anchor — each step
  // conserves the running total.
  for (const cand of state.anchorDimCandidates) {
    const anchor = getStarAt(cand.anchorIdx);
    if (cand.source === 'dmag_imputed' && cand.dmag !== null) {
      const lift = 2.5 * Math.log10(1 + Math.pow(10, -0.4 * cand.dmag));
      cand.member.absmag = anchor.absmag + cand.dmag + lift;
      cand.member.physicalRadius = physicalRadius(
        cand.member.absmag, cand.memberSpectral,
      );
      anchor.absmag += lift;
    } else {
      if (!(cand.member.absmag > anchor.absmag + ANCHOR_DIM_MIN_DELTA_MAG)) {
        stats.blendDimSkipped++;
        continue;
      }
      const residualFlux =
        Math.pow(10, -0.4 * anchor.absmag)
        - Math.pow(10, -0.4 * cand.member.absmag);
      anchor.absmag = -2.5 * Math.log10(residualFlux);
    }
    anchor.physicalRadius = physicalRadius(
      anchor.absmag, anchorSpectralInfo(anchor),
    );
    stats.blendDimmedAnchors++;
  }
  return { newStars, stats, groups };
}

function lookupPromoted(
  row: MultiplesTsvRow,
  state: PromotionState,
): number | null {
  if (row.gaiaSourceId) {
    const hit = state.promotedByGaia.get(row.gaiaSourceId);
    if (hit !== undefined) return hit;
  }
  if (row.hip !== null && row.hip > 0) {
    const hit = state.promotedByHip.get(row.hip);
    if (hit !== undefined) return hit;
  }
  return null;
}

function tryPromoteCursorPrimary(
  cursor: PairCursor,
  wdsRootAnchors: Map<string, SystemAnchor>,
  state: PromotionState,
  constellations: { code: string; name: string }[],
  stats: PromotionStats,
  dustGrid: DustGrid | null,
): number | null {
  const primary = cursor.primary;
  if (primary === null) return null;
  // Need own identifier (gaia or hip) to be addressable post-promotion.
  // 40 Eri B has gaia=3195919254111315712 but no HIP. An inherited id
  // qualifies too — promoteRow strips it and mints a synth slot.
  const hasOwnGaia = primary.gaiaSourceId !== null;
  const hasOwnHip = primary.hip !== null && primary.hip > 0;
  if (!hasOwnGaia && !hasOwnHip) return null;
  const wdsRoot = wdsRootOf(primary.systemId);
  if (wdsRoot === null) return null;
  const anchor = wdsRootAnchors.get(wdsRoot);
  if (!anchor) return null;
  if (anchor.primaryRow === primary) return null;  // would self-promote
  // Position. Preference order:
  //  1. The row's own per-component astrometry when Stage 3 supplied a
  //     real independent fit (own gaia_5p / hip2_long_baseline whose id
  //     differs from the anchor's).
  //  2. Project the row's Stage-6 anchor_sep/pa offset off the WDS-root
  //     anchor star — Acrux B lands 3.5″/114° off A (the Stage-5-rejected
  //     AB row's geometry); 40 Eri B lands at the A,BC compound proxy.
  // Neither available → drop. Collocating at the anchor would bake a
  // false coincident star inside the anchor's disc (Alsephina C): the
  // escape only fires for cursor primaries that never appear as a
  // secondary of the anchor, so no anchor→self orbital pair exists for
  // BinaryOrbitField to animate it away from centre at runtime.
  let position = resolveIndependentAstrometry(
    primary, anchor.primaryRow.gaiaSourceId, anchor.primaryRow.hip,
  );
  if (position === null
      && primary.anchorSepArcsec !== null && primary.anchorSepArcsec > 0
      && primary.anchorPaDeg !== null) {
    if (projectionBeyondTidalLimit(
      anchor.star.x, anchor.star.y, anchor.star.z, primary.anchorSepArcsec,
    )) {
      stats.droppedBeyondTidalLimit++;
      return null;
    }
    position = projectFromSepPa(
      anchor.star.x, anchor.star.y, anchor.star.z,
      primary.anchorSepArcsec, primary.anchorPaDeg,
    );
  }
  if (position === null) {
    stats.droppedCollocatedPrimary++;
    return null;
  }
  return promoteRow(
    {
      row: primary,
      anchorPrimaryRow: anchor.primaryRow,
      anchorStar: anchor.star,
      systemAnchorStar: anchor.star,
      anchorCatalogIdx: anchor.catalogIdx,
      position,
      canonicalComp: primary.comp,
      isPairRowPrimary: true,
    },
    state, constellations, stats, dustGrid,
  );
}

// ---- Component-letter stamping -----------------------------------------

export interface ComponentStampStats {
  /** Systems where ≥2 first-class AT-HYG records were stamped. */
  systemsStamped: number;
  /** Individual AT-HYG records given a composed component name. */
  rowsStamped: number;
}

/** Post-promotion pass for pairs AT-HYG left anonymous. When BOTH halves
 *  of a multiples.tsv pair already exist as first-class AT-HYG records
 *  AND none carries a proper name, they render with identical
 *  Bayer/Flamsteed labels and are individually unsearchable (61 Cyg A /
 *  61 Cyg B both print "61 Cyg"). Stamp each such record's `proper` with
 *  the shared name base (resolveCompanionNameBase) + its comp letter.
 *  Skips systems where any resolved component already has a proper (don't
 *  overwrite Sirius A → "Sirius A"), where the primary yields no usable
 *  base, or where fewer than two DISTINCT first-class records resolve — a
 *  blended single entry (both rows sharing one identifier) is one star,
 *  not two components. Mutates `stars` in place, so it must run before the
 *  name-table / search-index write. */
export function stampComponentLetters(
  groups: Map<string, PairCursor>,
  stars: Star[],
  constellations: { code: string; name: string }[],
): ComponentStampStats {
  const stats: ComponentStampStats = { systemsStamped: 0, rowsStamped: 0 };
  const existing = buildExistingIndexes(stars);
  for (const cursor of groups.values()) {
    const primaryRow = cursor.primary;
    if (primaryRow === null) continue;
    const primaryIdx = findExistingPrimary(primaryRow, existing, stars);
    if (primaryIdx === null) continue;
    // Distinct first-class (non-promoted) AT-HYG records, one per resolved
    // component. A secondary that shares the primary's identifier resolves
    // back to the primary's record (AT-HYG carries the pair as one blended
    // entry); dedup by index so it collapses to one and the length gate
    // below drops the system rather than stamping the blend as its faint
    // secondary. Promoted companions already carry composed names — exclude.
    const seen = new Set<number>();
    const resolved: { idx: number; comp: string }[] = [];
    const add = (idx: number, comp: string) => {
      if (seen.has(idx)) return;
      seen.add(idx);
      resolved.push({ idx, comp });
    };
    add(primaryIdx, primaryRow.comp);
    for (const sec of cursor.secondaries) {
      if (sec.orbitRole !== 'secondary') continue;
      const idx = findExisting(sec, existing);
      if (idx === null) continue;
      if ((stars[idx].flags & FLAG_BINARY_COMPANION_ONLY) !== 0) continue;
      add(idx, canonicalCompLetter(primaryRow.comp, sec.comp));
    }
    if (resolved.length < 2) continue;
    if (resolved.some((r) => stars[r.idx].proper)) continue;
    const base = resolveCompanionNameBase(
      primaryRow, primaryRow, stars[primaryIdx], constellations,
    );
    if (base === null) continue;
    for (const r of resolved) {
      const s = stars[r.idx];
      s.proper = joinComponentName(base, r.comp);
      s.flags |= FLAG_HAS_NAME;
      stats.rowsStamped++;
    }
    stats.systemsStamped++;
  }
  return stats;
}

// ---- Catalog row-index map sidecar -------------------------------------

export interface CatalogRowIndexMap {
  /** Gaia DR3 source_id (decimal string) → catalog.bin record index. */
  byGaia: Record<string, number>;
  /** Hipparcos catalog number → catalog.bin record index. */
  byHip: Record<string, number>;
  /** Synthetic identifier → catalog.bin record index. See
   *  scripts/catalog/README.md § Companion promotion. */
  bySynth: Record<string, number>;
}

// Build the lookup sidecar after the final absmag sort. The runtime
// binaries loader resolves multiples.tsv rows to catalog.bin records
// through this map; the build script writes it next to catalog.bin /
// search-index.json.
export function buildCatalogRowIndexMap(stars: Star[]): CatalogRowIndexMap {
  const byGaia: Record<string, number> = {};
  const byHip: Record<string, number> = {};
  const bySynth: Record<string, number> = {};
  for (let i = 0; i < stars.length; i++) {
    const s = stars[i];
    if (s.gaiaSourceId && !(s.gaiaSourceId in byGaia)) {
      byGaia[s.gaiaSourceId] = i;
    }
    if (s.hip !== null && s.hip > 0 && !(`${s.hip}` in byHip)) {
      byHip[`${s.hip}`] = i;
    }
    if (s.syntheticId && !(s.syntheticId in bySynth)) {
      bySynth[s.syntheticId] = i;
    }
  }
  return { byGaia, byHip, bySynth };
}

// ---- Wings for renderable-companion primaries --------------------------

/** gaia → hip → synth catalog-row resolution — the TS twin of
 *  build-runtime-binaries.py's `resolve_idx`. Kept faithful so the winged
 *  set matches binaries.bin's rendered pairs; the invariant is pinned by
 *  multi-star-regression.test.ts against the real artifacts. */
function resolveMultiplesIdx(
  gaia: string | null,
  hip: number | null,
  synthKey: string | null,
  rowIndexMap: CatalogRowIndexMap,
): number | null {
  if (gaia) {
    const hit = rowIndexMap.byGaia[gaia];
    if (hit !== undefined) return hit;
  }
  if (hip !== null && hip > 0) {
    const hit = rowIndexMap.byHip[`${hip}`];
    if (hit !== undefined) return hit;
  }
  if (synthKey !== null) {
    const hit = rowIndexMap.bySynth[synthKey];
    if (hit !== undefined) return hit;
  }
  return null;
}

/** The catalog row a component's synth key addresses, or null when no synth
 *  record exists or it aliases `exclude`. TS twin of the Python `synth_slot`;
 *  a hit is the truer slot than an id-first resolve that blended onto a
 *  system anchor. */
function synthSlotIdx(
  synthKey: string | null,
  rowIndexMap: CatalogRowIndexMap,
  exclude: number | null = null,
): number | null {
  if (synthKey === null) return null;
  const hit = rowIndexMap.bySynth[synthKey];
  return hit === undefined || hit === exclude ? null : hit;
}

interface ResolvedComponent {
  idx: number;
  /** Canonical WDS component letter (`canonicalCompLetter` applied). */
  comp: string;
}

interface ResolvedSystem {
  systemId: string;
  primaryIdx: number;
  /** The primary (its own comp letter) followed by every secondary that
   *  resolves to a record distinct from the primary. */
  components: ResolvedComponent[];
}

/** Resolve a pair cursor's primary + secondaries to catalog record indices
 *  through the gaia → hip → synth priority + both-ends synth re-home that
 *  build-runtime-binaries.py's `resolve_idx` uses, so both consumers below
 *  (wings, component designations) track binaries.bin's rendered pairs. A
 *  blended component (its id resolves onto another member's row) has its own
 *  distinct synth slot minted by promotion, and that slot is the truer end.
 *  Null when the primary itself doesn't resolve. */
function resolvePairComponents(
  cursor: PairCursor,
  rowIndexMap: CatalogRowIndexMap,
): ResolvedSystem | null {
  const primary = cursor.primary;
  if (primary === null) return null;
  const primarySynth = composeSyntheticId(primary.systemId, primary.comp);
  const priId = resolveMultiplesIdx(
    primary.gaiaSourceId, primary.hip, primarySynth, rowIndexMap,
  );
  if (priId === null) return null;
  const primaryIdx = synthSlotIdx(primarySynth, rowIndexMap, priId) ?? priId;
  const components: ResolvedComponent[] = [{ idx: primaryIdx, comp: primary.comp }];
  for (const sec of cursor.secondaries) {
    if (sec.orbitRole !== 'secondary') continue;
    const comp = canonicalCompLetter(primary.comp, sec.comp);
    const secondarySynth = composeSyntheticId(sec.systemId, comp);
    let secIdx = resolveMultiplesIdx(
      sec.gaiaSourceId, sec.hip, secondarySynth, rowIndexMap,
    );
    if (secIdx !== null) {
      secIdx = synthSlotIdx(secondarySynth, rowIndexMap, secIdx) ?? secIdx;
    }
    if (secIdx === null || secIdx === primaryIdx) continue;
    components.push({ idx: secIdx, comp });
  }
  return { systemId: primary.systemId, primaryIdx, components };
}

/** OR FLAG_BINARY_PRIMARY (chart-mode wings) onto the anchor of every
 *  physical system that renders a companion but which build-catalog's three
 *  wings passes (geometric, CCDM, eclipsing) all missed (Canopus, 16 Cyg A).
 *  A pair renders a companion when its sides resolve to DISTINCT catalog
 *  records under the same `resolve_idx` + blended-sibling synth retries
 *  build-runtime-binaries.py runs to emit binaries.bin, so the winged set
 *  tracks binaries.bin's primaries (both retries mirrored; the writer's
 *  post-resolution override / relation dedup can't change the distinct-pair
 *  boolean this pass keys on, only which index, which root-grouping and the
 *  brightest-participant pick below already absorb). Invariants: one glyph
 *  per WDS system, on the brightest participant (skips a system any earlier
 *  pass already flagged); additive only, so eclipsing / iconic doubles with
 *  no rendered companion keep their wings. Returns the count newly winged.
 *  See scripts/catalog/README.md § Renderable-companion wings. */
export function wingRenderablePrimaries(
  rows: MultiplesTsvRow[],
  stars: Star[],
  rowIndexMap: CatalogRowIndexMap,
): number {
  // Catalog indices participating in a rendered pair, grouped by WDS root.
  const perSystem = new Map<string, Set<number>>();
  for (const cursor of groupBySystem(rows).values()) {
    const resolved = resolvePairComponents(cursor, rowIndexMap);
    if (resolved === null) continue;
    const root = wdsRootOf(resolved.systemId);
    if (root === null) continue;
    const secIdxs = resolved.components
      .filter((c) => c.idx !== resolved.primaryIdx)
      .map((c) => c.idx);
    if (secIdxs.length === 0) continue;
    let set = perSystem.get(root);
    if (!set) { set = new Set(); perSystem.set(root, set); }
    set.add(resolved.primaryIdx);
    for (const idx of secIdxs) set.add(idx);
  }

  let winged = 0;
  for (const indices of perSystem.values()) {
    let anchor = -1;
    let alreadyWinged = false;
    for (const idx of indices) {
      if ((stars[idx].flags & FLAG_BINARY_PRIMARY) !== 0) {
        alreadyWinged = true;
        break;
      }
      if (anchor < 0 || stars[idx].absmag < stars[anchor].absmag) anchor = idx;
    }
    if (alreadyWinged || anchor < 0) continue;
    stars[anchor].flags |= FLAG_BINARY_PRIMARY;
    winged++;
  }
  return winged;
}

// ---- Component-letter search designations ------------------------------

export interface ComponentDesignation {
  /** Canonical WDS component letter, e.g. "A", "B", "C", "Ab". */
  comp: string;
  /** Catalog record index of the system primary. The runtime search index
   *  expands "<primary designation> <comp>" (Bayer / Flamsteed forms) from
   *  this record so "Alpha Centauri C" / "α Cen C" focus Proxima. */
  primaryIdx: number;
}

/** Map each multiples.tsv component to a system-relative designation so the
 *  runtime can offer "<base> <letter>" search aliases (Alpha Centauri A/B/C).
 *  Base comes from the SYSTEM PRIMARY's own designation, not the component's:
 *  Proxima carries no Bayer, yet "α Cen C" must resolve to it. The primary is
 *  included with its own comp letter (so "α Cen A" focuses it). Resolution
 *  mirrors binaries.bin (`resolvePairComponents`); coverage is bounded by what
 *  decomposes in multiples.tsv. First-write-wins on a record shared across
 *  pairs (α Cen A appears in both the AB and AC rows). */
export function buildComponentDesignations(
  rows: MultiplesTsvRow[],
  rowIndexMap: CatalogRowIndexMap,
): Map<number, ComponentDesignation> {
  const out = new Map<number, ComponentDesignation>();
  for (const cursor of groupBySystem(rows).values()) {
    const resolved = resolvePairComponents(cursor, rowIndexMap);
    if (resolved === null) continue;
    for (const c of resolved.components) {
      if (out.has(c.idx)) continue;
      out.set(c.idx, { comp: c.comp, primaryIdx: resolved.primaryIdx });
    }
  }
  return out;
}
