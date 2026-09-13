// The compaction kernel: one thread per catalogue star appends every
// survivor to its tier's list and counts it into that tier's indirect draw
// arguments, once per rendered frame, ahead of the render submit. README.md.

import {
  IndirectStorageBufferAttribute, StorageBufferAttribute,
  type ComputeNode, type WebGPURenderer,
} from 'three/webgpu';
import {
  Fn, If, atomicAdd, atomicStore, compute, instanceIndex, int, storage, uint,
} from 'three/tsl';
import { PHYS_RATIO_THRESHOLD } from '../../../star-pipeline/local-pass/star-local-cluster-pure';
import { STAR_PASS_GLOW } from '../../../star-pipeline/star-pass';
import { disposeStorageAttribute } from '../../tsl/storage-attribute';
import { solveStarTsl, type StarTslDeps } from '../star-vertex-tsl';
import {
  STAR_TIERS, STAR_TIER_DISC, STAR_TIER_GLOW,
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
  private kernels: ComputeNode[] | null;

  constructor(renderer: WebGPURenderer, deps: StarTslDeps, indexCount: number) {
    this.renderer = renderer;
    this.count = deps.tables.count;
    this.survivors = new StorageBufferAttribute(
      new Uint32Array(STAR_TIERS.length * this.count), 1);
    this.args = new IndirectStorageBufferAttribute(initialIndirectArgs(indexCount), 1);
    this.survivorsNode = storage(this.survivors, 'uint', this.survivors.count);
    const argsNode = storage(this.args, 'uint', this.args.count).toAtomic();

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
      solveStarTsl(deps, self, deps.tables.position(self).toVar(), {
        pass: STAR_PASS_GLOW, eclipseDim: null,
      }, (s) => {
        If(s.physRatio.greaterThanEqual(PHYS_RATIO_THRESHOLD), () => {
          append(STAR_TIER_DISC, self);
        }).Else(() => {
          append(STAR_TIER_GLOW, self);
        });
      });
    })(), this.count);
    kernel.setName('star-compaction');
    this.kernels = [reset, kernel];
  }

  /** One compute pass, one submit: reset then compact. Must follow the
   *  frame's uniform sync and precede its render. */
  dispatch(): void {
    if (this.kernels === null) return;
    this.renderer.compute(this.kernels);
  }

  dispose(): void {
    for (const k of this.kernels ?? []) k.dispose();
    this.kernels = null;
    disposeStorageAttribute(this.renderer, this.survivors);
    disposeStorageAttribute(this.renderer, this.args);
  }
}
