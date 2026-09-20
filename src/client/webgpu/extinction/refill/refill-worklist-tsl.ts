// The compaction kernel's side of the refill: append a star the view holds,
// the cache gate admits and the generation has not stamped to its Morton
// bucket. README.md § The compaction appends the worklist.

import { If, atomicAdd, distance, float, max, uint, vec4 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { starQuadOffscreenTsl } from '../../star/compaction/frustum-tsl';
import { starCacheVisibleTsl } from '../../star/star-visibility-tsl';
import type { StarTables } from '../../star/star-tables';
import type { SharedUniformNodes } from '../../tsl/shared-uniform-nodes';
import { refillBucketCapacity } from './refill-buckets-pure';
import { EXTINCTION_FRUSTUM_SLACK_PX } from './refill-decision-pure';
import { REFILL_SLICES } from './refill-slices-pure';
import type { RefillWorklistNodes, UintStorageNode } from './refill-worklist-nodes';

export interface RefillProducerInputs {
  refill: RefillWorklistNodes;
  u: SharedUniformNodes;
  tables: StarTables;
  /** The compaction's atomic view of its args buffer, which holds the
   *  bucket counters (`refill.counterElement`). */
  counters: UintStorageNode;
  viewProjection: Node<'mat4'>;
  count: number;
  self: Node<'int'>;
  localPos: Node<'vec3'>;
}

/** Cheapest test outermost, which is why the stamp read comes last and the
 *  slot read — the only one a rejected thread would waste — comes after it. */
export function appendRefillWorklistTsl({
  refill, u, tables, counters, viewProjection, count, self, localPos,
}: RefillProducerInputs): void {
  const capacity = refillBucketCapacity(count);
  If(refill.arm.equal(uint(1)).and(uint(self).mod(uint(REFILL_SLICES)).equal(refill.quarter)), () => {
    const clip = viewProjection.mul(vec4(localPos, 1.0)).toVar();
    const seen = self.equal(u.uPinFocusToCenter).or(
      starQuadOffscreenTsl(clip, float(EXTINCTION_FRUSTUM_SLACK_PX).div(u.uViewport)).not());
    const dPc = max(distance(localPos, u.uCameraPos), 1e-30);
    If(seen.and(starCacheVisibleTsl(u, tables, self, dPc)), () => {
      If(refill.stamps.element(self).notEqual(refill.cameraGeneration), () => {
        const bucket = refill.slotOf(self).div(uint(capacity)).toVar();
        const local = atomicAdd(refill.counterElement(counters, bucket), uint(1));
        refill.worklistElement(count, bucket.mul(uint(capacity)).add(local)).assign(uint(self));
      });
    });
  });
}
