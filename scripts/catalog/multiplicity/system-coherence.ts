/** Intra-system radial coherence: own-record members of a physical WDS
 *  system move to the system's best-tier distance anchor. See
 *  /scripts/catalog/multiplicity/README.md#system-distance-coherence. */

import type { Star } from '../parse/stars-parse';
import type { Hip2AstrometryRow } from '../sources/hip2-source';
import type { GaiaAstrometryRow } from '../sources/gaia-astrometry-source';
import type { MultiplesTsvRow } from '../companions/companion-promotion';
import { wdsRootOf } from '../../binaries/component-tokens-pure';
import type { BailerJonesIndex } from '../distance/refinement/distance-overrides-pure';
import { sourceRowRef, type AnySourceRowRef } from '../../util/sources/row-ref-pure';
import { isCoherenceAnchorGrade } from './anchor-grade-pure';
import { absoluteMagnitude, apparentMagnitude } from '../../../src/astro-core/perceptual-magnitude';

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
 *  two catalog distances genuinely disagree and the member keeps its
 *  own. The same relative bound gates the anchor's own rendered
 *  distance against its parallax evidence (see the placement-
 *  consistency gate in systemCoherenceVerdicts). */
export const COHERENCE_NO_SIGMA_MAX_RELATIVE_GAP = 0.2;
export const COHERENCE_NO_SIGMA_MIN_GAP_PC = 1.0;

/** Best first, and purpose-aware rather than recency-aware: HIP2's long
 *  baseline outranks Gaia exactly where Gaia is saturated or
 *  binarity-corrupted. */
export const ANCHOR_TIERS = ['gaia-clean', 'hip2', 'bailer-jones', 'inherited'] as const;
export type AnchorTier = (typeof ANCHOR_TIERS)[number];

export interface CoherenceSources {
  gaiaAstrometry: Map<string, GaiaAstrometryRow>;
  hip2: Map<number, Hip2AstrometryRow>;
  /** Only membership is consulted for the tier pick. */
  bailerJones: BailerJonesIndex;
}

/** An anchor tier and the row it rests on; the inherited tier rests on none. */
export type AnchorBasis =
  | { readonly tier: 'inherited' }
  | { readonly tier: Exclude<AnchorTier, 'inherited'>; readonly ref: AnySourceRowRef };

export type CoherenceAnchor = AnchorBasis & {
  readonly idx: number;
  readonly memberWon: boolean;
  readonly precisionVetoed: boolean;
};

export type MemberVerdict =
  | { readonly kind: 'snapped'; readonly idx: number; readonly fromPc: number; readonly toPc: number }
  | { readonly kind: 'at-anchor-distance'; readonly idx: number }
  | { readonly kind: 'significant-depth'; readonly idx: number; readonly gapPc: number; readonly sigmaPc: number }
  | { readonly kind: 'wide-gap'; readonly idx: number; readonly gapPc: number }
  | { readonly kind: 'member-unplaced'; readonly idx: number };

/** `members` omits the anchor and any record an earlier verdict decided. */
export type SystemVerdict =
  | { readonly kind: 'coherent'; readonly root: string; readonly anchor: CoherenceAnchor;
    readonly anchorPc: number; readonly members: readonly MemberVerdict[] }
  | { readonly kind: 'anchor-inconsistent'; readonly root: string; readonly anchor: CoherenceAnchor;
    readonly anchorPc: number; readonly parallaxPc: number; readonly sigmaPc: number;
    readonly members: readonly number[] }
  | { readonly kind: 'anchor-unplaced'; readonly root: string; readonly anchor: CoherenceAnchor;
    readonly members: readonly number[] };

const COMPONENT_TOKEN_RE = /^[A-Z][a-z]?\d?$/;

interface AnchorRank {
  tier: number;
  fracError: number | null;
  primarySide: number;
  letter: string;
}

/** see README.md#system-distance-coherence Why precision sits between side
 *  and letter */
