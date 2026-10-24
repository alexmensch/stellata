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

export function orbitHierarchyExemption(
  relations: ReadonlyArray<readonly [number, number]>,
): OverlapExemption {
  const parent = new Map<number, number>();
  const find = (r: number): number => {
    let root = r;
    for (let p = parent.get(root); p !== undefined && p !== root; p = parent.get(root)) root = p;
    return root;
  };
  for (const [a, b] of relations) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  return (a, b) => find(a) === find(b);
}

/** Index pairs `[i, j]`, `i < j`, of records drawn inside one another. */
export function physicalOverlaps(
  records: readonly OverlapRecord[],
  exempt: OverlapExemption,
): Array<[number, number]> {
  let maxRadius = 0;
  for (const r of records) {
    if (r.physicalRadius > maxRadius) maxRadius = r.physicalRadius;
  }
  const maxReach = 2 * maxRadius * R_SUN_PC;
  const order = Array.from(records.keys()).sort((i, j) => records[i].x - records[j].x);
  const out: Array<[number, number]> = [];
  for (let s = 0; s < order.length; s++) {
    const a = records[order[s]];
    for (let t = s + 1; t < order.length; t++) {
      const b = records[order[t]];
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
