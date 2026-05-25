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
  /** Subset of `promoted` whose only identifier is a synthetic key
   *  (`synth-<wds_id>-<comp>`) because the row carried no own gaia and
   *  no non-inherited hip. */
  promotedSynthetic: number;
  /** Dropped because no identifier (gaia + hip both blank) AND no
   *  synthetic key could be composed (system_id has no dash, comp empty). */
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

/** Synthetic identifier minted for promoted secondaries whose pair-row
 *  carries no own Gaia source_id and no non-inherited HIP. Format:
 *  `synth-<wds_id>-<comp>`. Indexed in the row-index map's `bySynth`
 *  table so build-runtime-binaries can resolve the secondary side of
 *  pairs like Algol Aa,Ab whose Ab cell has neither Gaia nor HIP. */
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
// The secondary's own `name` cell is populated only when source=athyg
// (the row found an AT-HYG entry); for source=wds rows it's empty even
// when the PRIMARY's AT-HYG entry has a perfectly good proper name to
// inherit. Fall back to the primary row's name in that case so
// "Achird B", "Porrima B", "Capella B" etc. become searchable rather
// than rendering as anonymous-companion records nobody can find.
function composeCompanionName(
  row: MultiplesTsvRow,
  primary: MultiplesTsvRow | null,
): string | null {
  const ownBase = row.name.trim();
  const primaryBase = (primary?.name ?? '').trim();
  const base = ownBase || primaryBase;
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
  // promotedSynth dedupes synthetic-ID promotions across the same build
  // run — a (wds_id, comp) pair appearing in multiple rows resolves to a
  // single catalog record.
  const promotedGaia = new Set<string>();
  const promotedHip = new Set<number>();
  const promotedSynth = new Set<string>();

  for (const cursor of groups.values()) {
    // Standalone rows are augmentation entries that aren't sides of a WDS
    // pair; their primary slot is empty. Skip — promoting them without
    // pair geometry needs a different rule than this path.
    if (cursor.primary === null) continue;

    // Resolve the primary's catalog row once per system. Used both for
    // anchoring the sep+PA projection AND for the inherited-HIP escape
    // below (so findExisting hits against the primary's record don't
    // wrongly collapse a no-gaia secondary that's inheriting HIP).
    const primaryCatalogIdx = findExisting(cursor.primary, existing);
    const anchor: ProjectionAnchor | null = primaryCatalogIdx !== null
      ? {
          x: existingStars[primaryCatalogIdx].x,
          y: existingStars[primaryCatalogIdx].y,
          z: existingStars[primaryCatalogIdx].z,
        }
      : null;

    for (const row of cursor.secondaries) {
      if (row.orbitRole !== 'secondary') continue;
      stats.pairRowsScanned++;
      // Synthetic-ID candidate, used as a last-resort identifier when the
      // row carries neither own gaia nor non-inherited hip. Compute up
      // front so the "is the final record addressable?" gate has the same
      // information at every decision point below.
      const synthId = composeSyntheticId(row.systemId, row.comp);
      const rowHasOwnHip = row.hip !== null && row.hip > 0;
      // Identifier check — drop only when no real ID AND no synth fallback
      // can be composed. Algol Ab carries gaia=null + hip=null + a valid
      // (wds_id, comp) pair, so it survives via the synthetic-ID path.
      if (row.gaiaSourceId === null && !rowHasOwnHip && synthId === null) {
        stats.droppedNoIdentifier++;
        continue;
      }
      // findExisting + inherited-HIP escape. When a no-gaia secondary
      // row matches the primary's catalog record on HIP, that's the
      // inheritance-collision case (Hipparcos resolved A+B as one star),
      // not a real "already in catalog" hit — promotion should proceed.
      // Skip the lookup entirely when the row has no real IDs to query.
      let existingIdx: number | null = null;
      let inheritedHipCollision = false;
      if (row.gaiaSourceId !== null || rowHasOwnHip) {
        existingIdx = findExisting(row, existing);
        inheritedHipCollision =
          existingIdx !== null
          && row.gaiaSourceId === null
          && primaryCatalogIdx !== null
          && existingIdx === primaryCatalogIdx;
        if (existingIdx !== null && !inheritedHipCollision) {
          stats.alreadyInCatalog++;
          continue;
        }
      }
      if (row.gaiaSourceId && promotedGaia.has(row.gaiaSourceId)) {
        stats.alreadyInCatalog++;
        continue;
      }
      if (rowHasOwnHip && row.gaiaSourceId === null
          && promotedHip.has(row.hip as number)) {
        stats.alreadyInCatalog++;
        continue;
      }

      // HIP inheritance gate. The multiples.tsv carries the primary's
      // HIP on both component rows when AT-HYG had a single entry for
      // the system (Sirius A and B both list HIP 32349 — Hipparcos
      // resolved the pair as one star). Letting the companion adopt
      // that HIP collides with the primary in every HIP-keyed lookup:
      // url-state's refFromIndex encodes by HIP, and resolveStarRef
      // decodes via a first-wins map, so a shared link or page reload
      // collapses both records onto the primary. Set hip=null when
      // the row's HIP equals the primary row's HIP — Hipparcos owns
      // that identifier for the brighter component.
      const inheritedHip = cursor.primary !== null
        && row.hip !== null && row.hip > 0
        && cursor.primary.hip === row.hip;
      const companionHip = inheritedHip ? null : row.hip;
      // Synthetic-ID gate: take the synthetic path when the final
      // record will have neither gaia nor non-inherited hip — Algol Ab
      // (entry: gaia=null + hip=null) and the inherited-HIP escape's
      // after-stripping case both land here.
      const usesSynth = row.gaiaSourceId === null && companionHip === null;
      if (usesSynth) {
        if (synthId === null) {
          // composeSyntheticId already screens for this above, but a
          // primary-side inherited-HIP escape with no system_id format
          // could in principle reach here — drop conservatively.
          stats.droppedNoIdentifier++;
          continue;
        }
        if (promotedSynth.has(synthId)) {
          stats.alreadyInCatalog++;
          continue;
        }
      }
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
      const ci = imputeCompanionCi(row, spectral.info);
      const properName = composeCompanionName(row, cursor.primary);
      let flags = FLAG_BINARY_COMPANION_ONLY;
      if (properName) flags |= FLAG_HAS_NAME;
      if (usesSynth) flags |= FLAG_BINARY_COMPANION_SYNTHETIC;

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
      stats.promoted++;
      if (usesSynth) {
        stats.promotedSynthetic++;
        promotedSynth.add(synthId as string);
      }
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
  /** Synthetic identifier (`synth-<wds_id>-<comp>`) → catalog.bin record
   *  index. Populated for promoted companions whose own gaia/hip can't
   *  address the record (Algol Ab — no IDs at all; the inherited-HIP
   *  escape stripping path — IDs collide with the primary). */
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
