/** Physical record overlaps: README.md#overlap-gate. */

import { R_SUN_PC } from '../../../src/client/util/astronomy-constants';

export interface OverlapRecord {
  x: number;
  y: number;
  z: number;
  /** Solar radii. */
  physicalRadius: number;
}

export type OverlapExemption = (a: number, b: number) => boolean;

/** The exemption rule: README.md#overlap-gate. */
export function orbitChainExemption(
  relations: ReadonlyArray<readonly [number, number]>,
): OverlapExemption {
  const children = new Map<number, number[]>();
  for (const [p, c] of relations) {
    const list = children.get(p);
    if (list) list.push(c); else children.set(p, [c]);
  }
  const descends = (from: number, to: number): boolean => {
    const seen = new Set<number>([from]);
    const stack = [from];
    while (stack.length > 0) {
      for (const c of children.get(stack.pop() as number) ?? []) {
        if (c === to) return true;
        if (!seen.has(c)) { seen.add(c); stack.push(c); }
      }
    }
    return false;
  };
  return (a, b) => descends(a, b) || descends(b, a);
}

/** Index pairs `[i, j]`, `i < j`, of records drawn inside one another at the
 *  32-bit positions catalog.bin ships. */
export function physicalOverlaps(
  records: readonly OverlapRecord[],
  exempt: OverlapExemption,
): Array<[number, number]> {
  let maxRadius = 0;
  for (const r of records) {
    if (r.physicalRadius > maxRadius) maxRadius = r.physicalRadius;
  }
  const maxReach = 2 * maxRadius * R_SUN_PC;
  const shipped = records.map((r) => ({
    x: Math.fround(r.x), y: Math.fround(r.y), z: Math.fround(r.z),
    physicalRadius: r.physicalRadius,
  }));
  const order = Array.from(shipped.keys()).sort((i, j) => shipped[i].x - shipped[j].x);
  const out: Array<[number, number]> = [];
  for (let s = 0; s < order.length; s++) {
    const a = shipped[order[s]];
    for (let t = s + 1; t < order.length; t++) {
      const b = shipped[order[t]];
      if (b.x - a.x >= maxReach) break;
      const reach = (a.physicalRadius + b.physicalRadius) * R_SUN_PC;
      if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) >= reach) continue;
      const i = Math.min(order[s], order[t]);
      const j = Math.max(order[s], order[t]);
      if (exempt(i, j)) continue;
      out.push([i, j]);
    }
  }
  return out.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
}
