// Reads data/binaries/multiples.tsv and promotes physical-pair
// secondaries not in AT-HYG into first-class catalog.bin records.
// See ./README.md § Companion promotion from `data/binaries/multiples.tsv`.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  FLAG_BINARY_COMPANION_ONLY,
  FLAG_BINARY_COMPANION_SYNTHETIC,
  NO_CONSTELLATION_INDEX,
  OPTICAL_DOUBLE_MIN_SEP_PC,
  absoluteToApparentMagnitude,
  apparentToAbsoluteMagnitude,
  parseGaiaSourceIdStr,
} from '../catalog-pure';
import {
  SPECTRAL_UNKNOWN,
  type SpectralInfo,
  classifyFromSimbad,
  resolveSpectDisplay,
} from '../spectral/spectral-classify';
import {
  absmagFromSpectral,
  physicalRadius,
  spectralClassCi,
  spectralFromAbsmag,
} from '../spectral/physical-radius';
import { R_V, avSolToStar, type DustGrid } from '../distance/dust-deextinction-pure';
import {
  RIELLO_G_MINUS_V_SIGMA,
  vTierIsSystemBlend,
} from '../photometry/v-magnitude-pure';
import { REPO_ROOT } from '../../util/paths';
import { ARCSEC_TO_RAD } from '../../../src/client/util/astronomy-constants';
import { equatorialTangentBasisAt } from '../../../src/client/util/equatorial-basis';
import type { ConstellationAssignment } from '../parse/constellations';
import type { Star } from '../parse/stars-parse';

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

/** Source_ids whose system names more than one component, so the pair's other
 *  component has a record of its own for a second HD number to belong to.
 *
 *  Keyed on the system rather than on the source_id, because a secondary
 *  routinely carries its own source_id or none at all — grouping by source_id
 *  misses the sibling on exactly the resolved pairs this is asked about.
 *  Promotion can still decline to render a member row, so this is a superset of
 *  what ships; the label merge wants that direction
 *  (`../classic-ids/README.md` § An alias stops at the blend). */
