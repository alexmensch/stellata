// Star-index pairs the focus-gated binary connector draws links between.
// See src/client/binaries/README.md § Binary link layer.

import { type BinariesData } from './binaries-loader';
import { focalChainRelationSet } from './focal-chain';

/** The `[primaryIdx, secondaryIdx]` slot pairs of every relation on the
 *  focused star's slot-chain. Empty with no binaries data or no star
 *  focus, so the layer hides itself outside a focused multi-star system. */
export function binaryLinkPairs(
  binaries: BinariesData | null,
  focalIdx: number | null,
): Array<[number, number]> {
  if (binaries === null || focalIdx === null) return [];
  const pairs: Array<[number, number]> = [];
  for (const ri of focalChainRelationSet(binaries, focalIdx)) {
    const r = binaries.relations[ri];
    pairs.push([r.primaryIdx, r.secondaryIdx]);
  }
  return pairs;
}
