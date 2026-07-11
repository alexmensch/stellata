/** Intra-system radial coherence: own-record members of a physical WDS
 *  system move to the system's best-tier distance anchor. See
 *  scripts/catalog/README.md § System distance coherence. */

import type { Star } from './stars-parse';
import type {
  GaiaAstrometryCatalogRow,
  Hip2AstrometryRow,
} from './direction-cascade';
import { GAIA_RUWE_UNRELIABLE_THRESHOLD } from './direction-cascade';
import type { MultiplesTsvRow } from './companion-promotion';
import { wdsRootOf } from './companion-promotion';

/** Gaia saturates brighter than G ≈ 3; a brighter source's 5p parallax
 *  is not trustworthy enough to anchor a system's distance. */
export const GAIA_UNSATURATED_G_MIN = 3.0;

/** Gaia's ipd_frac_multi_peak is a PERCENT (0–100), not a fraction —
 *  AU Mic carries 1 (1%, clean). Distinct from direction-cascade's
 *  GAIA_IPD_FRAC_MULTI_PEAK_THRESHOLD = 0.02, which compares the same
 *  column on the fraction scale (tracked as a bead — its effect is
 *  masked by the NSS-membership requirement). */
export const ANCHOR_IPD_MAX_PERCENT = 2.0;

/** A member snaps to the anchor distance only when the radial gap is
 *  NOT significant at this many sigma of the combined parallax error —
 *  the mirror of Stage 5's RADIAL_SEPARATION_SIGMA. A significant gap
 *  is genuinely measured depth (α Cen–Proxima's 0.06 pc, 61 Cyg A/B)
 *  and must survive. */
export const COHERENCE_RADIAL_SIGMA = 3.0;

/** Members with no parallax error model still carry a catalog distance
 *  claim (AT-HYG HIP / SIMBAD-era values); without a σ to test against,
 *  a snap is only trusted across a gap within this fraction of the
 *  anchor distance (or 1 pc for nearby systems). Wider gaps mean the
 *  two catalog distances genuinely disagree (μ² Sco at 176 pc against
 *  a 1.7 kpc anchor) and the member keeps its own. */
export const COHERENCE_NO_SIGMA_MAX_RELATIVE_GAP = 0.2;
export const COHERENCE_NO_SIGMA_MIN_GAP_PC = 1.0;

/** Distance-anchor quality tiers, best first. Purpose-aware, not
 *  recency-aware: HIP2's long baseline beats Gaia exactly where Gaia is
 *  saturated or binarity-corrupted (Acrux), while a clean unsaturated
 *  Gaia 5p beats HIP2 everywhere else. */
export const ANCHOR_TIER_GAIA_CLEAN = 0;
export const ANCHOR_TIER_HIP2 = 1;
export const ANCHOR_TIER_BAILER_JONES = 2;
export const ANCHOR_TIER_INHERITED = 3;

export interface SystemCoherenceStats {
  systemsProcessed: number;
  membersRepositioned: number;
  memberAnchorWins: number;
  significantDepthKept: number;
}

export interface CoherenceSources {
  gaiaAstrometry: Map<string, GaiaAstrometryCatalogRow>;
  hip2: Map<number, Hip2AstrometryRow>;
  /** Bailer-Jones source_id (decimal string) → distance; only
   *  membership is consulted for the tier pick. */
  bjMap: Map<string, number>;
}

const COMPONENT_TOKEN_RE = /^[A-Z][a-z]?\d?$/;

function anchorTier(
  star: Star, sources: CoherenceSources, hostsSubsystem: boolean,
): number {
  // A component that hosts its own sub-pair (Acrux C = Ca,Cb) is an
  // unresolved close binary whatever its RUWE says — photocentre wobble
  // on periods longer than Gaia's baseline corrupts the 5p parallax
  // without tripping the RUWE gate (C sits at 1.32) — so it never
  // takes the clean-Gaia anchor tier. HIP2 and below still apply:
  // the long baseline averages orbital wobble by design.
  if (!hostsSubsystem && star.gaiaSourceId !== null) {
    const g = sources.gaiaAstrometry.get(star.gaiaSourceId);
    if (
      g !== undefined
      && g.parallaxMas !== null && g.parallaxMas > 0
      && (g.ruwe === null || g.ruwe <= GAIA_RUWE_UNRELIABLE_THRESHOLD)
      && (g.ipdFracMultiPeak === null
        || g.ipdFracMultiPeak <= ANCHOR_IPD_MAX_PERCENT)
      && g.gMag !== null && g.gMag >= GAIA_UNSATURATED_G_MIN
    ) {
      return ANCHOR_TIER_GAIA_CLEAN;
    }
  }
  if (star.hip !== null && sources.hip2.has(star.hip)) {
    return ANCHOR_TIER_HIP2;
  }
  if (star.gaiaSourceId !== null && sources.bjMap.has(star.gaiaSourceId)) {
    return ANCHOR_TIER_BAILER_JONES;
  }
  return ANCHOR_TIER_INHERITED;
}

