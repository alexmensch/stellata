// The per-star A_V cache on WebGPU: one compute thread per star marching
// camera→star into a storage buffer the star vertex stage indexes by
// instance, mirrored to the CPU in one mapped copy for the pick. README.md.

import {
  StorageBufferAttribute, Vector3, type ComputeNode, type WebGPURenderer,
} from 'three/webgpu';
import { Fn, If, compute, distance, float, instanceIndex, int, max, storage, uint, uniform } from 'three/tsl';
import type {
  ExtinctionPrepassSeam, ExtinctionPrepassUniforms,
} from '../../star-pipeline/extinction/extinction-seam';
import type { AvParityReport } from '../../star-pipeline/extinction/av-parity-pure';
import {
  RECOMPUTE_EPSILON_PC,
  movedBeyondEpsilon,
  packPositionsVec4Into,
} from '../../star-pipeline/extinction/extinction-prepass-pure';
import type { StarTables } from '../star/star-tables';
import {
  STAR_VISIBILITY_BOUND_KEYS, starCacheVisibleTsl,
  type StarVisibilityBoundValues, type StarVisibilityUniforms,
} from '../star/star-visibility-tsl';
import type { SharedUniformNodes } from '../tsl/shared-uniform-nodes';
import { disposeStorageAttribute } from '../tsl/storage-attribute';
import { mortonDispatchOrder } from './dispatch-order/dispatch-order-pure';
import { dustRaymarchAvTsl } from './dust-raymarch-tsl';
import type { ExtinctionNodes } from './extinction-nodes';
import { runReferenceMarch, type StarCacheGate } from './extinction-parity';
import {
  idleRefill, planRefill, refillSliceLength, type RefillCursor,
} from './refill/refill-slices-pure';

export interface WebGpuExtinctionPrepassOptions {
  renderer: WebGPURenderer;
  /** Absolute (heliocentric ICRS) star positions, xyz-interleaved —
   *  catalog.positions, NOT the floating-origin local buffer. */
  positions: Float32Array;
  count: number;
  nodes: SharedUniformNodes;
  /** The two extinction slots, shared by object identity with the star
   *  layer's: one `attachDust` write reaches both the kernel and the
   *  vertex fallback march, and this pass points the A_V slot at its own
   *  buffer rather than the shell wiring it. */
  slots: ExtinctionNodes;
  uniforms: ExtinctionPrepassUniforms & StarVisibilityBoundValues;
  /** Null leaves the kernel marching the whole catalogue; supplied, it
   *  gates on the star stages' own prefilter (README.md § The cache gate). */
  tables: StarTables | null;
}

export class WebGpuExtinctionPrepass implements ExtinctionPrepassSeam {
  /** Storage buffers and compute are core WebGPU — there is no
   *  EXT_color_buffer_float to gate on and no fallback branch to port. */
  readonly supported = true;

  private readonly renderer: WebGPURenderer;
  private readonly uniforms: ExtinctionPrepassUniforms & StarVisibilityBoundValues;
  private readonly slots: ExtinctionNodes;
  private readonly nodes: SharedUniformNodes;
  private readonly count: number;
  private positions: StorageBufferAttribute | null;
  private order: StorageBufferAttribute | null;
  private av: StorageBufferAttribute | null;
  private kernel: ComputeNode | null;
  private readonly positionsNode: ReturnType<typeof storage<'vec4'>>;
  private readonly orderNode: ReturnType<typeof storage<'uint'>>;
  /** Dispatch slot → catalogue index, the CPU copy the parity check needs
   *  to put the reference march's slot-indexed target back into star order.
   *  Shares its array with the `order` buffer, so dispose has to drop both
   *  or the 1.48 MiB outlives the pass. */
  private dispatchOrder: Uint32Array | null;
  private readonly absCameraPos = uniform(new Vector3());
  /** Slot the running dispatch starts at (refill/README.md § The cursor).
   *  Zero for the whole-catalogue dispatches. */
  private readonly sliceBase = uniform(0, 'uint');
  private readonly sliceLength: number;
  private refill: RefillCursor;
  /** `catalog.positions` itself, which StarFrame rewrites in place. */
  private readonly sourcePositions: Float32Array;
  /** Nodes this pass owns, not the shared registry's: that syncs after this
   *  pass dispatches, so a kernel on it would gate a frame behind the watch
   *  below (README.md § The cache gate). */
  private readonly gateBounds: (StarVisibilityUniforms & StarVisibilityBoundValues) | null;
  /** Built once, run by both the kernel and the reference march, so the
   *  two cannot skip different stars. */
  private readonly visible: StarCacheGate | null;

  // The whole A_V table on the CPU. `readAvMag` answers out of this and
  // nothing else: a copy issued by the pick that wants the value cannot
  // resolve before that pick's verdict (README.md § Cold reads).
  private mirror: Float32Array | null = null;
  // The generation the outstanding-or-landed mirror read belongs to.
  // Holding it at `generation` is what makes a pointermove sweep cost one
  // copy rather than one per event, and a failed read one attempt rather
  // than one per event for as long as the buffer stands.
  private mirrorGeneration = -1;
  /** Bumped on every recompute: a read that resolves against an older
   *  buffer's contents lands in a generation nobody will consult. */
  private generation = 0;
  private dirty = true;
  private hasComputed = false;
  private forceDisabled = false;
  private disposed = false;
  private lastCamX = Infinity;
  private lastCamY = Infinity;
  private lastCamZ = Infinity;

