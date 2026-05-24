// Reads data/binaries/multiples.tsv and promotes binary companions that
// aren't already in AT-HYG into first-class catalog.bin records. The
// promotion path projects the companion's xyz from the primary's xyz
// via WDS sep+PA tangent-plane geometry, imputes absmag from primary +
// WDS Δmag, and inherits spectral class through the existing resolver.
// Companions whose absmag can't be imputed are dropped — never make up
// a brightness value.

import { readFileSync } from 'node:fs';

import {
  FLAG_HAS_NAME,
  FLAG_BINARY_COMPANION_ONLY,
  SOLAR_BV_FALLBACK,
  SPECTRAL_UNKNOWN,
  NO_CONSTELLATION_INDEX,
  classifyFromSimbad,
  parseGaiaSourceIdStr,
  physicalRadius,
  resolveSpectDisplay,
  tempKelvin,
  type SpectralInfo,
} from './catalog-pure';
import { ballesterosBvFromTeff } from '../colour/blackbody-lut-pure';
import type { Star } from './stars-parse';

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
  orbitRole: OrbitRole;
  distPc: number | null;
  sepArcsec: number | null;
  paDeg: number | null;
  sepPaEpochJd: number | null;
  dmag: number | null;
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

const ARCSEC_TO_RAD = Math.PI / (180.0 * 3600.0);

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
  /** Dropped because no identifier (gaia + hip both blank). */
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
    droppedNoIdentifier: 0,
    droppedNoPosition: 0,
    droppedNoPrimary: 0,
    droppedNoAbsmag: 0,
  };
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
  // Companions sharing the primary's HIP must NOT collapse onto the
  // primary's record here. The shared-HIP case is recognised by:
  //   - The row has a gaia_source_id (it was a true distinct component
  //     with its own Gaia entry, e.g. Sirius B); OR
  //   - The (system_id, comp) pair makes it a secondary by role.
  // The strict resolver only consults HIP when the row carries no
  // gaia_source_id AT ALL. Sirius B's row carries a Gaia source_id so
  // the gaia-miss-above (Sirius B's gaia isn't in AT-HYG) lets it fall
  // through to promotion regardless of the HIP collision.
  if (row.gaiaSourceId === null && row.hip !== null && row.hip > 0) {
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

// Companion B-V (ci) resolution. As with absmag, the multiples.tsv row's
// `ci` column is the AT-HYG row's ci — when the companion shares its
// parent's AT-HYG row (Sirius B inherits Sirius A's ci=0.009), that
// value is the primary's colour, not the companion's. For inherited-ci
// rows, recover the companion's intrinsic B-V from its spectral
// info via tempKelvin → ballesterosBvFromTeff. Sirius B's DA1.9 →
// T_eff ≈ 25200 K → B-V ≈ -0.44 (deep blue / hot end of the LUT), vs
// Sirius A's tabulated 0.009 (A0V white).
//
// Resolution order:
//   1. row.ci is null → derive from spectral info.
//   2. primary.ci is non-null AND row.ci === primary.ci (inherited
//      photometry) → derive from spectral info.
//   3. else → use row.ci.
//
// "Derive from spectral info" needs a parseable spect cell; when
// classifyFromSimbad returns SPECTRAL_UNKNOWN the routing falls
// through to SOLAR_BV_FALLBACK so the companion gets a sensible
// neutral colour rather than zero.
export function imputeCompanionCi(
  secondary: MultiplesTsvRow,
  primary: MultiplesTsvRow | null,
  spectralInfo: SpectralInfo,
): number {
  const inherited =
    secondary.ci !== null
    && primary !== null
    && primary.ci !== null
    && secondary.ci === primary.ci;
  const needsDerivation = secondary.ci === null || inherited;
  if (!needsDerivation) {
    return secondary.ci as number;
  }
  // SPECTRAL_UNKNOWN's tempKelvin is the 5000 K row of T_TABLE[8] —
  // a yellow-white default. Detect that explicitly so the fallback
  // routes through SOLAR_BV_FALLBACK instead, mirroring stars-parse's
  // handling for AT-HYG rows with blank ci AND unparseable spect.
  if (spectralInfo === SPECTRAL_UNKNOWN
      || (spectralInfo.classIdx === 8 && !spectralInfo.isWhiteDwarf)) {
    return SOLAR_BV_FALLBACK;
  }
  return ballesterosBvFromTeff(tempKelvin(spectralInfo));
}


// Companion absmag resolution. The multiples.tsv row's `absmag` column is
// the AT-HYG row's absmag — when a companion inherits the system's AT-HYG
// row (Sirius B has the same AT-HYG entry as Sirius A), that value is the
// primary's brightness, not the companion's. Prefer Δmag-imputation in
// that case so the companion ends up at its true brightness, not the
// primary's.
//
// Resolution order:
//   1. If the row's astrometry_via is system_inherited OR the row's gaia
//      doesn't match any AT-HYG row's own gaia — i.e. it inherited photo —
//      and primary absmag + dmag are both available → impute.
//   2. Else if the row carries its own absmag → use it directly.
//   3. Else if primary + dmag available → impute.
//   4. Else → null (drop).
export function imputeCompanionAbsmag(
  secondary: MultiplesTsvRow,
  primary: MultiplesTsvRow | null,
): number | null {
  const primaryAbsmag = primary?.absmag ?? null;
  const dmag = secondary.dmag;
  const inheritedPhotometry =
    primary !== null
      && secondary.absmag !== null
      && primaryAbsmag !== null
      && Math.abs(secondary.absmag - primaryAbsmag) < 1e-9;

  if (inheritedPhotometry && dmag !== null) {
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

  // Components that share a primary's HIP (Sirius A and B both list
  // HIP 32349) inherit the system anchor's astrometry from Stage 3
  // even when astrometry_via reads "hip2_long_baseline" or similar —
  // the tag is the SOURCE of the astrometry, not whether the
  // secondary got its own per-component fit. Detect collocation by
  // exact xyz equality with the primary's multiples row and fall
  // through to the sep+PA tangent projection.
  const collocatedWithPrimary =
    ownAstrometry
    && primary !== null
    && primary.x_pc !== null && primary.y_pc !== null && primary.z_pc !== null
    && row.x_pc === primary.x_pc
    && row.y_pc === primary.y_pc
    && row.z_pc === primary.z_pc;

  if (ownAstrometry && !collocatedWithPrimary) {
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
  if (row.sepArcsec === null || row.paDeg === null) return null;
  return projectFromSepPa(anchorX, anchorY, anchorZ, row.sepArcsec, row.paDeg);
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

// Compose the companion's display name as "<primary_proper> <comp>".
// Falls back to no proper name when the multiples row has no `name` cell —
// the row's primary either has no AT-HYG proper name or no AT-HYG row at
// all, so we can't synthesise a sensible label.
function composeCompanionName(row: MultiplesTsvRow): string | null {
  const base = row.name.trim();
  if (!base) return null;
  const comp = row.comp.trim();
  if (!comp) return base;
  return `${base} ${comp}`;
}

export function promoteCompanions(
  multiplesRows: MultiplesTsvRow[],
  existingStars: Star[],
): { newStars: Star[]; stats: PromotionStats } {
  const stats = emptyPromotionStats();
  const existing = buildExistingIndexes(existingStars);
  const groups = groupBySystem(multiplesRows);
  const newStars: Star[] = [];
  // Track promotions by gaia+hip so two pair rows in the same system that
  // reference the same secondary (e.g. Sirius A appears as primary in
  // 06451-1643-AB AND would have been "primary" again if WDS broke the
  // same components into a sub-pair) don't get double-promoted.
  const promotedGaia = new Set<string>();
  const promotedHip = new Set<number>();

  for (const cursor of groups.values()) {
    // Standalone rows are augmentation entries that aren't sides of a WDS
    // pair; their primary slot is empty. Skip — promoting them without
    // pair geometry needs a different rule than this lmh.4 path.
    if (cursor.primary === null) continue;

    for (const row of cursor.secondaries) {
      if (row.orbitRole !== 'secondary') continue;
      stats.pairRowsScanned++;
      // Identifier check — skip if both gaia + hip blank. The row exists
      // in multiples.tsv but has no way to be addressed by runtime code.
      if (row.gaiaSourceId === null && (row.hip === null || row.hip <= 0)) {
        stats.droppedNoIdentifier++;
        continue;
      }
      if (findExisting(row, existing) !== null) {
        stats.alreadyInCatalog++;
        continue;
      }
      if (row.gaiaSourceId && promotedGaia.has(row.gaiaSourceId)) {
        stats.alreadyInCatalog++;
        continue;
      }
      if (row.hip !== null && row.hip > 0 && row.gaiaSourceId === null
          && promotedHip.has(row.hip)) {
        stats.alreadyInCatalog++;
        continue;
      }

      // If the primary already lives in catalog.bin, anchor the sep+PA
      // projection on that existing record's xyz rather than the
      // multiples.tsv row's xyz — keeps the companion physically close
      // to its visual parent regardless of pipeline-precision gaps.
      const primaryCatalogIdx = cursor.primary !== null
        ? findExisting(cursor.primary, existing)
        : null;
      const anchor: ProjectionAnchor | null = primaryCatalogIdx !== null
        ? {
            x: existingStars[primaryCatalogIdx].x,
            y: existingStars[primaryCatalogIdx].y,
            z: existingStars[primaryCatalogIdx].z,
          }
        : null;
      const position = resolvePosition(row, cursor.primary, anchor);
      if (position === null) {
        stats.droppedNoPosition++;
        continue;
      }
      const absmag = imputeCompanionAbsmag(row, cursor.primary);
      if (absmag === null) {
        stats.droppedNoAbsmag++;
        continue;
      }
      const spectral = resolveCompanionSpectral(row);
      const ci = imputeCompanionCi(row, cursor.primary, spectral.info);
      const properName = composeCompanionName(row);
      let flags = FLAG_BINARY_COMPANION_ONLY;
      if (properName) flags |= FLAG_HAS_NAME;

      newStars.push({
        x: position.x, y: position.y, z: position.z,
        absmag, ci,
        spectClass: spectral.info.classIdx,
        lumClass: spectral.info.lumClass,
        physicalRadius: physicalRadius(absmag, spectral.info),
        conIndex: NO_CONSTELLATION_INDEX,
        flags,
        proper: properName,
        bayer: null,
        hip: row.hip,
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
      });
      stats.promoted++;
      if (row.gaiaSourceId) promotedGaia.add(row.gaiaSourceId);
      if (row.hip !== null && row.hip > 0) promotedHip.add(row.hip);
    }
  }
  return { newStars, stats };
}

// ---- Catalog row-index map sidecar -------------------------------------

export interface CatalogRowIndexMap {
  /** Gaia DR3 source_id (decimal string) → catalog.bin record index. */
  byGaia: Record<string, number>;
  /** Hipparcos catalog number → catalog.bin record index. */
  byHip: Record<string, number>;
}

// Build the lookup sidecar after the final absmag sort. The runtime
// binaries loader resolves multiples.tsv rows to catalog.bin records
// through this map; the build script writes it next to catalog.bin /
// search-index.json.
export function buildCatalogRowIndexMap(stars: Star[]): CatalogRowIndexMap {
  const byGaia: Record<string, number> = {};
  const byHip: Record<string, number> = {};
  for (let i = 0; i < stars.length; i++) {
    const s = stars[i];
    if (s.gaiaSourceId && !(s.gaiaSourceId in byGaia)) {
      byGaia[s.gaiaSourceId] = i;
    }
    if (s.hip !== null && s.hip > 0 && !(`${s.hip}` in byHip)) {
      byHip[`${s.hip}`] = i;
    }
  }
  return { byGaia, byHip };
}
