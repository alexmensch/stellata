// The compaction kernel's side of the refill: append a star the view holds,
// the cache gate admits and the generation has not stamped to its residue's
// sub-list. README.md § The compaction appends the worklist.

import { If, atomicAdd, distance, float, max, uint, vec4 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { REFILL_LIST_COUNT_BASE } from '../../star/compaction/compaction-pure';
import { starQuadOffscreenTsl } from '../../star/compaction/frustum-tsl';
import { starCacheVisibleTsl } from '../../star/star-visibility-tsl';
import type { StarTables } from '../../star/star-tables';
import type { SharedUniformNodes } from '../../tsl/shared-uniform-nodes';
import { EXTINCTION_FRUSTUM_SLACK_PX } from './refill-decision-pure';
import { REFILL_SLICES, refillSliceLength } from './refill-slices-pure';
import type { RefillWorklistNodes, UintStorageNode } from './refill-worklist-nodes';

export interface RefillProducerInputs {
  refill: RefillWorklistNodes;
  u: SharedUniformNodes;
  tables: StarTables;
  /** The compaction's atomic view of its args buffer, which holds the
   *  sub-list counters (compaction-pure.ts `refillListCountElement`). */
  counters: UintStorageNode;
  viewProjection: Node<'mat4'>;
  count: number;
  self: Node<'int'>;
  localPos: Node<'vec3'>;
}

/** One residue class per armed frame — the one `refill.quarter` names — then
 *  the frustum at the refill's own slack, the four-term gate over the
 *  brightest magnitude, and the stamp: cheapest test outermost. */
export function appendRefillWorklistTsl({
  refill, u, tables, counters, viewProjection, count, self, localPos,
}: RefillProducerInputs): void {
  If(refill.arm.equal(uint(1)).and(uint(self).mod(uint(REFILL_SLICES)).equal(refill.quarter)), () => {
    const clip = viewProjection.mul(vec4(localPos, 1.0)).toVar();
    const seen = self.equal(u.uPinFocusToCenter).or(
      starQuadOffscreenTsl(clip, float(EXTINCTION_FRUSTUM_SLACK_PX).div(u.uViewport)).not());
    const dPc = max(distance(localPos, u.uCameraPos), 1e-30);
    If(seen.and(starCacheVisibleTsl(u, tables, self, dPc)), () => {
      If(refill.stamps.element(self).notEqual(refill.cameraGeneration), () => {
        const slot = atomicAdd(
          counters.element(uint(REFILL_LIST_COUNT_BASE).add(refill.quarter)), uint(1));
        refill.worklist
          .element(refill.quarter.mul(uint(refillSliceLength(count))).add(slot))
          .assign(uint(self));
      });
    });
  });
}
