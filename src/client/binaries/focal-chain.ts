// Relation-index set on a focal star's slot-chain. See
// src/client/binaries/README.md § Walk-active LOD.

import { NO_PARENT, type BinariesData } from './binaries-loader';

/** Every relation that writes the focal's slot (focal as primary or
 *  secondary) plus their `parentRelation` ancestors — the set
 *  `BinaryOrbitField` keeps LOD-exempt (both members' positions stay live)
 *  and the orbit-path layer traces. Empty when `focalIdx` is null. */
export function focalChainRelationSet(
  binaries: BinariesData,
  focalIdx: number | null,
): Set<number> {
  const out = new Set<number>();
  if (focalIdx === null) return out;
  const stack: number[] = [];
  const primRels = binaries.primaryIdxToRelations.get(focalIdx);
  if (primRels) for (const ri of primRels) stack.push(ri);
  const secRels = binaries.secondaryIdxToRelations.get(focalIdx);
  if (secRels) for (const ri of secRels) stack.push(ri);
  while (stack.length > 0) {
    const ri = stack.pop() as number;
    if (out.has(ri)) continue;
    out.add(ri);
    const parent = binaries.relations[ri].parentRelation;
    if (parent !== NO_PARENT) stack.push(parent);
  }
  return out;
}

/** The innermost pair `starIdx` is itself a member of, or `NO_PARENT` when
 *  it is a member of none. Relations are stored outer-before-inner with
 *  `parentRelation` always below the child's index, so the highest index
 *  among the ones naming this star directly is the deepest.
 *
 *  Ancestors are excluded, unlike `focalChainRelationSet` — README
 *  § Which pair a star rides. */
export function innermostRelationOf(
  binaries: BinariesData,
  starIdx: number,
): number {
  let best = NO_PARENT;
  for (const map of [binaries.primaryIdxToRelations, binaries.secondaryIdxToRelations]) {
    const rels = map.get(starIdx);
    if (rels) for (const ri of rels) if (ri > best) best = ri;
  }
  return best;
}
