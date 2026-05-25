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
  classifyFromSimbad,
  parseGaiaSourceIdStr,
  physicalRadius,
  resolveSpectDisplay,
  tempKelvin,
  type SpectralInfo,
} from './catalog-pure';
import { ballesterosBvFromTeff } from '../colour/blackbody-lut-pure';
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
  sepArcsec: number | null;
  paDeg: number | null;
  sepPaEpochJd: number | null;
  dmag: number | null;
}

export const PHOTOMETRY_VIA_OWN = 'athyg_own';
export const PHOTOMETRY_VIA_SYSTEM_INHERITED = 'athyg_system_inherited';
export const PHOTOMETRY_VIA_NONE = 'none';

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
  /** Dropped because the secondary's own absmag was missing AND Δmag
   *  couldn't impute one. */
  droppedNoAbsmag: number;
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
}

function buildExistingIndexes(stars: Star[]): ExistingIndexes {
  const byGaia = new Map<string, number>();
  const byHip = new Map<number, number>();
  for (let i = 0; i < stars.length; i++) {
    const s = stars[i];
    if (s.gaiaSourceId && !byGaia.has(s.gaiaSourceId)) {
      byGaia.set(s.gaiaSourceId, i);
    }
    if (s.hip !== null && s.hip > 0 && !byHip.has(s.hip)) {
      byHip.set(s.hip, i);
    }
  }
  return { byGaia, byHip };
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

// Cursor-primary lookup. More permissive than findExisting: tries HIP
// even when gaia is set, because AT-HYG sometimes carries only HIP for
// the primary while multiples.tsv has the Gaia source_id from SIMBAD's
// cross-walk (70 Oph A — HIP 88601 in AT-HYG, no own gaia; multiples
// row carries gaia=4468557611984384512 from simbad_xid). For primaries
// the shared-HIP-with-secondary ambiguity doesn't apply — the cursor
// primary IS the system anchor, not a sibling that might collide.
function findExistingPrimary(
  row: MultiplesTsvRow,
  existing: ExistingIndexes,
): number | null {
  if (row.gaiaSourceId) {
    const hit = existing.byGaia.get(row.gaiaSourceId);
    if (hit !== undefined) return hit;
  }
  if (row.hip !== null && row.hip > 0) {
    const hit = existing.byHip.get(row.hip);
    if (hit !== undefined) return hit;
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
function groupBySystem(rows: MultiplesTsvRow[]): Map<string, PairCursor> {
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
export function imputeCompanionCi(
  secondary: MultiplesTsvRow,
  spectralInfo: SpectralInfo,
): number {
  const inherited = secondary.photometryVia === PHOTOMETRY_VIA_SYSTEM_INHERITED;
  const needsDerivation = secondary.ci === null || inherited;
  if (!needsDerivation) {
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


// Companion absmag. When Stage 6 tags the row's photometry as
// inherited from the system primary, impute as primary + WDS Δmag;
// otherwise prefer the row's own absmag and fall back to primary +
// Δmag. Returns null when no path produces a value — caller drops.
export function imputeCompanionAbsmag(
  secondary: MultiplesTsvRow,
  primary: MultiplesTsvRow | null,
): number | null {
  const primaryAbsmag = primary?.absmag ?? null;
  const dmag = secondary.dmag;
  const inheritedPhotometry =
    secondary.photometryVia === PHOTOMETRY_VIA_SYSTEM_INHERITED;

  if (inheritedPhotometry && primaryAbsmag !== null && dmag !== null) {
    return primaryAbsmag + dmag;
  }
  if (secondary.absmag !== null) return secondary.absmag;
  if (primaryAbsmag !== null && dmag !== null) return primaryAbsmag + dmag;
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

function resolvePosition(
  row: MultiplesTsvRow,
  primary: MultiplesTsvRow | null,
  anchor: ProjectionAnchor | null,
): CompanionPlacement | null {
  const ownAstrometry =
    row.astrometryVia !== 'system_inherited'
    && row.x_pc !== null && row.y_pc !== null && row.z_pc !== null
    && row.distPc !== null;

  // A secondary's xyz is "independent" only when Stage 3 re-anchored it
  // per-component. gaia_5p with its own gaia_source_id, or
  // hip2_long_baseline with its own HIP, count. Every other route —
  // athyg_position, gaia_nss_systemic, system_inherited (and the
  // shared-identifier shape inside the routes above) — reproduces the
  // SYSTEM anchor under a different float path. Strict xyz equality
  // missed this because float residue ranges from µpc at nearby systems
  // (Algol Aa↔Ab) to tens of AU at hundreds of pc (Polaris Aa↔Ab); the
  // tag itself is the reliable signal. The catalog primary's xyz is the
  // authoritative position, and sep+PA tangent projection from it keeps
  // every component of one system rendered coherently.
  const primaryGaia = primary?.gaiaSourceId ?? null;
  const primaryHip = primary?.hip ?? null;
  const independentAstrometry =
    ownAstrometry
    && INDEPENDENT_FIT_ROUTES.has(row.astrometryVia)
    && ((row.astrometryVia === 'gaia_5p'
         && row.gaiaSourceId !== null
         && row.gaiaSourceId !== primaryGaia)
      || (row.astrometryVia === 'hip2_long_baseline'
          && row.hip !== null && row.hip > 0
          && row.hip !== primaryHip));

  if (independentAstrometry) {
    return {
      x: row.x_pc as number, y: row.y_pc as number, z: row.z_pc as number,
      distPc: row.distPc as number,
    };
  }
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
  if (sepArcsec === null || paDeg === null) return null;
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
  if (!canonicalComp) return base;
  return `${base} ${canonicalComp}`;
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
    const idx = findExistingPrimary(cursor.primary, existing);
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
}

interface PromotionState {
  existing: ExistingIndexes;
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
): number | null {
  const { row, anchorPrimaryRow, anchorStar, anchorCatalogIdx,
          position, canonicalComp } = ctx;
  const synthId = composeSyntheticId(row.systemId, canonicalComp);
  const rowHasOwnHip = row.hip !== null && row.hip > 0;
  if (row.gaiaSourceId === null && !rowHasOwnHip && synthId === null) {
    stats.droppedNoIdentifier++;
    return null;
  }
  // Dedup against existing catalog + previously-promoted records.
  // The inherited-HIP escape lets a no-gaia secondary match the anchor's
  // record via HIP fall-through without being classified as alreadyInCatalog
  // (Sirius A+B both list HIP 32349 — Hipparcos resolved them as one star).
  let existingIdx: number | null = null;
  let inheritedHipCollision = false;
  if (row.gaiaSourceId !== null || rowHasOwnHip) {
    existingIdx = findExisting(row, state.existing);
    inheritedHipCollision =
      existingIdx !== null
      && row.gaiaSourceId === null
      && anchorCatalogIdx !== null
      && existingIdx === anchorCatalogIdx;
    if (existingIdx !== null && !inheritedHipCollision) {
      stats.alreadyInCatalog++;
      return null;
    }
  }
  if (row.gaiaSourceId && state.promotedByGaia.has(row.gaiaSourceId)) {
    stats.alreadyInCatalog++;
    return null;
  }
  if (rowHasOwnHip && row.gaiaSourceId === null
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
  // the anchor row's HIP.
  const inheritedHip = row.hip !== null && row.hip > 0
    && anchorPrimaryRow.hip === row.hip;
  const companionHip = inheritedHip ? null : row.hip;
  const usesSynth = row.gaiaSourceId === null && companionHip === null;
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
  const absmag = imputeCompanionAbsmag(row, anchorPrimaryRow);
  if (absmag === null) {
    stats.droppedNoAbsmag++;
    return null;
  }
  const spectral = resolveCompanionSpectral(row);
  const ci = imputeCompanionCi(row, spectral.info);
  const properName = composeCompanionName(
    row, anchorPrimaryRow, canonicalComp, anchorStar, constellations,
  );
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
    gaiaSourceId: row.gaiaSourceId,
    spectDisplay: spectral.display,
    companionIdx: -1,
    periodDays: 0,
    amplitudeMag: 0,
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
  if (row.gaiaSourceId) state.promotedByGaia.set(row.gaiaSourceId, newIdx);
  if (companionHip !== null) state.promotedByHip.set(companionHip, newIdx);
  return newIdx;
}

export function promoteCompanions(
  multiplesRows: MultiplesTsvRow[],
  existingStars: Star[],
  constellations: { code: string; name: string }[],
): { newStars: Star[]; stats: PromotionStats } {
  const stats = emptyPromotionStats();
  const existing = buildExistingIndexes(existingStars);
  const groups = groupBySystem(multiplesRows);
  const wdsRootAnchors = buildWdsRootAnchors(groups, existing, existingStars);
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
    let primaryCatalogIdx = findExistingPrimary(cursor.primary, existing);
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
        cursor, wdsRootAnchors, state, constellations, stats,
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
        },
        state, constellations, stats,
      );
    }
  }
  return { newStars, stats };
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
  // Position: collocate at the WDS-root system anchor. We don't have a
  // reliable AB sep+PA when the row is a sub-pair primary (the row's own
  // sep+PA describes its sub-pair, not its relationship to the system
  // anchor). BinaryOrbitField overlays orbital motion at runtime, so
  // the static position sitting on the anchor is acceptable until a
  // cross-group AB sep+PA pass lands as a follow-up.
  const position: CompanionPlacement = {
    x: anchor.star.x, y: anchor.star.y, z: anchor.star.z,
    distPc: Math.hypot(anchor.star.x, anchor.star.y, anchor.star.z),
  };
  return promoteRow(
    {
      row: primary,
      anchorPrimaryRow: anchor.primaryRow,
      anchorStar: anchor.star,
      anchorCatalogIdx: anchor.catalogIdx,
      position,
      canonicalComp: primary.comp,
    },
    state, constellations, stats,
  );
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