/** Best available (distance_pc, sigma_pc) measurement for the record,
 *  independent of which override chain set its catalog distance: any
 *  Gaia 5p parallax first (quality-flagged or not — the σ carries the
 *  quality), then HIP2. Null when neither exists — an inherited or
 *  position-matched distance with no error model. */
function parallaxDistanceWithError(
  star: Star, sources: CoherenceSources,
): { distPc: number; sigmaPc: number } | null {
  if (star.gaiaSourceId !== null) {
    const g = sources.gaiaAstrometry.get(star.gaiaSourceId);
    if (g !== undefined && g.parallaxMas !== null && g.parallaxMas > 0) {
      const distPc = 1000 / g.parallaxMas;
      const sigmaPc = g.parallaxErrorMas !== null
        ? (1000 * g.parallaxErrorMas) / (g.parallaxMas * g.parallaxMas)
        : 0;
      return { distPc, sigmaPc };
    }
  }
  if (star.hip !== null) {
    const h = sources.hip2.get(star.hip);
    if (h !== undefined && h.plxMas !== null && h.plxMas > 0) {
      const distPc = 1000 / h.plxMas;
      const sigmaPc = h.plxErrorMas !== null
        ? (1000 * h.plxErrorMas) / (h.plxMas * h.plxMas)
        : 0;
      return { distPc, sigmaPc };
    }
  }
  return null;
}

function starDist(star: Star): number {
  return Math.sqrt(star.x * star.x + star.y * star.y + star.z * star.z);
}

/** Move `star` radially to `distPc`, preserving its (mas-accurate)
 *  measured direction. Apparent brightness is invariant: absmag shifts
 *  by 5·log10(d_old/d_new) and the Stefan-Boltzmann radius follows
 *  (R ∝ √L at fixed Teff). */
function repositionRadially(star: Star, distPc: number): boolean {
  const dOld = starDist(star);
  if (!(dOld > 0) || !Number.isFinite(dOld)) return false;
  const scale = distPc / dOld;
  if (Math.abs(scale - 1) < 1e-9) return false;
  star.x *= scale;
  star.y *= scale;
  star.z *= scale;
  const dAbsmag = 5 * Math.log10(dOld / distPc);
  star.absmag += dAbsmag;
  star.physicalRadius *= Math.pow(10, -dAbsmag / 5);
  return true;
}

/** Group the pair rows of `multiplesRows` by WDS root and, per system,
 *  pick the best-tier member record as the distance anchor; every other
 *  member whose radial gap from the anchor is not a ≥3σ measurement
 *  moves to the anchor's distance along its own direction.
 *
 *  Physicality is inherited from Stage 5: multiples.tsv pair rows ARE
 *  the kept-physical set (WDS-notes / orbit / separation / escape-
 *  velocity / CPM-baseline gates) — standalone rows never
 *  participate. Runs BEFORE companion promotion so minted
 *  members project off already-coherent anchors. */
