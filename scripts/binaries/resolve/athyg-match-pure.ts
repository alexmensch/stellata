// The WDS-pair → AT-HYG position match Stages 2 and 3 share. See README.md#the-at-hyg-position-match.

import { unitVectorFromRaDec, type SkyPosition } from '../../../src/astro-core/equatorial-basis';
import { DEG_TO_RAD } from '../../../src/astro-core/astronomy-constants';
import { canonicalCompLetter, pairComponentTokens } from '../component-tokens-pure';
import type { AthygRow } from '../load/athyg-pure';
import { pyMod } from '../python-float-pure';
import {
  ATHYG_REFERENCE_EPOCH, COS_DEC_FLOOR, WDS_PRECISE_COORD_EPOCH, chordSqForTolerance, unitChordSq, predictSecondaryPosition, propagatePosition,
} from '../sky-geometry-pure';
import {
  componentsOf, findOwningPair, pairRows, pairsByDiscoverer, type DecomposedPair, type ResolvedComponent,
} from './components-pure';
import { OWN, inheritedFrom, type IdOrigin } from '../multiples-tsv';
import { measuredOffset, splitComponents, type WdsPair } from '../../wds/wds-pure';
import { buildSystemHipClaims, hipClaimedByDisjointLetter } from './sibling-identity-pure';
import { pushTo } from '../../util/map-buckets-pure';

/** Below the typical AT-HYG inter-source separation outside the densest clusters. */
export const ATHYG_POSITION_MATCH_TOLERANCE_ARCSEC = 2.0;

export function athygPositionAtEpoch(row: AthygRow, targetEpoch: number): SkyPosition {
  return propagatePosition(
    { raDeg: row.raDeg, decDeg: row.decDeg },
    { pmRaMasyr: row.pmRaMasyr, pmDecMasyr: row.pmDecMasyr },
    ATHYG_REFERENCE_EPOCH, targetEpoch,
  );
}

/** AT-HYG row indices in 1°×1° cells, Dec shifted to non-negative. */
export type AthygGrid = ReadonlyMap<number, readonly number[]>;

const cellKey = (raCell: number, decCell: number): number => raCell * 1000 + decCell;

export function buildAthygGrid(athyg: readonly AthygRow[]): AthygGrid {
  const grid = new Map<number, number[]>();
  athyg.forEach((row, i) => pushTo(grid, cellKey(Math.trunc(row.raDeg) % 360, Math.trunc(row.decDeg) + 90), i));
  return grid;
}

export function findNearestAthyg(
  pos: SkyPosition, grid: AthygGrid, athyg: readonly AthygRow[], toleranceArcsec: number,
  excludeIdx: number | null, targetEpoch: number | null,
): number | null {
  const cosDec = Math.max(Math.cos(pos.decDeg * DEG_TO_RAD), COS_DEC_FLOOR);
  const epochPad = targetEpoch === null ? 0 : 1;
  const raWindow = Math.max(1, Math.ceil(1 / cosDec)) + epochPad;
  const decPad = 1 + epochPad;
  const baseRa = Math.trunc(pos.raDeg) % 360;
  const baseDec = Math.trunc(pos.decDeg) + 90;
  const q = unitVectorFromRaDec(pos.raDeg, pos.decDeg);

  let bestIdx: number | null = null;
  let best = Infinity;
  for (let dDec = -decPad; dDec <= decPad; dDec++) {
    for (let dRa = -raWindow; dRa <= raWindow; dRa++) {
      const raCell = pyMod(baseRa + dRa, 360);
      for (const i of grid.get(cellKey(raCell, baseDec + dDec)) ?? []) {
        if (i === excludeIdx) continue;
        const row = athyg[i];
        const cand = targetEpoch === null ? row : athygPositionAtEpoch(row, targetEpoch);
        const d = unitChordSq(unitVectorFromRaDec(cand.raDeg, cand.decDeg), q);
        if (d < best) {
          best = d;
          bestIdx = i;
        }
      }
    }
  }
  return bestIdx === null || best > chordSqForTolerance(toleranceArcsec) ? null : bestIdx;
}

