// The WDS-pair → catalogue-star position match Stages 2 and 3 share. See README.md#the-position-match.

import { directionAtEpoch, unitVectorFromRaDec, type SkyPosition, type UnitVector } from '../../../src/astro-core/equatorial-basis';
import { DEG_TO_RAD } from '../../../src/astro-core/astronomy-constants';
import { canonicalCompLetter, pairComponentTokens } from '../component-tokens-pure';
import type { AthygRow } from '../load/athyg-pure';
import { pyMod } from '../../../src/astro-core/angles';
import {
  ATHYG_REFERENCE_EPOCH, COS_DEC_FLOOR, WDS_PRECISE_COORD_EPOCH, chordSqForTolerance, unitChordSq, predictSecondaryPosition,
} from '../sky-geometry-pure';
import {
  componentsOf, findOwningPair, pairRows, pairsByDiscoverer, type DecomposedPair, type ResolvedComponent,
} from './components-pure';
import { OWN, inheritedFrom, type IdOrigin } from '../multiples-record-pure';
import { measuredOffset, splitComponents, type WdsPair } from '../../wds/wds-pure';
import { buildSystemHipClaims, hipClaimedByDisjointLetter } from './sibling-identity-pure';
import { pushTo } from '../../util/map-buckets-pure';

/** Below the typical inter-source separation outside the densest clusters. */
export const POSITION_MATCH_TOLERANCE_ARCSEC = 2.0;

/** README.md#the-position-match */
export interface MatchStar {
  readonly raDeg: number;
  readonly decDeg: number;
  readonly hip: number | null;
  readonly readings: readonly UnitVector[];
}

export function athygDirectionAtEpoch(row: AthygRow, targetEpoch: number): UnitVector {
  return directionAtEpoch(
    { raDeg: row.raDeg, decDeg: row.decDeg },
    { pmRaMasyr: row.pmRaMasyr, pmDecMasyr: row.pmDecMasyr },
    ATHYG_REFERENCE_EPOCH, targetEpoch,
  );
}

/** README.md#the-position-match: propagated to the WDS epoch, then as stored. */
export function athygMatchStars(athyg: readonly AthygRow[]): readonly MatchStar[] {
  return athyg.map((row) => ({
    raDeg: row.raDeg, decDeg: row.decDeg, hip: row.hip,
    readings: [athygDirectionAtEpoch(row, WDS_PRECISE_COORD_EPOCH), unitVectorFromRaDec(row.raDeg, row.decDeg)],
  }));
}

/** Star indices in 1°×1° cells, Dec shifted to non-negative. */
export type StarGrid = ReadonlyMap<number, readonly number[]>;

const cellKey = (raCell: number, decCell: number): number => raCell * 1000 + decCell;

export function buildStarGrid(stars: readonly MatchStar[]): StarGrid {
  const grid = new Map<number, number[]>();
  stars.forEach((s, i) => pushTo(grid, cellKey(Math.trunc(s.raDeg) % 360, Math.trunc(s.decDeg) + 90), i));
  return grid;
}

export function findNearestStar(
  pos: SkyPosition, grid: StarGrid, stars: readonly MatchStar[], toleranceArcsec: number,
  excludeIdx: number | null, reading: number,
): number | null {
  const cosDec = Math.max(Math.cos(pos.decDeg * DEG_TO_RAD), COS_DEC_FLOOR);
  const raWindow = Math.max(1, Math.ceil(1 / cosDec)) + 1;
  const baseRa = Math.trunc(pos.raDeg) % 360;
  const baseDec = Math.trunc(pos.decDeg) + 90;
  const q = unitVectorFromRaDec(pos.raDeg, pos.decDeg);

  let bestIdx: number | null = null;
  let best = Infinity;
  for (let dDec = -2; dDec <= 2; dDec++) {
    for (let dRa = -raWindow; dRa <= raWindow; dRa++) {
      const raCell = pyMod(baseRa + dRa, 360);
      for (const i of grid.get(cellKey(raCell, baseDec + dDec)) ?? []) {
        if (i === excludeIdx) continue;
        const cand = stars[i].readings[reading];
        if (cand === undefined) continue;
        const d = unitChordSq(cand, q);
        if (d < best) {
          best = d;
          bestIdx = i;
        }
      }
    }
  }
  return bestIdx === null || best > chordSqForTolerance(toleranceArcsec) ? null : bestIdx;
}