export function applySystemDistanceCoherence(
  multiplesRows: MultiplesTsvRow[],
  stars: Star[],
  sources: CoherenceSources,
): SystemCoherenceStats {
  const stats: SystemCoherenceStats = {
    systemsProcessed: 0,
    membersRepositioned: 0,
    memberAnchorWins: 0,
    significantDepthKept: 0,
  };

  const byGaia = new Map<string, number>();
  const byHip = new Map<number, number>();
  for (let i = 0; i < stars.length; i++) {
    const s = stars[i];
    if (s.gaiaSourceId !== null && !byGaia.has(s.gaiaSourceId)) {
      byGaia.set(s.gaiaSourceId, i);
    }
    if (s.hip !== null && !byHip.has(s.hip)) byHip.set(s.hip, i);
  }

  interface MemberInfo {
    isPrimary: boolean;
    tokens: Set<string>;
  }
  const systems = new Map<string, Map<number, MemberInfo>>();
  // Every component token seen per root — child tokens mark their
  // parent as hosting a subsystem (Ca,Cb under C).
  const tokensByRoot = new Map<string, Set<string>>();
  for (const row of multiplesRows) {
    if (row.orbitRole === 'standalone') continue;
    if (!COMPONENT_TOKEN_RE.test(row.comp)) continue;
    const root = wdsRootOf(row.systemId);
    if (root === null) continue;
    let rootTokens = tokensByRoot.get(root);
    if (rootTokens === undefined) {
      rootTokens = new Set();
      tokensByRoot.set(root, rootTokens);
    }
    rootTokens.add(row.comp);
    const idx = row.gaiaSourceId !== null
      ? byGaia.get(row.gaiaSourceId)
      : undefined;
    const resolved = idx
      ?? (row.hip !== null && row.hip > 0 ? byHip.get(row.hip) : undefined);
    if (resolved === undefined) continue;
    let members = systems.get(root);
    if (members === undefined) {
      members = new Map();
      systems.set(root, members);
    }
    let info = members.get(resolved);
    if (info === undefined) {
      info = { isPrimary: false, tokens: new Set() };
      members.set(resolved, info);
    }
    info.isPrimary = info.isPrimary || row.orbitRole === 'primary';
    info.tokens.add(row.comp);
  }

  const processed = new Set<number>();
  for (const [root, members] of systems) {
    if (members.size < 2) continue;
    stats.systemsProcessed++;
    const rootTokens = tokensByRoot.get(root) ?? new Set<string>();
    const hostsSubsystem = (info: MemberInfo): boolean => {
      for (const t of rootTokens) {
        // parent of "Ca" is "C"; of "Aa1" is "Aa".
        const parent = t.length > 1 ? t.slice(0, -1) : null;
        if (parent !== null && info.tokens.has(parent)) return true;
      }
      return false;
    };

    let anchorIdx: number | null = null;
    let anchorRank: [number, number, string] | null = null;
    for (const [idx, info] of members) {
      // Tier, then pair-primary side, then the WDS-canonical letter
      // (the record holding 'A' beats one holding 'C' — catalog index
      // order is pre-sort CSV order and means nothing).
      let minToken = '';
      for (const t of info.tokens) {
        if (minToken === '' || t < minToken) minToken = t;
      }
      const rank: [number, number, string] = [
        anchorTier(stars[idx], sources, hostsSubsystem(info)),
        info.isPrimary ? 0 : 1, minToken,
      ];
      if (
        anchorRank === null
        || rank[0] < anchorRank[0]
        || (rank[0] === anchorRank[0] && rank[1] < anchorRank[1])
        || (rank[0] === anchorRank[0] && rank[1] === anchorRank[1]
          && rank[2] < anchorRank[2])
      ) {
        anchorRank = rank;
        anchorIdx = idx;
      }
    }
    if (anchorIdx === null) continue;
    const anchorStar = stars[anchorIdx];
    const anchorDist = starDist(anchorStar);
    if (!(anchorDist > 0) || !Number.isFinite(anchorDist)) continue;
    if (anchorRank !== null && anchorRank[1] === 1) stats.memberAnchorWins++;
    const anchorPlx = parallaxDistanceWithError(anchorStar, sources);

    for (const idx of members.keys()) {
      if (idx === anchorIdx || processed.has(idx)) continue;
      processed.add(idx);
      const member = stars[idx];
      const memberPlx = parallaxDistanceWithError(member, sources);
      if (memberPlx !== null) {
        const sigma = Math.hypot(memberPlx.sigmaPc, anchorPlx?.sigmaPc ?? 0);
        const gap = Math.abs(memberPlx.distPc - (anchorPlx?.distPc ?? anchorDist));
        if (sigma > 0 && gap > COHERENCE_RADIAL_SIGMA * sigma) {
          stats.significantDepthKept++;
          continue;
        }
      } else {
        const gap = Math.abs(starDist(member) - anchorDist);
        if (
          gap > COHERENCE_NO_SIGMA_MIN_GAP_PC
          && gap > COHERENCE_NO_SIGMA_MAX_RELATIVE_GAP * anchorDist
        ) {
          stats.significantDepthKept++;
          continue;
        }
      }
      if (repositionRadially(member, anchorDist)) {
        stats.membersRepositioned++;
      }
    }
    processed.add(anchorIdx);
  }
  return stats;
}
