/** Physical record overlaps: README.md#overlap-gate. */

import { R_SUN_PC } from '../../../src/client/util/astronomy-constants';

export interface OverlapRecord {
  x: number;
  y: number;
  z: number;
  /** Solar radii. */
  physicalRadius: number;
}

function orbitHierarchy<T>(orbitPairs: ReadonlyArray<readonly [T, T]>): (r: T) => T {
  const parent = new Map<T, T>();
  const find = (r: T): T => {
    let root = r;
    for (let p = parent.get(root); p !== undefined && p !== root; p = parent.get(root)) root = p;
    return root;
  };
  for (const [a, b] of orbitPairs) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  return find;
}

export function physicalOverlaps<T extends OverlapRecord>(
  records: readonly T[],
  orbitPairs: ReadonlyArray<readonly [T, T]>,
): Array<[T, T]> {
  let maxRadius = 0;
  for (const r of records) {
    if (r.physicalRadius > maxRadius) maxRadius = r.physicalRadius;
  }
  const maxReach = 2 * maxRadius * R_SUN_PC;
  const hierarchy = orbitHierarchy(orbitPairs);
  const order = Array.from(records.keys()).sort((i, j) => records[i].x - records[j].x);
  const out: Array<[T, T]> = [];
  for (let s = 0; s < order.length; s++) {
    const a = records[order[s]];
    for (let t = s + 1; t < order.length; t++) {
      const b = records[order[t]];
      if (b.x - a.x >= maxReach) break;
      const reach = (a.physicalRadius + b.physicalRadius) * R_SUN_PC;
      if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) >= reach) continue;
      if (hierarchy(a) === hierarchy(b)) continue;
      out.push(order[s] < order[t] ? [a, b] : [b, a]);
    }
  }
  return out;
}
