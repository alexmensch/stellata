// The compaction kernel: one thread per catalogue star appends every
// survivor whose quad can touch the viewport to its tier's list and counts
// it into that tier's indirect draw arguments, once per rendered frame. README.md.

import type { Camera } from 'three';
import { Matrix4 } from 'three';
import {
  IndirectStorageBufferAttribute, StorageBufferAttribute,
  type ComputeNode, type WebGPURenderer,
} from 'three/webgpu';
import {
  Fn, If, abs, atomicAdd, atomicStore, compute, instanceIndex, int, storage, uniform, uint, vec4,
} from 'three/tsl';
import { PHYS_RATIO_THRESHOLD } from '../../../star-pipeline/local-pass/star-local-cluster-pure';
import { STAR_PASS_GLOW } from '../../../star-pipeline/star-pass';
import { disposeStorageAttribute } from '../../tsl/storage-attribute';
import { solveStarTsl, type StarTslDeps } from '../star-vertex-tsl';
import {
  CULL_SLACK_NDC, STAR_TIERS, STAR_TIER_DISC, STAR_TIER_GLOW,
  initialIndirectArgs, tierArgsInstanceCountElement, tierListBase, type StarTier,
} from './compaction-pure';

export type SurvivorsNode = ReturnType<typeof storage<'uint'>>;

export class StarCompaction {
  readonly count: number;
  /** Catalogue star indices, one list per tier of `count` slots each. */
  readonly survivors: StorageBufferAttribute;
  /** drawIndexedIndirect arguments, one slot per tier — the geometry the
   *  tier's draws share binds it at that slot's byte offset. */
  readonly args: IndirectStorageBufferAttribute;
  /** The vertex stages' read of the lists. One node object: access is a
   *  property of the stage, so it is read_write in the kernel and read in
   *  every draw (../../tsl/README.md § Storage attributes). */
  readonly survivorsNode: SurvivorsNode;

  private readonly renderer: WebGPURenderer;
  private readonly viewProjection = uniform(new Matrix4());
  private kernels: ComputeNode[] | null;

  constructor(renderer: WebGPURenderer, deps: StarTslDeps, indexCount: number) {
    this.renderer = renderer;
    this.count = deps.tables.count;
    this.survivors = new StorageBufferAttribute(
      new Uint32Array(STAR_TIERS.length * this.count), 1);
    this.args = new IndirectStorageBufferAttribute(initialIndirectArgs(indexCount), 1);
    this.survivorsNode = storage(this.survivors, 'uint', this.survivors.count);
    const argsNode = storage(this.args, 'uint', this.args.count).toAtomic();
    const { u } = deps;

    // Both instance counts start the frame at zero; the same compute pass
    // then runs the kernel, so its atomics see the reset.
    const reset = compute(Fn(() => {
      for (const tier of STAR_TIERS) {
        atomicStore(argsNode.element(tierArgsInstanceCountElement(tier)), uint(0));
      }
    })(), 1);
    reset.setName('star-compaction-reset');

    const append = (tier: StarTier, self: ReturnType<typeof int>) => {
      const slot = atomicAdd(argsNode.element(tierArgsInstanceCountElement(tier)), uint(1));
      this.survivorsNode
        .element(uint(tierListBase(tier, this.count)).add(slot))
        .assign(uint(self));
    };
    // The glow pass's bound is the widest of the three (its taper margin),
    // and no eclipse dim is folded: a star any pass would collapse or
    // taper out is still listed, and that pass's vertex stage collapses it
    // exactly as before. Routing itself is exact — the shared solve.
    const kernel = compute(Fn(() => {
      const self = int(instanceIndex);
      const localPos = deps.tables.position(self).toVar();
      solveStarTsl(deps, self, localPos, {
        pass: STAR_PASS_GLOW, eclipseDim: null,
      }, (s) => {
        // The frustum test, the CPU mirror being starQuadOffscreen. The
        // pinned focal star projects through a substituted matrix in the
        // vertex stage, so its true projection says nothing about where
        // it draws — never culled.
        const clip = this.viewProjection.mul(vec4(localPos, 1.0)).toVar();
        const halfExtent = s.pxSize.div(u.uViewport);
        const offscreen = clip.w.lessThanEqual(0.0)
          .or(abs(clip.x).greaterThan(clip.w.mul(halfExtent.x.add(1.0 + CULL_SLACK_NDC))))
          .or(abs(clip.y).greaterThan(clip.w.mul(halfExtent.y.add(1.0 + CULL_SLACK_NDC))));
        const pinned = self.equal(u.uPinFocusToCenter);
        If(pinned.or(offscreen.not()), () => {
          If(s.physRatio.greaterThanEqual(PHYS_RATIO_THRESHOLD), () => {
            append(STAR_TIER_DISC, self);
          }).Else(() => {
            append(STAR_TIER_GLOW, self);
          });
        });
      });
    })(), this.count);
    kernel.setName('star-compaction');
    this.kernels = [reset, kernel];
  }

  /** The view-projection the kernel tested against on the last dispatch. */
  get viewProjectionMatrix(): Matrix4 {
    return this.viewProjection.value;
  }

  /** One compute pass, one submit: reset then compact. Must follow the
   *  frame's uniform sync and precede its render. The camera's matrices are
   *  refreshed here because the controls mutate position and quaternion
   *  without propagating them, and the render that would is still ahead. */
  dispatch(camera: Camera): void {
    if (this.kernels === null) return;
    camera.updateMatrixWorld();
    this.viewProjection.value.multiplyMatrices(
      camera.projectionMatrix, camera.matrixWorldInverse);
    this.renderer.compute(this.kernels);
  }

  dispose(): void {
    for (const k of this.kernels ?? []) k.dispose();
    this.kernels = null;
    disposeStorageAttribute(this.renderer, this.survivors);
    disposeStorageAttribute(this.renderer, this.args);
  }
}