function rankBeats(rank: AnchorRank, best: AnchorRank | null): boolean {
  if (best === null) return true;
  if (rank.tier !== best.tier) return rank.tier < best.tier;
  if (rank.primarySide !== best.primarySide) return rank.primarySide < best.primarySide;
  if (rank.tier === ANCHOR_TIERS.indexOf('gaia-clean') && rank.fracError !== best.fracError) {
    return morePrecise(rank.fracError, best.fracError);
  }
  return rank.letter < best.letter;
}

function morePrecise(a: number | null, b: number | null): boolean {
  return a !== null && (b === null || a < b);
}

function fractionalError(plxMas: number | null, errMas: number | null): number | null {
  return plxMas !== null && plxMas > 0 && errMas !== null ? errMas / plxMas : null;
}

type AnchorEvidence = AnchorBasis & { readonly fracError: number | null };

/** The member's anchor tier, the row that earned it, and the fractional
 *  parallax error of that fit — null below the HIP2 tier, which carries no
 *  trusted fit. See README.md#system-distance-coherence Precision veto. */
function anchorEvidence(
  star: Star, sources: CoherenceSources, hostsSubsystem: boolean,
): AnchorEvidence {
  // A component that hosts its own sub-pair (Acrux C = Ca,Cb) is an
  // unresolved close binary whatever its RUWE says — photocentre wobble
  // on periods longer than Gaia's baseline corrupts the 5p parallax
  // without tripping the RUWE gate (C sits at 1.32) — so it never
  // takes the clean-Gaia anchor tier. HIP2 and below still apply:
  // the long baseline averages orbital wobble by design.
  if (!hostsSubsystem && star.gaiaSourceId !== null) {
    const g = sources.gaiaAstrometry.get(star.gaiaSourceId);
    if (g !== undefined && isCoherenceAnchorGrade(g)) {
      return { tier: 'gaia-clean', fracError: fractionalError(g.parallaxMas, g.parallaxErrorMas), ref: g.ref };
    }
  }
  if (star.hip !== null) {
    const h = sources.hip2.get(star.hip);
    if (h !== undefined) {
      return { tier: 'hip2', fracError: fractionalError(h.plxMas, h.plxErrorMas), ref: h.ref };
    }
  }
  if (star.gaiaSourceId !== null && sources.bailerJones.distPc.has(star.gaiaSourceId)) {
    return {
      tier: 'bailer-jones', fracError: null, ref: sourceRowRef(sources.bailerJones.source, star.gaiaSourceId),
    };
  }
  return { tier: 'inherited', fracError: null };
}

/** Best available (distance_pc, sigma_pc) measurement for the record,
 *  independent of which override chain set its catalog distance: any
 *  Gaia 5p parallax first (quality-flagged or not — the σ carries the
 *  quality), then HIP2. Null when neither exists — an inherited or
 *  position-matched distance with no error model. */
function parallaxDistanceWithError(
  star: Star, sources: CoherenceSources,
): { distPc: number; sigmaPc: number } | null {
  const invert = (plxMas: number | null, errMas: number | null) =>
    plxMas !== null && plxMas > 0
      ? {
        distPc: 1000 / plxMas,
        sigmaPc: errMas !== null ? (1000 * errMas) / (plxMas * plxMas) : 0,
      }
      : null;
  const g = star.gaiaSourceId !== null
    ? sources.gaiaAstrometry.get(star.gaiaSourceId) : undefined;
  const fromGaia = g !== undefined ? invert(g.parallaxMas, g.parallaxErrorMas) : null;
  if (fromGaia !== null) return fromGaia;
  const h = star.hip !== null ? sources.hip2.get(star.hip) : undefined;
  return h !== undefined ? invert(h.plxMas, h.plxErrorMas) : null;
}

type Position = Pick<Star, 'x' | 'y' | 'z'>;

function starDist(p: Position): number {
  return Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
}