export function sourceIdsWithSiblingComponent(
  rows: readonly MultiplesTsvRow[],
): Set<string> {
  const componentsBySystem = new Map<string, Set<string>>();
  for (const row of rows) {
    let comps = componentsBySystem.get(row.systemId);
    if (comps === undefined) componentsBySystem.set(row.systemId, (comps = new Set()));
    comps.add(row.comp);
  }
  const out = new Set<string>();
  for (const row of rows) {
    if (row.gaiaSourceId === null) continue;
    if ((componentsBySystem.get(row.systemId)?.size ?? 0) > 1) out.add(row.gaiaSourceId);
  }
  return out;
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
          `Re-run pnpm run build:binaries.`,
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

/** The Stage-6 pair table, named here because this module owns its shape —
 *  the parallax cascade's sibling index reads the same file. */
export const MULTIPLES_TSV = resolve(REPO_ROOT, 'data/binaries/multiples.tsv');

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
// at the primary's distance. theta is WDS position angle: degrees east of
// north, measured at the primary, resolved against the shared ICRS tangent
// basis the runtime's sky→ICRS orbit projection also rides.
export function projectFromSepPa(
  primaryX: number,
  primaryY: number,
  primaryZ: number,
  sepArcsec: number,
  paDeg: number,
): CompanionPlacement | null {
  const at = equatorialTangentBasisAt(primaryX, primaryY, primaryZ);
  if (at === null) return null;
  const { basis: { east, north }, rPc: distPc } = at;
  const paRad = paDeg * (Math.PI / 180.0);
  const sepRad = sepArcsec * ARCSEC_TO_RAD;
  const offsetN = sepRad * Math.cos(paRad);  // north component (rad)
  const offsetE = sepRad * Math.sin(paRad);  // east component (rad)
  // Small-angle: linear in parsecs at the primary's distance.
  const cx = primaryX + (offsetN * north.x + offsetE * east.x) * distPc;
  const cy = primaryY + (offsetN * north.y + offsetE * east.y) * distPc;
  const cz = primaryZ + (offsetN * north.z + offsetE * east.z) * distPc;
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
  /** Anchor records dimmed by the flux-conservation post-pass — the
   *  per-anchor joint subset solve judged ≥1 member's light embedded in
   *  the anchor's AT-HYG blend magnitude and re-split it. Counted once
   *  per anchor. */
  blendDimmedAnchors: number;
  /** Dim members reaching the subtraction but not applied: the guard
   *  M_member > M_blend + 0.05 (a member as bright as its anchor's blend would
   *  zero or invert the residual flux), or no observed magnitude to subtract at
   *  all — which only a structural member can be, since the fit already drops
   *  its own participants for that (`blendDimMembersUnfit`). */
  blendDimSkipped: number;
  /** Dim candidates no magnitude comparison could reach — no observed WDS
   *  magnitude for the member or the anchor, no distance, or a pathologically
   *  large fit group. Left un-dimmed. */
  blendDimMembersUnfit: number;
  /** Non-structural dim candidates the winning subset left OUT (or the
   *  whole fit was indecisive within the decisive margin): their light is
   *  not in the anchor's blend, so no dim. 36 Oph D vs A+B's blend. */
  blendDimMembersOutside: number;
  /** Dim candidates dropped before the fit because Gaia had already resolved
   *  them out of the anchor's magnitude — the member carries its own DR3
   *  source_id and the anchor's V came from Gaia's, so its light was never in
   *  there and dimming would subtract it twice. */
  blendDimGaiaResolved: number;
  /** Dim candidates dropped before the fit because the pair sits wider than the
   *  anchor tier's blending scale (or WDS published no separation at all), so no
   *  entry of that catalogue sums both. Structural members are exempt. */
  blendDimMembersBeyondSeparation: number;
  /** Dim candidates whose WINNING hypothesis still missed the anchor's observed
   *  magnitude by more than the input's error scale — the anchor matches
   *  neither "alone" nor any blend, so the fit's pick carries no information. */
  blendDimMembersMisfit: number;
  /** Promoted companions whose own positional constellation differs from
   *  their anchor's — a pair wide enough to straddle an IAU boundary. */
  constellationSplitFromAnchor: number;
  /** Pair rows refused because an identifier on them belongs to a parked
   *  record — mostly the parked primary's siblings, which inherit its blended
   *  source_id or HIP, rather than the parked record itself. See
   *  {@link ParkedIdentifiers}. Without this the parked list names rows that
   *  ship anyway. */
  droppedParkedRecord: number;
}

/** The identifiers of records the parallax cascade parked (§ 6.1 ledger). A
 *  pair row carrying one of them may not be promoted: multiples.tsv states a
 *  distance for every component, and for a parked row that distance is the
 *  measurement a tier above already refused — sigma Ori Aa's
 *  `hip2_long_baseline` 328.947 pc inverts to the 3.04 mas the S/N floor threw
 *  out. Promoting would re-serve it through the courier the skip rules exist to
 *  close.
 *
 *  **A sibling counts as carrying it.** Stage 2/3 bind one blended source to
 *  every component row of a sub-arcsec pair, so the parked primary's id sits on
 *  its siblings' rows too, and those rows state the same refused distance. The
 *  SID ledger records each as a presence event naming DR4 as the reinstating
 *  event, never a dissolution — the pair is unchanged. */
export interface ParkedIdentifiers {
  gaia: ReadonlySet<string>;
  hip: ReadonlySet<number>;
}

export function emptyParkedIdentifiers(): ParkedIdentifiers {
  return { gaia: new Set(), hip: new Set() };
}

/** The § 6.1 ledger rows keyed the way a pair row names them. Takes the
 *  structural minimum rather than `ParkedRecord`, so the promotion pass does
 *  not import the walk that produced it. */
export function parkedIdentifiers(
  parked: readonly { gaiaSourceId: string | null; hip: number | null }[],
): ParkedIdentifiers {
  const gaia = new Set<string>();
  const hip = new Set<number>();
  for (const p of parked) {
    if (p.gaiaSourceId !== null) gaia.add(p.gaiaSourceId);
    if (p.hip !== null && p.hip > 0) hip.add(p.hip);
  }
  return { gaia, hip };
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
    blendDimMembersUnfit: 0,
    blendDimMembersOutside: 0,
    blendDimGaiaResolved: 0,
    blendDimMembersBeyondSeparation: 0,
    blendDimMembersMisfit: 0,
    constellationSplitFromAnchor: 0,
    droppedParkedRecord: 0,
  };
}

/** Compose `synth-<wds_id>-<comp>`. See ./README.md § Companion promotion
 *  from `data/binaries/multiples.tsv` for when this fires. */
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

