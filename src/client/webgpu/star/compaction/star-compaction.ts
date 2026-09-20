// The compaction kernel: one thread per catalogue star appends every
// survivor whose quad can touch the viewport to its tier's list and counts
// it into that tier's indirect draw arguments, once per rendered frame. README.md.

import type { Camera } from 'three';
import { Matrix4 } from 'three';
import {
  IndirectStorageBufferAttribute, StorageBufferAttribute,
  type ComputeNode, type Node, type WebGPURenderer,
} from 'three/webgpu';
import {
  Fn, If, Loop, atomicAdd, atomicStore, compute, instanceIndex, int, storage, uniform, uint, vec4,
} from 'three/tsl';
import { PHYS_RATIO_THRESHOLD } from '../../../star-pipeline/local-pass/star-local-cluster-pure';
import { STAR_PASS_GLOW } from '../../../star-pipeline/star-pass';
import type { RefillWorklistNodes } from '../../extinction/refill/refill-worklist-nodes';
import { appendRefillWorklistTsl } from '../../extinction/refill/refill-worklist-tsl';
import { disposeStorageAttribute, storageWriteRead } from '../../tsl/storage-attribute';
import { solveStarTsl, type StarTslDeps } from '../star-vertex-tsl';
import { REFILL_BUCKETS } from '../../extinction/refill/refill-buckets-pure';
import {
  PREFILTER_COUNT_ELEMENT, REFILL_BUCKET_COUNT_BASE, REFILL_DISPATCH_ELEMENTS,
  REFILL_DISPATCH_LENGTH_ELEMENT, REFILL_PREFIX_BASE,
  REFILL_WORKGROUP_SIZE, STAR_TIERS, STAR_TIER_DISC, STAR_TIER_GLOW,
  initialIndirectArgs, initialRefillDispatch, survivorCountsFromArgs,
  tierArgsInstanceCountElement, tierListBase,
  type StarTier, type SurvivorCounts,
} from './compaction-pure';
import { starQuadOffscreenTsl } from './frustum-tsl';

export type UintStorageNode = ReturnType<typeof storage<'uint'>>;
export type SurvivorsNode = UintStorageNode;

/** Storage buffers the compaction kernel binds, against the 8 WebGPU
 *  guarantees a stage (`../../tsl/README.md` § Storage attributes). At the
 *  ceiling: a ninth needs a counter folded into the args buffer or a table
 *  folded into another, never a new binding (README.md § Binding budget). */
export const STAR_COMPACTION_KERNEL_STORAGE_BUFFERS = [
  'position', 'statics', 'suppressPulsation', 'av', 'survivors', 'args',
  'refillStamps', 'refillTable',
].length;

export class StarCompaction {
  readonly count: number;
  /** Catalogue star indices, one list per tier of `count` slots each. */
  readonly survivors: StorageBufferAttribute;
  /** drawIndexedIndirect arguments, one slot per tier — the geometry the
   *  tier's draws share binds it at that slot's byte offset — then the
   *  prefilter counter and the refill sub-list counters. */
  readonly args: IndirectStorageBufferAttribute;
  /** README.md § The refill dispatch. */
  readonly refillDispatch: IndirectStorageBufferAttribute;
  /** The vertex stages' read of the lists. One node object: access is a
   *  property of the stage, so it is read_write in the kernel and read in
   *  every draw (../../tsl/README.md § Storage attributes). */
  readonly survivorsNode: SurvivorsNode;
  /** The refill kernel's read-only node over `refillDispatch`, for its own
   *  bound — its own node, not the one the finish kernel assigns through. */
  readonly refillDispatchNode: UintStorageNode;

  /** The per-star kernel, held so its thread count can follow the decoded
   *  record count. */
  private readonly kernel: ComputeNode;

