// Systemic velocity: the members of each renderable-orbit system share one velocity. See README.md#systemic-velocity.

import type { Star } from '../../parse/stars-parse';

interface SystemicGroup {
  anchorIdx: number | null;
  pairs: { pIdx: number; sIdx: number; q: number }[];
}

/** Renderable-orbit pairs per WDS root, gathered during the walk and reconciled after it. */
export class SystemicGroups {
  private readonly byRoot = new Map<string, SystemicGroup>();

  add(root: string, anchorIdx: number | null, pIdx: number, sIdx: number, q: number): void {
    let g = this.byRoot.get(root);
    if (g === undefined) {
      g = { anchorIdx, pairs: [] };
      this.byRoot.set(root, g);
    }
    if (g.anchorIdx === null) g.anchorIdx = anchorIdx;
    g.pairs.push({ pIdx, sIdx, q });
  }

  /** Writes each group's systemic velocity onto its members. */
  reconcile(starAt: (idx: number) => Star): void {
    for (const g of this.byRoot.values()) {
      if (g.pairs.length === 1) {
        const { pIdx, sIdx, q } = g.pairs[0];
        const p = starAt(pIdx);
        const s = starAt(sIdx);
        const w = Math.max(0, Math.min(1, q));
        const vx = (1 - w) * p.vx + w * s.vx;
        const vy = (1 - w) * p.vy + w * s.vy;
        const vz = (1 - w) * p.vz + w * s.vz;
        p.vx = vx; p.vy = vy; p.vz = vz;
        s.vx = vx; s.vy = vy; s.vz = vz;
      } else {
        const a = starAt(g.anchorIdx ?? g.pairs[0].pIdx);
        const av = { x: a.vx, y: a.vy, z: a.vz };
        for (const { pIdx, sIdx } of g.pairs) {
          for (const idx of [pIdx, sIdx]) {
            const star = starAt(idx);
            star.vx = av.x; star.vy = av.y; star.vz = av.z;
          }
        }
      }
    }
  }
}