  constructor({
    renderer, positions, count, nodes, slots, uniforms, tables,
  }: WebGpuExtinctionPrepassOptions) {
    this.renderer = renderer;
    this.uniforms = uniforms;
    this.slots = slots;
    this.nodes = nodes;
    this.count = count;
    this.sliceLength = refillSliceLength(count);
    this.refill = idleRefill(count);
    this.sourcePositions = positions;
    this.gateBounds = tables === null ? null : {
      uThresholdMag: uniform(uniforms.uThresholdMag.value),
      uCullMag: uniform(uniforms.uCullMag.value),
      uMinDistSol: uniform(uniforms.uMinDistSol.value),
      uMaxDistSol: uniform(uniforms.uMaxDistSol.value),
      uSpectMask: uniform(uniforms.uSpectMask.value, 'uint'),
      uMonochrome: uniform(uniforms.uMonochrome.value),
    };

    this.dispatchOrder = mortonDispatchOrder(positions, count);
    // vec4 slots, not vec3: WGSL has no packed vec3 in a storage buffer, and
    // an itemSize-3 attribute is the one the backend silently re-strides
    // (../README.md § One writer per buffer per submit).
    this.positions = new StorageBufferAttribute(count, 4);
    packPositionsVec4Into(
      this.positions.array as Float32Array, positions, count, this.dispatchOrder);
    this.order = new StorageBufferAttribute(this.dispatchOrder, 1);
    this.av = new StorageBufferAttribute(count, 1);
    // The consumers' slot points here for this instance's whole life;
    // `uAvPrepassEnabled` is what gates the read, so a buffer that has not
    // been computed yet is bound but never fetched.
    slots.setAvBuffer(this.av);

    this.positionsNode = storage(this.positions, 'vec4', count).toReadOnly();
    this.orderNode = storage(this.order, 'uint', count).toReadOnly();
    // One thread per slot of the dispatched slice.
    // dispatch-order/README.md § Dispatch order.
    const gateBounds = this.gateBounds;
    this.visible = tables === null || gateBounds === null ? null
      : (self, starAbs) => starCacheVisibleTsl(
        gateBounds, tables, self, max(distance(starAbs, this.absCameraPos), 1e-30));
    const visible = this.visible;
    this.kernel = compute(Fn(() => {
      const slot = instanceIndex.add(this.sliceBase);
      // Ours, not three's: three's early return bounds `instanceIndex`, not
      // the slot (refill/README.md § The kernel bounds its own slot).
      If(slot.lessThan(uint(count)), () => {
        const self = int(this.orderNode.element(slot));
        const starAbs = this.positionsNode.element(slot).xyz;
        const march = () => dustRaymarchAvTsl(nodes, slots.dust, this.absCameraPos, starAbs);
        if (visible === null) {
          slots.av.element(self).assign(march());
        } else {
          const av = float(0.0).toVar();
          If(visible(self, starAbs), () => { av.assign(march()); });
          // Zero rather than a skipped write — the compare in
          // README.md § The cache gate is total.
          slots.av.element(self).assign(av);
        }
      });
    })(), count);
    this.kernel.setName('extinction-prepass-compute');
  }

  markDirty(): void {
    this.dirty = true;
  }

  /** Re-pack the position table at the catalogue's current epoch,
   *  reusing the Morton order (README.md § The cache gate). */
  refreshPositions(): void {
    if (this.positions === null || this.dispatchOrder === null) return;
    packPositionsVec4Into(
      this.positions.array as Float32Array, this.sourcePositions, this.count,
      this.dispatchOrder);
    this.positions.needsUpdate = true;
    this.dirty = true;
  }

  setEnabled(on: boolean): void {
    this.forceDisabled = !on;
    this.syncConsumerUniforms();
  }

  isActive(): boolean {
    return this.hasComputed && !this.forceDisabled && this.kernel !== null;
  }

  update(absCamX: number, absCamY: number, absCamZ: number): void {
    if (this.kernel === null) return;
    if (this.dustTexture === null) return;
    if (this.forceDisabled) return;
    const moved = movedBeyondEpsilon(
      this.lastCamX, this.lastCamY, this.lastCamZ,
      absCamX, absCamY, absCamZ,
      RECOMPUTE_EPSILON_PC,
    );
    if (this.syncGateBounds()) this.dirty = true;
    const wanted = this.dirty || moved;
    // The first fill is whole (refill/README.md § Three places).
    if (!this.hasComputed) {
      if (!wanted) return;
      this.absCameraPos.value.set(absCamX, absCamY, absCamZ);
      this.computeWholeCatalogue();
      this.refill = idleRefill(this.count);
      this.hasComputed = true;
    } else {
      const plan = planRefill(this.refill, wanted, this.count, this.sliceLength);
      this.refill = plan.next;
      if (plan.base === null) return;
      this.absCameraPos.value.set(absCamX, absCamY, absCamZ);
      this.sliceBase.value = plan.base;
      this.renderer.compute(this.kernel, plan.length);
    }

    this.generation++;
    this.mirror = null;
    this.lastCamX = absCamX;
    this.lastCamY = absCamY;
    this.lastCamZ = absCamZ;
    this.dirty = false;
    this.syncConsumerUniforms();
  }

