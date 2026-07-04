// Reads data/binaries/multiples.tsv and promotes physical-pair
// secondaries not in AT-HYG into first-class catalog.bin records.
// See scripts/catalog/README.md § Companion promotion.

import { readFileSync } from 'node:fs';

import {
  FLAG_HAS_NAME,
  FLAG_BINARY_COMPANION_ONLY,
  FLAG_BINARY_COMPANION_SYNTHETIC,
  SOLAR_BV_FALLBACK,
  SPECTRAL_UNKNOWN,
  NO_CONSTELLATION_INDEX,
  UNKNOWN_CLASS_IDX,
  absmagFromSpectral,
  classifyFromSimbad,
  parseGaiaSourceIdStr,
  physicalRadius,
  resolveSpectDisplay,
  tempKelvin,
  type SpectralInfo,
} from './catalog-pure';
import { ballesterosBvFromTeff } from '../colour/blackbody-lut-pure';
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
}

export const PHOTOMETRY_VIA_OWN = 'athyg_own';
export const PHOTOMETRY_VIA_SYSTEM_INHERITED = 'athyg_system_inherited';
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
  /** Dropped because primary's catalog row wasn't found (orphaned pair). */
  droppedNoPrimary: number;
  /** Dropped because no honest absmag path existed: own photometry
   *  missing or inherited, no Δmag, no per-component spectral type,
   *  and no renderable orbit forcing the record to survive. */
  droppedNoAbsmag: number;
  /** Subset of `promoted` whose absmag came from the class→M_V
   *  spectral calibration (inherited/missing photometry, no Δmag). */
  absmagSpectralDerived: number;
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
   *  neither own per-component astrometry nor a compound-sibling sep+PA
   *  proxy. Collocating on the anchor would render a false coincident
   *  star (Alsephina C). */
  droppedCollocatedPrimary: number;
}