function matchAnyReading(
  pos: SkyPosition, grid: StarGrid, stars: readonly MatchStar[], readings: number, excludeIdx: number | null,
): number | null {
  for (let r = 0; r < readings; r++) {
    const hit = findNearestStar(pos, grid, stars, POSITION_MATCH_TOLERANCE_ARCSEC, excludeIdx, r);
    if (hit !== null) return hit;
  }
  return null;
}

export interface PositionMatch {
  /** Into `componentsOf(pairs)`. */
  readonly componentIdx: number;
  readonly starIdx: number;
  /** Inherited: a secondary riding its primary's star because its own predicted match missed. */
  readonly origin: IdOrigin;
}

/** A matched star whose HIP a disjoint, non-partner letter of the system already binds. */
export interface SiblingClaimedMatch {
  readonly componentIdx: number;
  readonly hip: number;
}

export interface PositionMatchOptions {
  /** Components that take no part. */
  readonly skip: (i: number, c: ResolvedComponent) => boolean;
}

/** Primaries match the pair's precise coord; secondaries the (ρ, θ)-predicted
 *  position, the primary's star excluded. A ρ = 0 or unmeasured pair predicts
 *  nothing: the prediction would sit on the primary, and with its star
 *  excluded only a different component's star could win. */
export function pairPositionMatches(
  pairs: readonly DecomposedPair[], stars: readonly MatchStar[], opts: PositionMatchOptions,
): { matches: readonly PositionMatch[]; siblingClaimed: readonly SiblingClaimedMatch[] } {
  const grid = buildStarGrid(stars);
  const readings = stars.reduce((n, s) => Math.max(n, s.readings.length), 0);
  const components = componentsOf(pairs);
  const index = pairsByDiscoverer(pairRows(pairs));
  const claims = buildSystemHipClaims(components);
  const primaryIdxByPair = new Map<WdsPair, number>();
  const matches: PositionMatch[] = [];
  const siblingClaimed: SiblingClaimedMatch[] = [];

  const claimedBySibling = (componentIdx: number, starIdx: number, token: string, partner: string): boolean => {
    const hip = stars[starIdx].hip;
    if (hip === null) return false;
    const blocked = hipClaimedByDisjointLetter(claims, components[componentIdx].wdsId, hip, token, partner);
    if (blocked) siblingClaimed.push({ componentIdx, hip });
    return blocked;
  };

  components.forEach((c, i) => {
    if (opts.skip(i, c) || !c.isPrimary) return;
    const pair = findOwningPair(c, index);
    if (pair === null || pair.precise === null) return;
    const match = matchAnyReading(pair.precise, grid, stars, readings, null);
    if (match === null) return;
    const [, partner] = pairComponentTokens(pair.components)!;
    if (claimedBySibling(i, match, c.component, partner)) return;
    primaryIdxByPair.set(pair, match);
    matches.push({ componentIdx: i, starIdx: match, origin: OWN });
  });

  components.forEach((c, i) => {
    if (opts.skip(i, c) || c.isPrimary) return;
    const pair = findOwningPair(c, index);
    if (pair === null || pair.precise === null) return;
    const primaryIdx = primaryIdxByPair.get(pair) ?? null;
    let match: number | null = null;
    const offset = measuredOffset(pair);
    if (offset !== null) {
      const predicted = predictSecondaryPosition(pair.precise, offset);
      match = matchAnyReading(predicted, grid, stars, readings, primaryIdx);
    }
    const [primaryToken] = splitComponents(pair.components)!;
    if (match !== null && !claimedBySibling(i, match, canonicalCompLetter(primaryToken, c.component), primaryToken)) {
      matches.push({ componentIdx: i, starIdx: match, origin: OWN });
      return;
    }
    if (primaryIdx !== null) {
      matches.push({ componentIdx: i, starIdx: primaryIdx, origin: inheritedFrom(primaryToken, pair.rhoLast === 0 ? 'blend' : 'partner') });
    }
  });

  return { matches, siblingClaimed };
}