export interface PairCursor {
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
      absmag: apparentToAbsoluteMagnitude(ownWdsMag, distPc),
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

// The subset solve dims only when the winning membership hypothesis beats
// both "anchor alone" and the runner-up subset by this margin —
// near-degenerate cases (Sirius, Δmag≈10: hypotheses differ by ~10⁻⁴ mag)
// must not flip pinned values on float noise.
//
// A FLOOR, not the error budget. It sits at the Riello G−V scatter because a
// gaia_riello anchor's magnitude is only good to that σ, and no margin may
// discriminate below the noise in its own input. Two things it does NOT model:
// a printed-tier anchor never went through that relation (its σ is Hipparcos'
// printed precision), and the hypotheses are built from WDS observed-frame
// magnitudes whose error dominates both — face-value pair mags, some in
// non-V bands, at the ~0.1 mag level (README § Anchor flux conservation).
// Raising the margin toward that term is a calibration with count movement,
// not a constant swap.
const ANCHOR_DIM_DECISIVE_MAG = RIELLO_G_MINUS_V_SIGMA;

// 2^N subset enumeration cap. Real anchors carry ≤ ~6 fitted members; a
// larger group is pathological input, not a solvable attribution.
const ANCHOR_DIM_MAX_FIT_MEMBERS = 16;

// How far the WINNING hypothesis may sit from the anchor's observed magnitude
// before the fit is refused as matching nothing. Distinct from the decisive
// margin above, which compares hypotheses to each other and says nothing about
// whether any of them is right. Calibrated — README § Anchor flux conservation.
export const ANCHOR_DIM_MAX_FIT_RESIDUAL_MAG = 0.2;

// Angular scale beyond which a member's light cannot be inside the anchor's
// magnitude, per the catalogue that produced it. Both calibrated against the
// blend-vs-component hypothesis split over WDS pair magnitudes — README
// § The separation gate.
export const PRINTED_BLEND_MAX_SEP_ARCSEC = 10.0;
export const GAIA_BLEND_MAX_SEP_ARCSEC = 1.0;

/** Whether the anchor record's magnitude came from a catalogue tier at all — the
 *  precondition for any member's light being inside it. A minted companion
 *  (`vVia === null`) is per-component by construction; `none` is a record no
 *  cascade produced a V for.
 *
 *  Read off the RECORD, never a multiples.tsv `photometry_via` cell: those are
 *  frozen from the build that wrote the TSV and go stale under a membership
 *  swap — ξ UMa's AB row says `none` while the record carries a printed
 *  `I/239` blend, which is exactly the population that needs dimming. */
function anchorMagIsCatalogued(anchor: Star): boolean {
  return anchor.vVia !== null && anchor.vVia !== 'none';
}

/** Whether a member at this separation can be inside an entry that blends out
 *  to `maxSepArcsec`. A null separation is WDS publishing no measurement, which
 *  is no evidence of blending: excluded, so an unmeasured wide pair (AU Mic AB)
 *  never subtracts. Zero is a sub-resolution pair, the tightest case there is. */
function withinBlendSeparation(
  sepArcsec: number | null,
  maxSepArcsec: number,
): boolean {
  return sepArcsec !== null && sepArcsec <= maxSepArcsec;
}

/** Two designators at ONE level, which makes the token an unresolved COMPOUND:
 *  the aggregate of several components rather than one of them. Matches at any
 *  level, since WDS concatenates at whichever it is aggregating — `AB` and `ABC`
 *  at the top, `Aab` for Aa+Ab (multiples.tsv carries one, 15169-6057), `Aa12`
 *  for Aa1+Aa2. */
const COMPOUND_COMPONENT_LEVEL = /[A-Z]{2,}|[a-z]{2,}|\d{2,}/;

/** How many WDS designators deep a component letter sits: ``"A" → 1``,
 *  ``"Aa" → 2``, ``"Aa1" → 3``. Walks `parentComponentToken` rather than
 *  counting characters, so the two cannot drift on what a level is.
 *
 *  A compound scores 0 — less decomposed than any single letter, rather than the
 *  depth its length suggests. η CrB is the case that makes this load-bearing:
 *  its `AB,E` row prints `mag_pri` 4.98 for the A+B blend against the `AB` row's
 *  5.64 for A alone, so reading `AB` as deeper than `A` makes the blend the
 *  anchor's own light and stops the pair re-splitting at all. */
export function componentDepth(comp: string): number {
  const c = comp.trim();
  if (COMPOUND_COMPONENT_LEVEL.test(c)) return 0;
  let depth = 0;
  for (let tok: string | null = c; tok; tok = parentComponentToken(tok)) {
    depth++;
  }
  return depth;
}

/** The observed-frame geometry a dim candidate is judged on: which WDS magnitude
 *  is the member's own and which the anchor's, how deep the letter that anchor
 *  magnitude describes sits, and the pair's separation. A pair-row-primary
 *  escape heads its own sub-pair, so its `mag_pri` IS the member's light and its
 *  offset from the anchor is the Stage-6 root composition rather than the row's
 *  own sep. */
function anchorDimGeometry(row: MultiplesTsvRow, anchorComp: string): {
  memberWdsMag: number | null;
  anchorWdsMag: number | null;
  anchorDepth: number;
  sepArcsec: number | null;
} {
  const isPairRowPrimary = row.orbitRole === 'primary';
  return {
    memberWdsMag: isPairRowPrimary ? row.magPri : row.magSec,
    anchorWdsMag: isPairRowPrimary ? null : row.magPri,
    anchorDepth: componentDepth(anchorComp),
    sepArcsec: isPairRowPrimary ? row.anchorSepArcsec : row.sepArcsec,
  };
}

/** The anchor's own light: the `mag_pri` of its MOST-DECOMPOSED candidate row.
 *  WDS's `mag_pri` covers the whole subtree of whatever letter its row pairs, so
 *  a top-level row already sums the sub-letters and only the deepest names what
 *  the re-split's residual represents (AR Cas prints 4.87 for A, 5.02 for Aa).
 *
 *  Ties break BRIGHTEST, not faintest. Two rows at one depth are two
 *  measurements of the same letter's subtree, and their disagreement is band or
 *  epoch, never decomposition — taking the fainter would claim a split that is
 *  not there and hand the difference to the members. Brightest is the same
 *  conservative posture as the solve's smallest-winning-subset rule: it makes
 *  "anchor alone" fit better, so a dim needs more evidence, not less. */
function anchorAloneMagnitude(cands: AnchorDimCandidate[]): number | null {
  let best: { mag: number; depth: number } | null = null;
  for (const c of cands) {
    if (c.anchorWdsMag === null) continue;
    if (best === null
        || c.anchorDepth > best.depth
        || (c.anchorDepth === best.depth && c.anchorWdsMag < best.mag)) {
      best = { mag: c.anchorWdsMag, depth: c.anchorDepth };
    }
  }
  return best?.mag ?? null;
}

/** SpectralInfo for an existing catalog record, for re-deriving its
 *  radius after a brightness change. Re-parses the display string when
 *  possible; otherwise reconstructs the coarse class/lum fields the
 *  record already carries (subclass defaults to the mid-class 5). */
function recordSpectralInfo(star: Star): SpectralInfo {
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

/** Every name AT-HYG could be carrying this pair's secondary under, used
 *  only to find the collocated double entry it sometimes ships alongside
 *  the primary (see promoteRow). Not display names — the ladder composes
 *  those from structure (`../naming/README.md`). These probe AT-HYG's OWN
 *  convention, a name cell or the anchor's name with the component letter
 *  appended, against the records AT-HYG itself named; the index they hit
 *  holds nothing but spine `proper` cells, so a base composed off a Bayer
 *  or catalogue designation could never match one and none is tried. */
function athygDoubleProbeNames(
  ctx: PromoteRowContext,
  anchorStar: Star | null,
): string[] {
  const { row, anchorPrimaryRow, systemAnchorStar, canonicalComp } = ctx;
  if (!canonicalComp) return [];
  const bases = [
    row.name, anchorPrimaryRow.name, anchorStar?.proper ?? '',
    systemAnchorStar?.proper ?? '',
  ].map((b) => b.trim()).filter((b) => b !== '');
  return [...new Set(bases.map((base) => `${base} ${canonicalComp}`))];
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
 *  `04153-0739`; we want A as the system anchor, not B).
 *
 *  This anchor is a source of POSITION and velocity, which is why it is
 *  not the naming anchor: the two answer different questions, and
 *  `record-index/`'s branch-first rule would move records here. */
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
  /** Multiples row of the anchor primary — drives the inherited-HIP gate.
   *  For the secondary loop this is cursor.primary; for the pair-row-primary
   *  escape this is the WDS-root system anchor's primary row. */
  anchorPrimaryRow: MultiplesTsvRow;
  /** Catalog Star of the anchor primary — the inherited-HIP gate and the
   *  field-inheritance source. */
  anchorStar: Star | null;
  /** Catalog Star of the WDS-root system primary — the inheritance source
   *  when the local anchor is unresolved (δ Vel CD's local primary C never
   *  promotes). */
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
  /** Canonical comp letter for the row — drives the synthetic ID and,
   *  post-sort, the composer's component letter. */
  canonicalComp: string;
  /** True when this row is a pair-row-primary escape (the cursor primary
   *  itself, promoted as a companion of the WDS-root anchor); drives
   *  anchorDmagApplies=false in imputeCompanionAbsmag. */
  isPairRowPrimary: boolean;
}

interface PromotionState {
  existing: ExistingIndexes;
  parked: ParkedIdentifiers;
  existingStars: Star[];
  existingStarsLength: number;
  newStars: Star[];
  readonly conAssignment: ConstellationAssignment;
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
  /** `<anchorIdx> <memberIdx>` pairs already registered off an existing catalog
   *  record, so a member reached from two cursors subtracts its flux once. */
  existingDimMembers: Set<string>;
}

interface AnchorDimCandidate {
  anchorIdx: number;
  member: Star;
  memberSpectral: SpectralInfo;
  /** 'dmag_imputed' brightness is blend-relative (re-split by Δmag);
   *  'wds_mag' and 'own' carry independent member brightness (flux
   *  subtraction). */
  source: 'wds_mag' | 'dmag_imputed' | 'own';
  dmag: number | null;
  /** ids inherited-then-stripped from the anchor — the cross-match could not
   *  separate them. Skips the subset fit only where the anchor's magnitude is a
   *  system blend by construction; against a Gaia-derived V the shared
   *  identifier carries no photometric claim and the member is fitted. */
  structural: boolean;
  /** Member's own observed-frame WDS magnitude (mag_sec; mag_pri for a
   *  pair-row primary escape). */
  memberWdsMag: number | null;
  /** The anchor component's own observed WDS magnitude — the row's
   *  mag_pri when the member is its direct secondary; null on an escape
   *  row (its mag_pri is the member's own light). */
  anchorWdsMag: number | null;
  /** Depth of the component letter `anchorWdsMag` describes — the selector for
   *  which candidate row names the anchor's own light. */
  anchorDepth: number;
  /** Angular separation from the anchor (″) — the row's own sep for a direct
   *  secondary, the WDS-root offset for an escape row. */
  sepArcsec: number | null;
  av: number;
}

interface BlendSplitCandidate {
  star: Star;
  spectral: SpectralInfo;
}

/** Register an existing catalog record as one of its anchor's dim candidates.
 *
 *  A member that is already its own record never reaches the minting path below,
 *  so the subset solve could not see it and an anchor on a printed blend tier
 *  kept the pair's combined light (ξ UMa, ξ Sco, HD 75632 all shipped ~0.5–0.8
 *  mag too bright). The record's absmag is an independent measurement, so it
 *  enters as `source: 'own'` — flux subtraction, never the Δmag re-split, which
 *  would overwrite a first-class record's own brightness. */
function registerExistingMemberForAnchorDim(
  ctx: PromoteRowContext,
  state: PromotionState,
  memberIdx: number,
  dustGrid: DustGrid | null,
): void {
  const { row, anchorPrimaryRow, anchorStar, anchorCatalogIdx } = ctx;
  if (anchorCatalogIdx === null || anchorStar === null
      || memberIdx === anchorCatalogIdx
      || !anchorMagIsCatalogued(anchorStar)) {
    return;
  }
  // One subtraction per (anchor, member). The same record arrives here from
  // every cursor pairing it with the anchor, and a second registration would
  // subtract its flux twice.
  const pairKey = `${anchorCatalogIdx} ${memberIdx}`;
  if (state.existingDimMembers.has(pairKey)) return;
  state.existingDimMembers.add(pairKey);
  const member = state.existingStars[memberIdx];
  state.anchorDimCandidates.push({
    anchorIdx: anchorCatalogIdx,
    member,
    memberSpectral: recordSpectralInfo(member),
    source: 'own',
    dmag: row.dmag,
    structural: false,
    ...anchorDimGeometry(row, anchorPrimaryRow.comp),
    av: dustGrid ? avSolToStar(dustGrid, member.x, member.y, member.z) : 0,
  });
}

function promoteRow(
  ctx: PromoteRowContext,
  state: PromotionState,
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
      registerExistingMemberForAnchorDim(ctx, state, existingIdx, dustGrid);
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
        registerExistingMemberForAnchorDim(ctx, state, hipHit, dustGrid);
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
  // Runs BEFORE the inheritance gates below, which is what gives it reach:
  // Stage 2/3 bind one blended source to every component of a sub-arcsec pair,
  // so most rows caught here are the parked primary's SIBLINGS carrying its id,
  // not the parked record arriving twice. Either way the row's stated distance
  // is the primary's — the measurement a tier above refused — so promoting it
  // launders that refusal. Strip the ids first and the sibling would mint a
  // synth record at the refused distance instead.
  if ((row.gaiaSourceId !== null && state.parked.gaia.has(row.gaiaSourceId))
      || (rowHasOwnHip && state.parked.hip.has(row.hip as number))) {
    stats.droppedParkedRecord++;
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
  // System-level inheritance source: the local anchor primary, falling
  // back to the WDS-root system primary when the local anchor never made
  // it into the catalog (δ Vel CD class — local primary C never promotes).
  // Velocity and constellation are both whole-system properties and must
  // resolve the same anchor, else a companion inherits one but not the
  // other and desynchronises from its system.
  const inheritAnchor = anchorStar ?? systemAnchorStar;
  // Space-motion velocity: inherit the anchor's. A promoted companion
  // carries no own PM (multiples.tsv has no PM columns), and a Tier-3
  // static companion is baked into catalog.bin and SKIPPED by the runtime
  // BinaryOrbitField — only a shared velocity keeps it glued to the
  // primary through the epoch-advance pass instead of shearing away. The
  // systemic-velocity pass below reconciles the anchor's own velocity for
  // renderable-orbit pairs. Anchor-less escapes fall back to zero.
  const anchorVel = inheritAnchor
    ? { x: inheritAnchor.vx, y: inheritAnchor.vy, z: inheritAnchor.vz }
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
  if (anchorStar !== null && anchorCatalogIdx !== null) {
    for (const probe of athygDoubleProbeNames(ctx, anchorStar)) {
      const dupIdx = state.existing.byProper.get(probe);
      if (dupIdx === undefined || dupIdx === anchorCatalogIdx) continue;
      const dup = state.existingStars[dupIdx];
      if (dup.x === anchorStar.x && dup.y === anchorStar.y
          && dup.z === anchorStar.z) {
        dup.x = position.x;
        dup.y = position.y;
        dup.z = position.z;
        dup.conIndex = state.conAssignment.indexAt(position.x, position.y, position.z);
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
  if (usesSynth) flags |= FLAG_BINARY_COMPANION_SYNTHETIC;

  // Constellation: positional from the companion's own placement, so a pair
  // straddling a boundary lands its members on the correct sides. The
  // designation constellation is still the anchor's — a composed name
  // ("Xi Boo B") is named for whatever the primary's designation is.
  const conIndex = state.conAssignment.indexAt(position.x, position.y, position.z);
  const desigConIndex = inheritAnchor?.desigConIndex ?? NO_CONSTELLATION_INDEX;
  if (inheritAnchor !== null && conIndex !== inheritAnchor.conIndex) {
    stats.constellationSplitFromAnchor++;
  }

  state.newStars.push({
    x: position.x, y: position.y, z: position.z,
    vx: anchorVel.x, vy: anchorVel.y, vz: anchorVel.z,
    absmag, ci,
    spectClass: spectral.info.classIdx,
    lumClass: spectral.info.lumClass,
    physicalRadius: physicalRadius(absmag, spectral.info),
    conIndex,
    desigConIndex,
    flags,
    // Every display name is composed post-sort from the structured
    // designation set, so a minted record ships none of its own.
    proper: null,
    iauName: null,
    eponym: null,
    bayer: null,
    bayerSup: null,
    bayerComponent: null,
    gould: null,
    gouldHalf: null,
    aliases: [],
    hip: companionHip,
    hd: null,
    hr: null,
    // An anchor's alternative HD is often the pair's OTHER component number,
    // which makes handing it to this record tempting and wrong: the overlay
    // asserts both numbers against one Gaia source and names no component, so
    // attributing one here would invent evidence. They stay search aliases of
    // the record holding the blended light.
    hdAlt: [],
    hrAlt: [],
    flam: null,
    gl: null,
    tyc: null,
    gaiaSourceId: companionGaia,
    spectDisplay: spectral.display,
    companionIdx: -1,
    periodDays: 0,
    amplitudeMag: 0,
    varType: 0,
    gcvsName: null,
    plxDistPc: null,
    plxVia: null,
    // A promoted companion is placed at its anchor's distance, so it inherits
    // the anchor's tier rather than claiming a parallax of its own — the
    // optical-double suppression must weigh both members the same way. Null
    // where there is no anchor to inherit from, never `none`: that value is a
    // membership event, and this record ships.
    distVia: inheritAnchor?.distVia ?? null,
    vVia: null,
    syntheticId: usesSynth ? synthId : null,
  });
  const newIdx = state.existingStarsLength + state.newStars.length - 1;
  stats.promoted++;
  // Flux conservation: a member whose light is embedded in whatever
  // catalogue tier gave the anchor its V must dim the anchor or the
  // system double-counts it. Blend membership is structural for
  // inherited-then-stripped ids; every other own-brightness member
  // (identifier-carrying AND identifier-less synth alike) is a
  // candidate whose membership the post-pass subset solve decides —
  // see README § Anchor flux conservation. Deferred to a post-pass so
  // each anchor's members are judged jointly.
  if (OWN_BRIGHTNESS_ABSMAG_SOURCES.has(imputed.source)
      && anchorCatalogIdx !== null && anchorStar !== null
      && anchorMagIsCatalogued(anchorStar)) {
    state.anchorDimCandidates.push({
      anchorIdx: anchorCatalogIdx,
      member: state.newStars[state.newStars.length - 1],
      memberSpectral: spectral.info,
      source: imputed.source as 'wds_mag' | 'dmag_imputed' | 'own',
      dmag: row.dmag,
      structural: idsInheritedFromAnchor,
      ...anchorDimGeometry(row, anchorPrimaryRow.comp),
      av,
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
 *  duplicated. Returns the number of records backfilled.
 *
 *  `reclassify` runs once per backfilled record: spectral
 *  classification happened in readStars BEFORE this pass, keyed on the
 *  ids the record didn't yet carry, so the caller re-resolves it with
 *  the freshly stamped keys (ξ UMa classified unknown despite SIMBAD
 *  F8.5:V without this). */
export function backfillPrimaryIdentifiers(
  multiplesRows: MultiplesTsvRow[],
  stars: Star[],
  reclassify?: (star: Star) => void,
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
    if (wrote) {
      backfilled++;
      if (reclassify) reclassify(star);
    }
  }
  return backfilled;
}

export function promoteCompanions(
  multiplesRows: MultiplesTsvRow[],
  existingStars: Star[],
  conAssignment: ConstellationAssignment,
  dustGrid: DustGrid | null = null,
  parked: ParkedIdentifiers = emptyParkedIdentifiers(),
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
    parked,
    existingStars,
    existingStarsLength: existingStars.length,
    newStars,
    conAssignment,
    promotedByGaia: new Map(),
    promotedByHip: new Map(),
    promotedBySynth: new Map(),
    gaiaPhotometryByBackingSource: new Map(),
    anchorDimCandidates: [],
    existingDimMembers: new Set(),
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
  // walk. See docs/science-catalog-ingestion.md § Current-epoch star
  // positions (Composition with binary orbital motion).
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
          cursor, wdsRootAnchors, state, stats, dustGrid,
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
        cursor, wdsRootAnchors, state, stats, dustGrid,
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
        state, stats, dustGrid,
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

  // Anchor-dimming post-pass (flux conservation) — a per-anchor joint
  // subset solve. Each candidate member's light MAY be embedded in its
  // anchor's athyg_own blend magnitude; total system flux must stay what
  // AT-HYG measured. Membership: structural members (ids inherited-then-
  // stripped from the anchor) are always in; every other member is judged
  // by the best-fit subset — the hypothesis m(S) = −2.5·log₁₀(F_anchor +
  // Σ_{i∈S} F_i) over observed-frame WDS magnitudes that lands closest to
  // the anchor's observed apparent magnitude, decisive only when it beats
  // "anchor alone" AND the runner-up by ≥0.01 mag. This is what keeps a
  // multi-member anchor honest: 36 Oph D cannot claim A+B's blend (any
  // subset containing D fits worse than {A,B}), while Polaris Ab (inside
  // the 1.98 blend) dims its anchor ~0.16 mag.
  //
  // Apply (once per anchor, exact conservation): members with independent
  // brightness ('own' / 'wds_mag') subtract their actual flux; blend-
  // relative members ('dmag_imputed') re-split the residual by Δmag —
  //   F_A · (1 + Σ 10^(−0.4·Δ_i)) = F_blend − Σ F_own
  // generalising the pairwise M_A = M_blend + 2.5·log₁₀(1 + 10^(−0.4Δ)).
  // The relative split reduces to "anchor barely dims" for a faint
  // companion (Sirius B would shift 10⁻⁴ mag — blocked by the decisive
  // margin anyway) and to the equal split for Δ = 0 (Capella: a naive
  // subtraction would gut a near-equal anchor). The too-bright guard
  // skips an independent member whose light would zero or invert the
  // residual (counted blendDimSkipped, a ratchet).
  const dimByAnchor = new Map<number, AnchorDimCandidate[]>();
  for (const cand of state.anchorDimCandidates) {
    const bucket = dimByAnchor.get(cand.anchorIdx);
    if (bucket) bucket.push(cand);
    else dimByAnchor.set(cand.anchorIdx, [cand]);
  }
  for (const cands of dimByAnchor.values()) {
    const anchor = getStarAt(cands[0].anchorIdx);
    const anchorAloneMag = anchorAloneMagnitude(cands);
    // One A_V for the whole group: the dust grid is voxelised far coarser than
    // even the widest member's offset (σ Ori's E at 42″, AR Cas I at 234″), so
    // every candidate's sightline integral returns the same value and any of
    // them re-adds the same observed frame.
    const av = cands[0].av;
    // The anchor's own position, never a row's dist_pc: the record's absmag was
    // derived at exactly this distance, while a multiples.tsv row can carry a
    // system distance the record's override stack later replaced (HD 64315's
    // rows say 12.7 kpc against the record's B-J 6.2 kpc, a 1.5 mag error in
    // the observed frame every hypothesis below is compared against).
    const distPc = Math.hypot(anchor.x, anchor.y, anchor.z);
    const recordObsMag = (s: Star): number | null => {
      const d = Math.hypot(s.x, s.y, s.z);
      return d > 0 ? absoluteToApparentMagnitude(s.absmag, d) + av : null;
    };
    const mObs = distPc > 0 ? recordObsMag(anchor) : null;
    // ONE definition of a member's light, for the fit and the subtraction alike.
    // An independent-brightness member ships its own record, so the hypothesis
    // has to be built from the magnitude that record will actually contribute:
    // judging {B} on WDS's mag_sec and then subtracting a Gaia-measured value
    // leaves the emitted residual unbounded by the goodness-of-fit gate below —
    // HD 75632 B's own photometry is 0.47 mag off WDS's mag_sec, twice that
    // gate's whole budget. A dmag_imputed member has no independent measurement
    // (its absmag is anchor-relative and the apply step rewrites it), so the WDS
    // observed frame is the only evidence there is.
    const obsMag = (c: AnchorDimCandidate): number | null => {
      if (c.source !== 'dmag_imputed') {
        const measured = recordObsMag(c.member);
        if (measured !== null) return measured;
      }
      return c.memberWdsMag !== null ? c.memberWdsMag
        : c.anchorWdsMag !== null && c.dmag !== null ? c.anchorWdsMag + c.dmag
          : null;
    };

    // An anchor's magnitude holds exactly what the catalogue behind it could
    // not resolve. A printed tier resolves nothing inside one entry, so every
    // member sharing that entry is in it and skips the fit. A Gaia-derived V
    // resolves per source: a member Gaia handed its OWN source_id is separated
    // from the anchor by measurement (HD 153557's B at 5″, σ Ori's E at 42″)
    // and cannot be in its G, while a member with no own source is one Gaia
    // could not split — including one whose ids were the anchor's, where the
    // shared identifier now says only that the cross-match could not separate
    // them. Those go to the subset solve rather than straight into the blend.
    //
    // "OWN source_id" needs no comparison against the anchor's: promoteRow
    // nulls a minted member's gaiaSourceId whenever the row's source is the
    // anchor row's or the anchor record's, so non-null here already means
    // different. A member sharing the anchor's source arrives with null.
    //
    // Identity evidence answers that only where the catalogue published one; a
    // member with no own source has no such evidence, and photometry alone
    // cannot tell "inside the photocentre" from "525″ away". The tier's own
    // blending scale is the missing term — a member past it is outside the
    // entry no matter how well its flux happens to fit (AR Cas I at 234″,
    // σ Ori I at 525″, both held out until now only by the smallest-subset
    // tie-break).
    //
    // Structural members skip the bound in BOTH tiers: ids inherited from the
    // anchor mean the catalogue could not separate this pair, which is direct
    // evidence about it and outranks a population threshold. That is not the
    // same as bypassing the fit — only a printed tier's structural members do
    // that (above), and a Gaia tier's stay fit participants, where a shared
    // identifier says the cross-match could not separate them rather than that
    // the photometry blends.
    const anchorMagIsSystemBlend = vTierIsSystemBlend(anchor.vVia);
    const maxSepArcsec = anchorMagIsSystemBlend
      ? PRINTED_BLEND_MAX_SEP_ARCSEC : GAIA_BLEND_MAX_SEP_ARCSEC;
    const structural: AnchorDimCandidate[] = [];
    const fitted: AnchorDimCandidate[] = [];
    for (const c of cands) {
      if (anchorMagIsSystemBlend && c.structural) {
        structural.push(c);
      } else if (!anchorMagIsSystemBlend && c.member.gaiaSourceId !== null) {
        stats.blendDimGaiaResolved++;
      } else if (!c.structural
          && !withinBlendSeparation(c.sepArcsec, maxSepArcsec)) {
        stats.blendDimMembersBeyondSeparation++;
      } else {
        fitted.push(c);
      }
    }
    let chosen: AnchorDimCandidate[] = [];
    if (fitted.length > 0) {
      const participants = fitted.filter((c) => obsMag(c) !== null);
      stats.blendDimMembersUnfit += fitted.length - participants.length;
      if (anchorAloneMag === null || mObs === null || participants.length === 0
          || participants.length > ANCHOR_DIM_MAX_FIT_MEMBERS) {
        stats.blendDimMembersUnfit += participants.length;
      } else {
        const baseFlux = Math.pow(10, -0.4 * anchorAloneMag)
          + structural.reduce((f, c) => {
            const m = obsMag(c);
            return m !== null ? f + Math.pow(10, -0.4 * m) : f;
          }, 0);
        const fluxes = participants.map((c) => Math.pow(10, -0.4 * (obsMag(c) as number)));
        const errs = new Array<number>(1 << participants.length);
        for (let mask = 0; mask < errs.length; mask++) {
          let f = baseFlux;
          for (let i = 0; i < participants.length; i++) {
            if (mask & (1 << i)) f += fluxes[i];
          }
          errs[mask] = Math.abs(mObs - (-2.5 * Math.log10(f)));
        }
        // Hypotheses within the decisive margin of the best are an
        // equivalence class (a negligible-flux member toggles between two
        // subsets without moving the blend); pick the SMALLEST subset in
        // the class — conservative attribution, and float noise never
        // flips a pinned value. No dim when "anchor alone" is in the
        // class (the Sirius Δmag≈10 shape).
        const bestErr = Math.min(...errs);
        if (bestErr > ANCHOR_DIM_MAX_FIT_RESIDUAL_MAG) {
          // Closest is not close. Every hypothesis misses the anchor's observed
          // magnitude by more than the input's own error scale, so the winner
          // was picked out of a field of wrong answers and its membership claim
          // carries no information.
          stats.blendDimMembersMisfit += participants.length;
        } else if (errs[0] - bestErr < ANCHOR_DIM_DECISIVE_MAG) {
          stats.blendDimMembersOutside += participants.length;
        } else {
          let bestMask = 0;
          let bestBits = Infinity;
          for (let mask = 0; mask < errs.length; mask++) {
            if (errs[mask] - bestErr >= ANCHOR_DIM_DECISIVE_MAG) continue;
            let bits = 0;
            for (let i = 0; i < participants.length; i++) {
              if (mask & (1 << i)) bits++;
            }
            if (bits < bestBits || (bits === bestBits && errs[mask] < errs[bestMask])) {
              bestMask = mask;
              bestBits = bits;
            }
          }
          chosen = participants.filter((_, i) => (bestMask & (1 << i)) !== 0);
          stats.blendDimMembersOutside += participants.length - chosen.length;
        }
      }
    }

    const applied = [...structural, ...chosen];
    if (applied.length === 0) continue;
    if (mObs === null) {
      stats.blendDimMembersUnfit += applied.length;
      continue;
    }
    // Conservation is an OBSERVED-frame statement: the catalogue measured one
    // apparent brightness for the entry, so a member's flux comes out at the
    // magnitude the observer sees it at, never its absolute one. Identical for a
    // minted member — tangent projection places it at the anchor's distance —
    // but an already-in-catalog member carries its own, and ξ Sco B's is 3.4 pc
    // past A's.
    let ownFlux = 0;
    let appliedIndependents = 0;
    const relatives: Array<{ cand: AnchorDimCandidate; delta: number }> = [];
    for (const c of applied) {
      const memberMObs = obsMag(c);
      if (c.source === 'dmag_imputed') {
        const delta = anchorAloneMag !== null && memberMObs !== null
          ? memberMObs - anchorAloneMag : c.dmag;
        if (delta !== null) relatives.push({ cand: c, delta });
        continue;
      }
      if (memberMObs === null
          || !(memberMObs > mObs + ANCHOR_DIM_MIN_DELTA_MAG)) {
        stats.blendDimSkipped++;
        continue;
      }
      ownFlux += Math.pow(10, -0.4 * memberMObs);
      appliedIndependents++;
    }
    if (relatives.length === 0 && appliedIndependents === 0) continue;
    const residualFlux = Math.pow(10, -0.4 * mObs) - ownFlux;
    if (!(residualFlux > 0)) {
      stats.blendDimSkipped += appliedIndependents;
      continue;
    }
    const relSum = relatives.reduce((s, r) => s + Math.pow(10, -0.4 * r.delta), 0);
    const residualMObs = -2.5 * Math.log10(residualFlux / (1 + relSum));
    anchor.absmag = apparentToAbsoluteMagnitude(residualMObs - av, distPc);
    for (const { cand, delta } of relatives) {
      cand.member.absmag = anchor.absmag + delta;
      cand.member.physicalRadius = physicalRadius(
        cand.member.absmag, cand.memberSpectral,
      );
    }
    anchor.physicalRadius = physicalRadius(
      anchor.absmag, recordSpectralInfo(anchor),
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
  stats: PromotionStats,
  dustGrid: DustGrid | null,
): number | null {
  const primary = cursor.primary;
  if (primary === null) return null;
  // No own-identifier requirement: an id-less row (Rigel B or Acrux B
  // after the Stage-2 sibling-identity claims gate strips a stolen HIP)
  // mints a synth-<wds>-<comp> slot exactly like an identifier-less
  // secondary, and that key is fully addressable post-promotion. The
  // position and absmag requirements below still gate honesty; a
  // reappearing previously-retired component is reconciled in the SID
  // ledger via data/sid/reinstatements.tsv, never by dropping the star.
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
    state, stats, dustGrid,
  );
}
