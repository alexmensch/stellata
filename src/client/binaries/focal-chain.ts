// Relation-index set on a focal star's slot-chain. See
// src/client/binaries/README.md § Walk-active LOD.

import { NO_PARENT, type BinariesData } from './binaries-loader';

/** Every relation that writes the focal's slot (focal as primary or
 *  secondary) plus their `parentRelation` ancestors — the set
 *  `BinaryOrbitField` keeps LOD-exempt (both members' positions stay live)
 *  and the connector layer draws links for. Empty when `focalIdx` is null. */
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