  /** One dispatch over every slot at the current `absCameraPos`, so the
   *  whole buffer belongs to one camera. The boot fill and the parity
   *  check are the two callers that need that. */
  private computeWholeCatalogue(): void {
    if (this.kernel === null) return;
    this.sliceBase.value = 0;
    this.renderer.compute(this.kernel, this.count);
  }

  /**
   * Raw physical A_V for one star, out of the very float the star vertex
   * stage indexes — exact, free, and over the whole catalog once the
   * mirror has landed. Null until then, which is the honest answer while
   * the buffer's contents exist only on the GPU: WebGPU offers no
   * synchronous readback (README.md § Cold reads).
   */
  readAvMag(idx: number): number | null {
    if (!this.isActive() || this.mirror === null) return null;
    return this.mirror[idx] ?? null;
  }

  /** Stage the whole table for the picks a pointer event is about to
   *  make. One `copyBufferToBuffer` + map of the buffer, issued at most
   *  once per recompute and never while the camera is under way, landing
   *  inside the hover dwell. */
  warmAvReadback(): void {
    if (!this.isActive()) return;
    // A parked cursor only: a copy taken mid-cycle is superseded before the
    // dwell that wanted it can read a byte (README.md § Cold reads).
    if (this.refill.base < this.count) return;
    if (this.mirrorGeneration === this.generation) return;
    const generation = this.generation;
    this.mirrorGeneration = generation;
    this.renderer
      .getArrayBufferAsync(this.av!)
      .then((bytes) => {
        if (this.disposed || generation !== this.generation) return;
        this.mirror = new Float32Array(bytes);
      })
      .catch(() => {
        // Leave mirrorGeneration where it is: a device that refuses the
        // map gets one attempt per recompute, not one per pointer event.
      });
  }

  /** The parity check of README.md § The prepass kernel: the same march as
   *  a fragment pass over the same positions, at the last computed camera,
   *  bit-compared against the whole buffer. Dev-console only. */
  async verifyParity(): Promise<AvParityReport | null> {
    if (!this.isActive() || this.av === null || this.dispatchOrder === null) return null;
    // One camera behind the whole buffer (refill/README.md § Three places).
    this.computeWholeCatalogue();
    this.refill = idleRefill(this.count);
    this.generation++;
    this.mirror = null;
    return runReferenceMarch({
      renderer: this.renderer,
      nodes: this.nodes,
      dust: this.slots.dust,
      positions: this.positionsNode,
      order: this.dispatchOrder,
      orderNode: this.orderNode,
      gate: this.visible,
      absCameraPos: this.absCameraPos,
      av: this.av,
      count: this.count,
    });
  }

  /** Copy the bounds the gate reads and report whether any moved
   *  (README.md § The cache gate). */
  private syncGateBounds(): boolean {
    const bounds = this.gateBounds;
    if (bounds === null) return false;
    let moved = false;
    for (const key of STAR_VISIBILITY_BOUND_KEYS) {
      const next = this.uniforms[key].value;
      if (bounds[key].value === next) continue;
      bounds[key].value = next;
      moved = true;
    }
    return moved;
  }

  /** The consumer's `uAvPrepassEnabled` gate is the one shared-map write
   *  this pass owns on either backend. `uAvPrepassTex` is a WebGL texture
   *  slot; here the consumers index the buffer slot directly. */
  private syncConsumerUniforms(): void {
    this.uniforms.uAvPrepassEnabled.value = this.isActive() ? 1 : 0;
  }

  private get dustTexture() {
    return this.uniforms.uDustTexture.value;
  }

  dispose(): void {
    this.disposed = true;
    this.uniforms.uAvPrepassEnabled.value = 0;
    this.slots.setAvBuffer(null);
    // The kernel's bind group references all three buffers: drop it first.
    this.kernel?.dispose();
    if (this.av !== null) disposeStorageAttribute(this.renderer, this.av);
    if (this.positions !== null) disposeStorageAttribute(this.renderer, this.positions);
    if (this.order !== null) disposeStorageAttribute(this.renderer, this.order);
    this.kernel = null;
    this.av = null;
    this.positions = null;
    this.order = null;
    this.dispatchOrder = null;
    this.mirror = null;
    this.mirrorGeneration = -1;
    this.refill = idleRefill(this.count);
    this.hasComputed = false;
    this.dirty = true;
    this.lastCamX = Infinity;
    this.lastCamY = Infinity;
    this.lastCamZ = Infinity;
  }
}