/** The one place a record's position is scaled: the verdict pass reads a
 *  snapped record's later distance from it, and the move writes it. */
function scaledPosition(p: Position, scale: number): Position {
  return { x: p.x * scale, y: p.y * scale, z: p.z * scale };
}

/** Move `star` radially to `distPc`, preserving its (mas-accurate)
 *  measured direction. Apparent brightness is invariant: absmag is
 *  re-derived at the new distance and the Stefan-Boltzmann radius follows
 *  (R ∝ √L at fixed Teff). */
function repositionRadially(star: Star, distPc: number): void {
  const dOld = starDist(star);
  Object.assign(star, scaledPosition(star, distPc / dOld));
  const absmag = absoluteMagnitude(apparentMagnitude(star.absmag, dOld), distPc);
  star.physicalRadius *= Math.pow(10, (star.absmag - absmag) / 5);
  star.absmag = absmag;
}

/** Group the pair rows of `multiplesRows` by WDS root and, per system,
 *  pick the best-tier member record as the distance anchor and decide, for
 *  every other member, whether its radial gap from the anchor is a ≥3σ
 *  measurement or it moves to the anchor's distance along its own direction.
 *  Moves nothing: applySystemCoherence acts on the verdicts.
 *
 *  Physicality is inherited from Stage 5: multiples.tsv pair rows ARE
 *  the kept-physical set (WDS-notes / orbit / separation / escape-
 *  velocity / CPM-baseline gates) — standalone rows never
 *  participate. Runs BEFORE companion promotion so minted
 *  members project off already-coherent anchors. */