export function emptyPromotionStats(): PromotionStats {
  return {
    pairRowsScanned: 0,
    alreadyInCatalog: 0,
    promoted: 0,
    promotedSynthetic: 0,
    droppedNoIdentifier: 0,
    droppedNoPosition: 0,
    droppedNoPrimary: 0,
    droppedNoAbsmag: 0,
    absmagSpectralDerived: 0,
    absmagAnchorCollocated: 0,
    absmagInheritedTwinOrbital: 0,
    repositionedCollocatedDouble: 0,
    droppedCompoundComp: 0,
    droppedCollocatedPrimary: 0,
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
// 0.009 white instead of its own DA1.9 blue), derive from spectral info
// via tempKelvin → ballesterosBvFromTeff. SPECTRAL_UNKNOWN falls
// through to SOLAR_BV_FALLBACK.
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
  // SPECTRAL_UNKNOWN's tempKelvin is the neutral 5000 K row — a yellow-
  // white default. Detect that explicitly so the fallback routes through
  // SOLAR_BV_FALLBACK instead, mirroring stars-parse's handling for
  // AT-HYG rows with blank ci AND unparseable spect.
  if (spectralInfo === SPECTRAL_UNKNOWN
      || (spectralInfo.classIdx === UNKNOWN_CLASS_IDX && !spectralInfo.isWhiteDwarf)) {
    return SOLAR_BV_FALLBACK;
  }
  return ballesterosBvFromTeff(tempKelvin(spectralInfo));
}


/** Which path produced a companion's absmag. `dmag_imputed` = primary +
 *  WDS Δmag; `own` = the row's own (non-inherited) photometry;
 *  `spectral` = class→M_V from the row's per-component spectral type;
 *  `inherited_twin` = the inherited primary absmag kept ONLY because
 *  the pair has a renderable orbit (dropping the record would also
 *  drop its orbit/eclipse from binaries.bin) and no honest brightness
 *  source exists yet; `anchor_collocated` = a pair-row-primary escape
 *  falling back to the anchor's brightness (see imputeCompanionAbsmag). */
export type CompanionAbsmagSource =
  | 'dmag_imputed'
  | 'own'
  | 'spectral'
  | 'inherited_twin'
  | 'anchor_collocated';

export interface CompanionAbsmag {
  absmag: number;
  source: CompanionAbsmagSource;
}

// Companion absmag. Preference order: primary + WDS Δmag when the
// row's photometry is inherited; the row's own absmag when it isn't;
// primary + Δmag fallback; class→M_V from a per-component spectral
// type. A row with inherited photometry, no Δmag, and no per-component
// type has NO honest brightness source — returning the inherited
// absmag would mint a full-luminosity twin of the primary (Algol Aa2,
// Betelgeuse Ab). Those rows return null (caller drops) unless the
// pair carries a renderable orbit, where the record must survive for
// binaries.bin's sake and the twin is kept, tagged, and counted.
//
// anchorDmagApplies is false for a pair-row-primary escape: that row's
// Δmag describes the SUB-pair it heads (40 Eri B's Δmag is the B→C
// delta), not the anchor→row separation, so adding it to the anchor's
// absmag is meaningless. Both primary+Δmag paths are skipped, and when
// no own / per-component-spectral brightness exists the record inherits
// the anchor's collocated brightness rather than a corrupted A+Δmag.
export function imputeCompanionAbsmag(
  secondary: MultiplesTsvRow,
  primary: MultiplesTsvRow | null,
  spectral: SpectralInfo,
  anchorDmagApplies = true,
): CompanionAbsmag | null {
  const primaryAbsmag = primary?.absmag ?? null;
  const dmag = secondary.dmag;
  const inheritedPhotometry =
    secondary.photometryVia === PHOTOMETRY_VIA_SYSTEM_INHERITED;

  if (anchorDmagApplies && inheritedPhotometry
      && primaryAbsmag !== null && dmag !== null) {
    return { absmag: primaryAbsmag + dmag, source: 'dmag_imputed' };
  }
  if (!inheritedPhotometry && secondary.absmag !== null) {
    return { absmag: secondary.absmag, source: 'own' };
  }
  if (anchorDmagApplies && primaryAbsmag !== null && dmag !== null) {
    return { absmag: primaryAbsmag + dmag, source: 'dmag_imputed' };
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
): CompanionPlacement | null {
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
  // WDS Summary emits `rho=-1` / `theta=-1` for pairs with no measured
  // separation (spectroscopic / interferometric inner pairs reported
  // only at the orbital-element level). Normalise the sentinel to null
  // here so the drop path fires honestly — projecting a negative
  // arc-sec offset would place the secondary tens of AU off the anchor
  // for no astrophysical reason.
  const sepArcsec = row.sepArcsec !== null && row.sepArcsec >= 0 ? row.sepArcsec : null;
  const paDeg = row.paDeg !== null && row.paDeg >= 0 ? row.paDeg : null;
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
  return projectFromSepPa(anchorX, anchorY, anchorZ, sepArcsec, paDeg);
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
): string | null {
  const base = resolveCompanionNameBase(row, primary, primaryStar, constellations);
  if (!base) return null;
  return joinComponentName(base, canonicalComp);
}

/** "<base> <comp>", or just base when comp is empty. */
function joinComponentName(base: string, comp: string): string {
  return comp ? `${base} ${comp}` : base;
}

function resolveCompanionNameBase(
  row: MultiplesTsvRow,
  primary: MultiplesTsvRow | null,
  primaryStar: Star | null,
  constellations: { code: string; name: string }[],
): string | null {
  const ownBase = row.name.trim();
  if (ownBase) return ownBase;
  const primaryBase = (primary?.name ?? '').trim();
  if (primaryBase) return primaryBase;
  if (primaryStar === null) return null;
  const proper = (primaryStar.proper ?? '').trim();
  if (proper) return proper;
  const conCode = constellationCode(primaryStar.conIndex, constellations);
  if (conCode === null) return null;
  const bayer = (primaryStar.bayer ?? '').trim();
  if (bayer) return `${bayer} ${conCode}`;
  if (primaryStar.flam !== null) return `${primaryStar.flam} ${conCode}`;
  return null;
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

/** Find a sep+PA proxy for a single-letter pair-row primary by walking
 *  sibling cursors in the same WDS root for an unresolved-compound
 *  secondary whose letters include this primary's comp letter. 40 Eri's
 *  pair-row primary "B" (in BC/BD/BE groups) borrows the A,BC group's
 *  83.2″/~108° A→BC sep+PA as an A→B proxy — vastly better than
 *  collocating B at A's position when no AB orbital pair animates it at
 *  runtime. Returns null when no such sibling exists. */
function findCompoundProxySepPa(
  primaryComp: string,
  wdsRoot: string,
  groups: Map<string, PairCursor>,
  singleLettersByRoot: Map<string, Set<string>>,
): { sepArcsec: number; paDeg: number } | null {
  if (primaryComp.length !== 1) return null;
  for (const [sysId, cursor] of groups) {
    if (wdsRootOf(sysId) !== wdsRoot) continue;
    for (const sec of cursor.secondaries) {
      if (sec.orbitRole !== 'secondary') continue;
      if (!sec.comp.includes(primaryComp)) continue;
      if (!isUnresolvedCompound(sec.comp, wdsRoot, singleLettersByRoot)) continue;
      if (sec.sepArcsec === null || sec.paDeg === null) continue;
      if (sec.sepArcsec < 0 || sec.paDeg < 0) continue;
      return { sepArcsec: sec.sepArcsec, paDeg: sec.paDeg };
    }
  }
  return null;
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
}

function promoteRow(
  ctx: PromoteRowContext,
  state: PromotionState,
  constellations: { code: string; name: string }[],
  stats: PromotionStats,
  dustGrid: DustGrid | null,
): number | null {
  const { row, anchorPrimaryRow, anchorStar, anchorCatalogIdx,
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
  // identifier falls through to hip/synth.
  const inheritedGaia = row.gaiaSourceId !== null
    && anchorPrimaryRow.gaiaSourceId === row.gaiaSourceId;
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
  const spectral = resolveCompanionSpectral(row);
  const imputed = imputeCompanionAbsmag(
    row, anchorPrimaryRow, spectral.info, !isPairRowPrimary,
  );
  if (imputed === null) {
    stats.droppedNoAbsmag++;
    return null;
  }
  let absmag = imputed.absmag;
  if (imputed.source === 'spectral') stats.absmagSpectralDerived++;
  if (imputed.source === 'anchor_collocated') stats.absmagAnchorCollocated++;
  if (imputed.source === 'inherited_twin') stats.absmagInheritedTwinOrbital++;
  let ci = imputeCompanionCi(row, spectral.info);
  // Build-time de-extinction along the companion's sightline. A
  // spectral-derived absmag (class→M_V) and a derived ci (Ballesteros /
  // solar fallback) are already intrinsic, so leave them; observed-
  // photometry absmag (dmag-imputed / own / inherited-twin) and the row's
  // own observed ci embed A_V and get it subtracted so the runtime
  // raymarch re-adds it without double-counting.
  if (dustGrid) {
    const av = avSolToStar(dustGrid, position.x, position.y, position.z);
    if (imputed.source !== 'spectral') absmag -= av;
    if (companionCiIsObserved(row)) ci -= av / R_V;
  }
  const properName = composeCompanionName(
    row, anchorPrimaryRow, canonicalComp, anchorStar, constellations,
  );
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
    athygDist: null,
    athygDistSrc: null,
    syntheticId: usesSynth ? synthId : null,
  });
  const newIdx = state.existingStarsLength + state.newStars.length - 1;
  stats.promoted++;
  if (usesSynth) {
    stats.promotedSynthetic++;
    state.promotedBySynth.set(synthId as string, newIdx);
  }
  if (companionGaia) state.promotedByGaia.set(companionGaia, newIdx);
  if (companionHip !== null) state.promotedByHip.set(companionHip, newIdx);
  return newIdx;
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
  };
  const getStarAt = (idx: number): Star =>
    idx < existingStars.length
      ? existingStars[idx]
      : newStars[idx - existingStars.length];

  for (const cursor of groups.values()) {
    // Standalone rows are augmentation entries that aren't sides of a WDS
    // pair; their primary slot is empty. Skip — promoting them without
    // pair geometry needs a different rule than this path.
    if (cursor.primary === null) continue;

    // Resolve the cursor primary's catalog row. Check existing AT-HYG
    // first, then previously-promoted records (40 Eri B class — promoted
    // in BC, then reused as anchor for BD).
    let primaryCatalogIdx = findExistingPrimary(cursor.primary, existing, existingStars);
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
        cursor, wdsRootAnchors, groups, singleLettersByRoot,
        state, constellations, stats, dustGrid,
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
      const position = resolvePosition(row, cursor.primary, anchor);
      promoteRow(
        {
          row,
          anchorPrimaryRow: cursor.primary,
          anchorStar,
          anchorCatalogIdx: primaryCatalogIdx,
          position,
          canonicalComp,
          isPairRowPrimary: false,
        },
        state, constellations, stats, dustGrid,
      );
    }
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
  groups: Map<string, PairCursor>,
  singleLettersByRoot: Map<string, Set<string>>,
  state: PromotionState,
  constellations: { code: string; name: string }[],
  stats: PromotionStats,
  dustGrid: DustGrid | null,
): number | null {
  const primary = cursor.primary;
  if (primary === null) return null;
  // Need own identifier (gaia or hip) to be addressable post-promotion.
  // 40 Eri B has gaia=3195919254111315712 but no HIP.
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
  //  2. Project from a sibling cursor's unresolved-compound sep+PA when
  //     the compound contains this row's comp letter — 40 Eri B (in
  //     BC/BD/BE) borrows the A,BC group's anchor→BC sep+PA as an
  //     anchor→B proxy. Approximate (it's anchor→BC-barycentre, not
  //     anchor→B), but vastly better than collocation.
  // Neither available → drop. Collocating at the anchor would bake a
  // false coincident star inside the anchor's disc (Alsephina C): the
  // escape only fires for cursor primaries that never appear as a
  // secondary of the anchor, so no anchor→self orbital pair exists for
  // BinaryOrbitField to animate it away from centre at runtime.
  let position = resolveIndependentAstrometry(
    primary, anchor.primaryRow.gaiaSourceId, anchor.primaryRow.hip,
  );
  if (position === null) {
    const proxy = findCompoundProxySepPa(
      primary.comp, wdsRoot, groups, singleLettersByRoot,
    );
    if (proxy !== null) {
      position = projectFromSepPa(
        anchor.star.x, anchor.star.y, anchor.star.z,
        proxy.sepArcsec, proxy.paDeg,
      );
    }
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