  private readonly renderer: WebGPURenderer;
  private readonly viewProjection = uniform(new Matrix4());
  /** 1 only while a readback is waiting for its dispatch — the counter it
   *  gates feeds no draw (README.md § Reading the counts back). */
  private readonly countPrefilter = uniform(0, 'uint');
  private readonly awaitingDispatch: (() => void)[] = [];
  /** The armed frame's set, and what dispose releases — so every kernel is
   *  reachable from it (README.md § The refill dispatch). */
  private kernels: ComputeNode[] | null;
  private plainKernels: ComputeNode[] | null;
  private readonly refill: RefillWorklistNodes;

  constructor(
    renderer: WebGPURenderer, deps: StarTslDeps, indexCount: number, refill: RefillWorklistNodes,
  ) {
    this.renderer = renderer;
    this.refill = refill;
    this.count = deps.tables.count;
    this.survivors = new StorageBufferAttribute(
      new Uint32Array(STAR_TIERS.length * this.count), 1);
    this.args = new IndirectStorageBufferAttribute(initialIndirectArgs(indexCount), 1);
    this.refillDispatch = new IndirectStorageBufferAttribute(initialRefillDispatch(), 1);
    this.survivorsNode = storage(this.survivors, 'uint', this.survivors.count);
    const argsNode = storage(this.args, 'uint', this.args.count).toAtomic();
    const refillDispatchNodes = storageWriteRead(
      () => storage(this.refillDispatch, 'uint', REFILL_DISPATCH_ELEMENTS));
    this.refillDispatchNode = refillDispatchNodes.read;
    // An add of zero, consumed as an operator ARGUMENT, mirrors `append`'s
    // value use of an atomic below. atomicLoad as the receiver of `.add`
    // generated no code in three r185 ("expected a uint" at boot).
    const readCounter = (element: Node<'uint'>) => atomicAdd(
      element, uint(0)) as unknown as Node<'uint'>;
    const { u } = deps;

    const reset = compute(Fn(() => {
      const bucket = instanceIndex;
      If(bucket.equal(uint(0)), () => {
        for (const tier of STAR_TIERS) {
          atomicStore(argsNode.element(tierArgsInstanceCountElement(tier)), uint(0));
        }
        atomicStore(argsNode.element(PREFILTER_COUNT_ELEMENT), uint(0));
      });
      If(refill.arm.equal(uint(1)), () => {
        atomicStore(refill.counterElement(argsNode, bucket), uint(0));
      });
    })(), REFILL_BUCKETS);
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
        If(this.countPrefilter.equal(uint(1)), () => {
          atomicAdd(argsNode.element(PREFILTER_COUNT_ELEMENT), uint(1));
        });
        // The pinned focal star draws through a substituted matrix, so its
        // true projection cannot cull it.
        const clip = this.viewProjection.mul(vec4(localPos, 1.0)).toVar();
        const offscreen = starQuadOffscreenTsl(clip, s.pxSize.div(u.uViewport));
        const pinned = self.equal(u.uPinFocusToCenter);
        If(pinned.or(offscreen.not()), () => {
          If(s.physRatio.greaterThanEqual(PHYS_RATIO_THRESHOLD), () => {
            append(STAR_TIER_DISC, self);
          }).Else(() => {
            append(STAR_TIER_GLOW, self);
          });
        });
      });
      // After the solve, whose unconditional record reads this re-reads.
      appendRefillWorklistTsl({
        refill, u, tables: deps.tables, counters: argsNode,
        viewProjection: this.viewProjection, count: this.count, self, localPos,
      });
    })(), this.count);
    kernel.setName('star-compaction');
    this.kernel = kernel;
    // README.md § The refill dispatch.
    const dispatchBuf = refillDispatchNodes.write;
    const copyCounts = compute(Fn(() => {
      const bucket = instanceIndex;
      dispatchBuf.element(uint(REFILL_BUCKET_COUNT_BASE).add(bucket))
        .assign(readCounter(refill.counterElement(argsNode, bucket)));
    })(), REFILL_BUCKETS);
    copyCounts.setName('star-compaction-refill-counts');
    const finish = compute(Fn(() => {
      const bucket = instanceIndex;
      const bucketCount = (b: Node<'uint'>) =>
        dispatchBuf.element(uint(REFILL_BUCKET_COUNT_BASE).add(b));
      const running = uint(0).toVar();
      Loop({ start: uint(0), end: bucket, type: 'uint', condition: '<' }, ({ i }) => {
        running.addAssign(bucketCount(i));
      });
      dispatchBuf.element(uint(REFILL_PREFIX_BASE).add(bucket)).assign(running);
      If(bucket.equal(uint(REFILL_BUCKETS - 1)), () => {
        const listed = running.add(bucketCount(bucket)).toVar();
        dispatchBuf.element(0).assign(
          listed.add(uint(REFILL_WORKGROUP_SIZE - 1)).div(uint(REFILL_WORKGROUP_SIZE)));
        dispatchBuf.element(REFILL_DISPATCH_LENGTH_ELEMENT).assign(listed);
      });
    })(), REFILL_BUCKETS);
    finish.setName('star-compaction-refill-dispatch');
    this.kernels = [reset, kernel, copyCounts, finish];
    this.plainKernels = [reset, kernel];
  }

  /**
   * Bound the per-star kernel to the records actually decoded. Three treats
   * `ComputeNode.count` as a mutable field feeding both the dispatch size
   * and an in-shader `instanceIndex >= count` guard delivered as a uniform,
   * so this recompiles nothing and rebinds nothing.
   *
   * Without the bound an undecoded record is all-zero — position at Sol,
   * absmag 0 — which passes the prefilter and the frustum test and lands
   * several hundred thousand phantom bright stars in the disc list. The
   * survivor buffer's own `tierListBase` keeps using the FULL count: the
   * second tier's base is a fixed address, not a function of how many
   * threads ran.
   */
  setLoadedCount(loaded: number): void {
    this.kernel.count = Math.min(loaded, this.count);
  }

  /** The view-projection the kernel tested against on the last dispatch, as a
   *  copy — handing out the uniform's own matrix would let a reader silently
   *  retarget the cull. */
  get viewProjectionMatrix(): Matrix4 {
    return this.viewProjection.value.clone();
  }

  /** Per tier, off a mapped copy of the args buffer, on demand. Never per
   *  frame: the readback resolves frames later and nothing on the render
   *  path waits for it (README.md § Reading the counts back).
   *
   *  Arms the prefilter counter and waits one dispatch for it, so the caller
   *  owes this a rendered frame — a parked render gate never resolves it. */
  async readSurvivorCounts(): Promise<SurvivorCounts | null> {
    if (this.kernels === null) return null;
    this.countPrefilter.value = 1;
    await new Promise<void>((resolve) => { this.awaitingDispatch.push(resolve); });
    this.countPrefilter.value = 0;
    if (this.kernels === null) return null;
    const bytes = await this.renderer.getArrayBufferAsync(this.args);
    if (this.kernels === null) return null;
    return survivorCountsFromArgs(new Uint32Array(bytes));
  }

  /** One compute pass, one submit: reset, compact, and on an armed frame the
   *  two scan kernels. Must follow the frame's uniform sync and precede its render. The camera's matrices are
   *  refreshed here because the controls mutate position and quaternion
   *  without propagating them, and the render that would is still ahead. */
  dispatch(camera: Camera): void {
    if (this.kernels === null || this.plainKernels === null) return;
    camera.updateMatrixWorld();
    this.viewProjection.value.multiplyMatrices(
      camera.projectionMatrix, camera.matrixWorldInverse);
    this.renderer.compute(this.refill.arm.value === 1 ? this.kernels : this.plainKernels);
    this.releaseWaiters();
  }

  private releaseWaiters(): void {
    const waiters = this.awaitingDispatch.splice(0);
    for (const resolve of waiters) resolve();
  }

  dispose(): void {
    for (const k of this.kernels ?? []) k.dispose();
    this.kernels = null;
    this.plainKernels = null;
    // Or an armed readback never settles and its caller hangs for the boot.
    this.releaseWaiters();
    disposeStorageAttribute(this.renderer, this.survivors);
    disposeStorageAttribute(this.renderer, this.args);
    disposeStorageAttribute(this.renderer, this.refillDispatch);
  }
}