export function systemCoherenceVerdicts(
  multiplesRows: readonly MultiplesTsvRow[],
  stars: readonly Star[],
  sources: CoherenceSources,
): SystemVerdict[] {
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

  const verdicts: SystemVerdict[] = [];
  const movedDist = new Map<number, number>();
  const distOf = (idx: number): number => movedDist.get(idx) ?? starDist(stars[idx]);
  const processed = new Set<number>();
  for (const [root, members] of systems) {
    if (members.size < 2) continue;
    const rootTokens = tokensByRoot.get(root) ?? new Set<string>();
    const hostsSubsystem = (info: MemberInfo): boolean => {
      for (const t of rootTokens) {
        // parent of "Ca" is "C"; of "Aa1" is "Aa".
        const parent = t.length > 1 ? t.slice(0, -1) : null;
        if (parent !== null && info.tokens.has(parent)) return true;
      }
      return false;
    };

    type Candidate = { idx: number; rank: AnchorRank; evidence: AnchorEvidence };
    let best: Candidate | null = null;
    let bestPrimary: Candidate | null = null;
    for (const [idx, info] of members) {
      // The WDS-canonical letter is the last tie-break (the record holding
      // 'A' beats one holding 'C' — catalog index order is pre-sort CSV
      // order and means nothing).
      let minToken = '';
      for (const t of info.tokens) {
        if (minToken === '' || t < minToken) minToken = t;
      }
      const evidence = anchorEvidence(stars[idx], sources, hostsSubsystem(info));
      const rank: AnchorRank = {
        tier: ANCHOR_TIERS.indexOf(evidence.tier),
        fracError: evidence.fracError,
        primarySide: info.isPrimary ? 0 : 1,
        letter: minToken,
      };
      if (rankBeats(rank, best?.rank ?? null)) best = { idx, rank, evidence };
      if (info.isPrimary && rankBeats(rank, bestPrimary?.rank ?? null)) bestPrimary = { idx, rank, evidence };
    }
    if (best === null) throw new Error(`system coherence: root ${root} has members but no anchor`);
    // see README.md#system-distance-coherence Precision veto
    let precisionVetoed = false;
    if (best.rank.primarySide === 1 && bestPrimary !== null
      && morePrecise(bestPrimary.rank.fracError, best.rank.fracError)) {
      best = bestPrimary;
      precisionVetoed = true;
    }
    const { fracError: _, ...basis } = best.evidence;
    const anchor: CoherenceAnchor = {
      ...basis, idx: best.idx, memberWon: best.rank.primarySide === 1, precisionVetoed,
    };
    const undecided = (): number[] => [...members.keys()]
      .filter((idx) => idx !== anchor.idx && !processed.has(idx));
    const anchorStar = stars[anchor.idx];
    const anchorDist = distOf(anchor.idx);
    if (!(anchorDist > 0) || !Number.isFinite(anchorDist)) {
      verdicts.push({ kind: 'anchor-unplaced', root, anchor, members: undecided() });
      continue;
    }
    const anchorPlx = parallaxDistanceWithError(anchorStar, sources);
    // An anchor whose rendered catalog distance contradicts its own
    // parallax evidence would drag every member onto a bogus placement
    // (μ¹ Sco: B-J puts the RUWE-corrupted source at 1.7 kpc while its
    // parallaxes measure ~150-530 pc; μ² Sco's honest 176 pc must not
    // follow it). Members keep their own distances instead.
    if (anchorPlx !== null) {
      const placementGap = Math.abs(anchorDist - anchorPlx.distPc);
      if (
        placementGap > COHERENCE_RADIAL_SIGMA * anchorPlx.sigmaPc
        && placementGap > COHERENCE_NO_SIGMA_MAX_RELATIVE_GAP * anchorDist
      ) {
        verdicts.push({
          kind: 'anchor-inconsistent', root, anchor, anchorPc: anchorDist,
          parallaxPc: anchorPlx.distPc, sigmaPc: anchorPlx.sigmaPc, members: undecided(),
        });
        continue;
      }
    }

    const decided: MemberVerdict[] = [];
    for (const idx of undecided()) {
      processed.add(idx);
      const member = stars[idx];
      const memberPlx = parallaxDistanceWithError(member, sources);
      if (memberPlx !== null) {
        const sigma = Math.hypot(memberPlx.sigmaPc, anchorPlx?.sigmaPc ?? 0);
        const gap = Math.abs(memberPlx.distPc - (anchorPlx?.distPc ?? anchorDist));
        if (sigma > 0 && gap > COHERENCE_RADIAL_SIGMA * sigma) {
          decided.push({ kind: 'significant-depth', idx, gapPc: gap, sigmaPc: sigma });
          continue;
        }
      } else {
        const gap = Math.abs(starDist(member) - anchorDist);
        if (
          gap > COHERENCE_NO_SIGMA_MIN_GAP_PC
          && gap > COHERENCE_NO_SIGMA_MAX_RELATIVE_GAP * anchorDist
        ) {
          decided.push({ kind: 'wide-gap', idx, gapPc: gap });
          continue;
        }
      }
      const dOld = starDist(member);
      if (!(dOld > 0) || !Number.isFinite(dOld)) {
        decided.push({ kind: 'member-unplaced', idx });
        continue;
      }
      const scale = anchorDist / dOld;
      if (Math.abs(scale - 1) < 1e-9) {
        decided.push({ kind: 'at-anchor-distance', idx });
        continue;
      }
      movedDist.set(idx, starDist(scaledPosition(member, scale)));
      decided.push({ kind: 'snapped', idx, fromPc: dOld, toPc: anchorDist });
    }
    processed.add(anchor.idx);
    verdicts.push({ kind: 'coherent', root, anchor, anchorPc: anchorDist, members: decided });
  }
  return verdicts;
}

/** Moves every snapped member of `verdicts` onto its anchor's distance. */
export function applySystemCoherence(stars: Star[], verdicts: readonly SystemVerdict[]): void {
  for (const v of verdicts) {
    if (v.kind !== 'coherent') continue;
    for (const m of v.members) if (m.kind === 'snapped') repositionRadially(stars[m.idx], m.toPc);
  }
}