/** README.md#the-at-hyg-position-match */
export function matchAthygEitherEpoch(
  pos: SkyPosition, grid: AthygGrid, athyg: readonly AthygRow[], toleranceArcsec: number, excludeIdx: number | null,
): number | null {
  return findNearestAthyg(pos, grid, athyg, toleranceArcsec, excludeIdx, WDS_PRECISE_COORD_EPOCH)
    ?? findNearestAthyg(pos, grid, athyg, toleranceArcsec, excludeIdx, null);
}

export interface AthygMatch {
  /** Into `componentsOf(pairs)`. */
  readonly componentIdx: number;
  readonly athygIdx: number;
  /** Inherited: a secondary riding its primary's row because its own predicted match missed. */
  readonly origin: IdOrigin;
}

/** A matched row whose HIP a disjoint, non-partner letter of the system already binds. */
export interface SiblingClaimedMatch {
  readonly componentIdx: number;
  readonly hip: number;
}

export interface AthygMatchOptions {
  /** Components that take no part. */
  readonly skip: (i: number, c: ResolvedComponent) => boolean;
}

/** Primaries match the pair's precise coord; secondaries the (ρ, θ)-predicted
 *  position, the primary's row excluded. A ρ = 0 or unmeasured pair predicts
 *  nothing: the prediction would sit on the primary, and with its row
 *  excluded only a different component's row could win. */
export function pairAthygMatches(
  pairs: readonly DecomposedPair[], athyg: readonly AthygRow[], opts: AthygMatchOptions,
): { matches: readonly AthygMatch[]; siblingClaimed: readonly SiblingClaimedMatch[] } {
  const grid = buildAthygGrid(athyg);
  const components = componentsOf(pairs);
  const index = pairsByDiscoverer(pairRows(pairs));
  const claims = buildSystemHipClaims(components);
  const primaryIdxByPair = new Map<WdsPair, number>();
  const matches: AthygMatch[] = [];
  const siblingClaimed: SiblingClaimedMatch[] = [];

  const claimedBySibling = (componentIdx: number, athygIdx: number, token: string, partner: string): boolean => {
    const hip = athyg[athygIdx].hip;
    if (hip === null) return false;
    const blocked = hipClaimedByDisjointLetter(claims, components[componentIdx].wdsId, hip, token, partner);
    if (blocked) siblingClaimed.push({ componentIdx, hip });
    return blocked;
  };

  components.forEach((c, i) => {
    if (opts.skip(i, c) || !c.isPrimary) return;
    const pair = findOwningPair(c, index);
    if (pair === null || pair.precise === null) return;
    const match = matchAthygEitherEpoch(pair.precise, grid, athyg, ATHYG_POSITION_MATCH_TOLERANCE_ARCSEC, null);
    if (match === null) return;
    const [, partner] = pairComponentTokens(pair.components)!;
    if (claimedBySibling(i, match, c.component, partner)) return;
    primaryIdxByPair.set(pair, match);
    matches.push({ componentIdx: i, athygIdx: match, origin: OWN });
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
      match = matchAthygEitherEpoch(predicted, grid, athyg, ATHYG_POSITION_MATCH_TOLERANCE_ARCSEC, primaryIdx);
    }
    const [primaryToken] = splitComponents(pair.components)!;
    if (match !== null && !claimedBySibling(i, match, canonicalCompLetter(primaryToken, c.component), primaryToken)) {
      matches.push({ componentIdx: i, athygIdx: match, origin: OWN });
      return;
    }
    if (primaryIdx !== null) {
      matches.push({ componentIdx: i, athygIdx: primaryIdx, origin: inheritedFrom(primaryToken, 'blend') });
    }
  });

  return { matches, siblingClaimed };
}
