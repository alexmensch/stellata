// Inner-pair re-home: re-place an inner pair's secondary off its true parent component. See README.md#inner-pair-re-home.

import {
  canonicalCompLetter, composeSyntheticId, parentComponentToken, wdsRootOf,
} from '../../../binaries/component-tokens-pure';
import type { Star } from '../../parse/stars-parse';
import { resolvePosition } from '../placement/placement';
import type { MintedIds } from '../identity/row-identity';
import type { PairCursor } from '../identity/system-index';

/** (WDS root, canonical component) → the record the walk resolved it to. */
export class ComponentSlots {
  private readonly slots = new Map<string, number>();

  private static key(root: string | null, comp: string): string | null {
    return root !== null && comp ? `${root} ${comp}` : null;
  }

  /** A cursor primary's slot; never overwrites, since a blended primary resolves onto a sibling. */
  claimByPrimary(root: string | null, comp: string, idx: number): void {
    const k = ComponentSlots.key(root, comp);
    if (k !== null && !this.slots.has(k)) this.slots.set(k, idx);
  }

  /** A promoted secondary's slot; authoritative, so it overwrites. */
  claimBySecondary(root: string | null, comp: string, idx: number): void {
    const k = ComponentSlots.key(root, comp);
    if (k !== null) this.slots.set(k, idx);
  }

  get(root: string | null, comp: string): number | undefined {
    const k = ComponentSlots.key(root, comp);
    return k === null ? undefined : this.slots.get(k);
  }
}

/** Returns the records it moved. */
export function reHomeInnerPairs(
  groups: Iterable<PairCursor>,
  slots: ComponentSlots,
  minted: MintedIds,
  starAt: (idx: number) => Star,
): Star[] {
  const moved: Star[] = [];
  for (const cursor of groups) {
    if (cursor.primary === null) continue;
    const parentTok = parentComponentToken(cursor.primary.comp);
    if (parentTok === null) continue;
    const parentIdx = minted.onSynth(composeSyntheticId(cursor.primary.systemId, parentTok))
      ?? slots.get(wdsRootOf(cursor.primary.systemId), parentTok);
    if (parentIdx === undefined) continue;
    const parentStar = starAt(parentIdx);
    const parentAnchor = { x: parentStar.x, y: parentStar.y, z: parentStar.z };
    for (const row of cursor.secondaries) {
      if (row.orbitRole !== 'secondary') continue;
      const secIdx = slots.get(wdsRootOf(row.systemId), canonicalCompLetter(cursor.primary.comp, row.comp));
      if (secIdx === undefined || secIdx === parentIdx) continue;
      const placed = resolvePosition(row, cursor.primary, parentAnchor);
      if (placed === null || placed === 'beyond-tidal') continue;
      const secStar = starAt(secIdx);
      if (secStar.x === placed.x && secStar.y === placed.y && secStar.z === placed.z) continue;
      secStar.x = placed.x;
      secStar.y = placed.y;
      secStar.z = placed.z;
      secStar.vx = parentStar.vx;
      secStar.vy = parentStar.vy;
      secStar.vz = parentStar.vz;
      moved.push(secStar);
    }
  }
  return moved;
}
