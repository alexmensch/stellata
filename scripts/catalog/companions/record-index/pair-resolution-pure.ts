// Each multiples.tsv pair's two ends as catalog records, resolved once for every post-sort reader. See README.md.

import { NO_PARENT } from '../../../../src/catalog-format/binaries/binaries-format';
import { composeSyntheticId, parentComponentToken } from '../../../binaries/component-tokens-pure';
import {
  assignParentRelations, topologicalWalkOrder, type MultiplesPair,
} from '../../../binaries/pairs-pure';
import { resolveMultiplesIdx, synthSlotIdx, type CatalogRowIndexMap } from './catalog-row-index-map-pure';
import type { PairEnds } from './pair-ends-pure';

export interface ResolvedPair {
  readonly pair: MultiplesPair;
  /** Each end through its own row's identifiers. */
  readonly own: PairEnds;
  /** README.md#the-parent-re-home. */
  readonly rendered: PairEnds;
}

function resolveEnd(
  systemId: string, gaia: string | null, hip: number | null, comp: string, map: CatalogRowIndexMap,
): number | null {
  const synth = composeSyntheticId(systemId, comp);
  const id = resolveMultiplesIdx(gaia, hip, synth, map);
  return id === null ? null : synthSlotIdx(synth, map, id) ?? id;
}

/** Walked outer-first, so a deeper nest takes its parent's re-homed slot. */
function reHomeInnerPrimaries(
  pairs: readonly MultiplesPair[],
  own: readonly PairEnds[],
): PairEnds[] {
  const parents = assignParentRelations(pairs);
  const primary = own.map((e) => e.primary);
  for (const i of topologicalWalkOrder(parents)) {
    const parentI = parents[i];
    if (parentI === NO_PARENT) continue;
    const parentTok = parentComponentToken(pairs[i].primaryComp);
    const pp = pairs[parentI];
    let slot: number | null;
    if (parentTok !== null && pp.primaryComp === parentTok) slot = primary[parentI];
    else if (parentTok !== null && pp.secondaryComp === parentTok) slot = own[parentI].secondary;
    else throw new Error(`pair ${pairs[i].systemId}: parent pair ${pp.systemId} names no end ${parentTok ?? '(none)'}`);
    if (slot !== null) primary[i] = slot;
  }
  return own.map((e, i) => ({ primary: primary[i], secondary: e.secondary }));
}

export function resolvePairs(
  pairs: readonly MultiplesPair[],
  map: CatalogRowIndexMap,
): ResolvedPair[] {
  const own = pairs.map((p): PairEnds => ({
    primary: resolveEnd(p.systemId, p.primaryGaia, p.primaryHip, p.primaryComp, map),
    secondary: resolveEnd(p.systemId, p.secondaryGaia, p.secondaryHip, p.secondaryComp, map),
  }));
  const rendered = reHomeInnerPrimaries(pairs, own);
  return pairs.map((pair, i) => ({ pair, own: own[i], rendered: rendered[i] }));
}

/** Two distinct records: the pair draws a companion apart from its primary. */
export function distinctEnds(ends: PairEnds): ends is { primary: number; secondary: number } {
  return ends.primary !== null && ends.secondary !== null && ends.primary !== ends.secondary;
}
