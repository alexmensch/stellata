// The per-star A_V cache on WebGPU: one compute thread per star marching
// camera→star into a storage buffer the star vertex stage indexes by
// instance, mirrored to the CPU in one mapped copy for the pick. README.md.

import {
  Matrix4, StorageBufferAttribute, Vector3, type ComputeNode, type Node, type WebGPURenderer,
} from 'three/webgpu';
import {
  Fn, If, compute, distance, float, instanceIndex, int, max, storage, uint, uniform,
} from 'three/tsl';
import type {
  ExtinctionPrepassSeam, ExtinctionPrepassUniforms, ExtinctionView,
} from '../../star-pipeline/extinction/extinction-seam';
import type { AvParityReport } from '../../star-pipeline/extinction/av-parity-pure';
import {
  RECOMPUTE_EPSILON_PC,
  movedBeyondEpsilon,
  packPositionsVec4Into,
} from '../../star-pipeline/extinction/extinction-prepass-pure';
import {
  REFILL_DISPATCH_LENGTH_ELEMENT, REFILL_PREFIX_BASE, REFILL_WORKGROUP_SIZE,
} from '../star/compaction/compaction-pure';
import type { StarCompaction } from '../star/compaction/star-compaction';
import type { StarTables } from '../star/star-tables';
import {
  STAR_VISIBILITY_BOUND_KEYS, starCacheVisibleTsl,
  type StarVisibilityBoundValues, type StarVisibilityUniforms,
} from '../star/star-visibility-tsl';
import type { SharedUniformNodes } from '../tsl/shared-uniform-nodes';
import { disposeStorageAttribute } from '../tsl/storage-attribute';
import { computeIndirect } from '../tsl/tsl-shim';
import { inverseOrder, mortonDispatchOrder } from './dispatch-order/dispatch-order-pure';
import { dustRaymarchAvTsl } from './dust-raymarch-tsl';
import type { ExtinctionNodes } from './extinction-nodes';
import { runReferenceMarch, type StarCacheGate } from './extinction-parity';
import { AvMirror } from './mirror/av-mirror';
import { composeViewProjectionAbs, countInFrameAbs, sameView } from './refill/refill-decision-pure';
import {
  REFILL_BUCKETS, refillWorklistLength,
} from './refill/refill-buckets-pure';
import { idleRefill, planRefill, refillInFlight, type RefillCursor } from './refill/refill-slices-pure';

export interface WebGpuExtinctionPrepassOptions {
  renderer: WebGPURenderer;
  /** Absolute (heliocentric ICRS) star positions, xyz-interleaved —
   *  catalog.positions, NOT the floating-origin local buffer. */
  positions: Float32Array;
  count: number;
  nodes: SharedUniformNodes;
  /** The extinction slots, shared by object identity with the star layer's:
   *  one `attachDust` write reaches both the kernel and the vertex fallback
   *  march, and this pass points the A_V and refill slots at its own
   *  buffers rather than the shell wiring them. */
  slots: ExtinctionNodes;
  uniforms: ExtinctionPrepassUniforms & StarVisibilityBoundValues;
  /** The star layer's tables — the whole fill gates on the star stages' own
   *  prefilter over them (README.md § The cache gate). */
  tables: StarTables;
  /** The compaction that appends the refill worklist and sizes its dispatch
   *  (refill/README.md § The compaction appends the worklist). */
  compaction: StarCompaction;
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
  /** Per star, the camera generation its A_V was computed at
   *  (refill/README.md § The generation stamp). */
  private stamps: StorageBufferAttribute | null;
  /** Star → slot — the refill kernel's route into the position table and the
   *  producer's bucket key — followed by the worklist itself. */
  private refillTable: StorageBufferAttribute | null;
  private fillKernel: ComputeNode | null;
  /** The listed stars of one quarter, at the count the compaction wrote. */
  private refillKernel: ComputeNode | null;
  private readonly positionsNode: ReturnType<typeof storage<'vec4'>>;
  private readonly orderNode: ReturnType<typeof storage<'uint'>>;
  /** Dispatch slot → catalogue index, the CPU copy the parity check needs
   *  to put the reference march's slot-indexed target back into star order.
   *  Shares its array with the `order` buffer, so dispose has to drop both
   *  or the 1.48 MiB outlives the pass. */
  private dispatchOrder: Uint32Array | null;
  private readonly absCameraPos = uniform(new Vector3());
  private readonly viewScratch = new Matrix4();
  private lastView: Matrix4 | null = null;
  private refill: RefillCursor = idleRefill();
  /** `catalog.positions` itself, which StarFrame rewrites in place. */
  private readonly sourcePositions: Float32Array;
  /** Nodes this pass owns, not the shared registry's: that syncs after this
   *  pass dispatches, so a kernel on it would gate a frame behind the watch
   *  below (README.md § The cache gate). */
  private readonly gateBounds: StarVisibilityUniforms & StarVisibilityBoundValues;
  /** Built once, run by both the whole fill and the reference march, so the
   *  two cannot skip different stars. */
  private readonly visible: StarCacheGate;

  /** The pick's CPU copy of the table (mirror/README.md). */
  private readonly mirror: AvMirror;
  /** Bumped on every dispatch: a read that resolves against an older
   *  buffer's contents lands in a generation nobody will consult. */
  private generation = 0;
  private dirty = true;
  private hasComputed = false;
  private forceDisabled = false;
  private lastCamX = Infinity;
  private lastCamY = Infinity;
  private lastCamZ = Infinity;

  constructor({
    renderer, positions, count, nodes, slots, uniforms, tables, compaction,
  }: WebGpuExtinctionPrepassOptions) {
    this.renderer = renderer;
    this.mirror = new AvMirror(renderer);
    this.uniforms = uniforms;
    this.slots = slots;
    this.nodes = nodes;
    this.count = count;
    this.sourcePositions = positions;
    this.gateBounds = {
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
    this.stamps = new StorageBufferAttribute(new Uint32Array(count), 1);
    // ../star/compaction/README.md § Binding budget.
    const table = new Uint32Array(count + refillWorklistLength(count));
    table.set(inverseOrder(this.dispatchOrder));
    this.refillTable = new StorageBufferAttribute(table, 1);
    // The consumers' slots point here for this instance's whole life;
    // `uAvPrepassEnabled` is what gates the read, so a buffer that has not
    // been computed yet is bound but never fetched.
    slots.setAvBuffer(this.av);
    slots.refill.setBuffers(this.stamps, this.refillTable);

    this.positionsNode = storage(this.positions, 'vec4', count).toReadOnly();
    this.orderNode = storage(this.order, 'uint', count).toReadOnly();
    const { refill } = slots;
    const gateBounds = this.gateBounds;
    this.visible = (self, starAbs) => starCacheVisibleTsl(
      gateBounds, tables, self, max(distance(starAbs, this.absCameraPos), 1e-30));
    const march = (starAbs: ReturnType<typeof this.positionsNode.element>['xyz']) =>
      dustRaymarchAvTsl(nodes, slots.dust, this.absCameraPos, starAbs);

    // One thread per slot, in Morton order (dispatch-order/README.md).
    this.fillKernel = compute(Fn(() => {
      const slot = instanceIndex;
      const self = int(this.orderNode.element(slot));
      const starAbs = this.positionsNode.element(slot).xyz;
      const av = float(0.0).toVar();
      If(this.visible(self, starAbs), () => { av.assign(march(starAbs)); });
      // Zero rather than a skipped write — the compare in
      // README.md § The cache gate is total.
      slots.av.element(self).assign(av);
      refill.stamps.element(self).assign(refill.cameraGeneration);
    })(), count);
    this.fillKernel.setName('extinction-prepass-fill');

    // One thread per listed star of this frame's quarter. No gate: the
    // compaction applied it before appending
    // (refill/README.md § The kernel bounds itself by the listed length).
    const prefix = (bucket: Node<'uint'>) =>
      compaction.refillDispatchNode.element(uint(REFILL_PREFIX_BASE).add(bucket));
    this.refillKernel = computeIndirect(Fn(() => {
      const i = instanceIndex;
      If(i.lessThan(compaction.refillDispatchNode.element(REFILL_DISPATCH_LENGTH_ELEMENT)), () => {
        // refill/README.md § Bucketed by Morton range.
        const bucket = uint(0).toVar();
        for (let step = REFILL_BUCKETS >> 1; step >= 1; step >>= 1) {
          const next = bucket.add(uint(step)).toVar();
          If(prefix(next).lessThanEqual(i), () => { bucket.assign(next); });
        }
        const self = int(refill.worklistElement(count, bucket, i.sub(prefix(bucket))));
        const starAbs = this.positionsNode.element(refill.slotOf(self)).xyz;
        slots.av.element(self).assign(march(starAbs));
        refill.stamps.element(self).assign(refill.cameraGeneration);
      });
    })(), compaction.refillDispatch, [REFILL_WORKGROUP_SIZE]);
    this.refillKernel.setName('extinction-prepass-refill');
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

  countInFrame(): number | null {
    if (this.lastView === null) return null;
    const viewport = this.nodes.uViewport.value;
    return countInFrameAbs(
      this.sourcePositions, this.count, this.lastView,
      viewport.x, viewport.y, this.nodes.uPinFocusToCenter.value);
  }

  setEnabled(on: boolean): void {
    this.forceDisabled = !on;
    // Or the compaction keeps rebuilding a list nothing will march. Parking
    // the cursor abandons the classes the switch interrupted, so the pass
    // owes itself a fresh request rather than resuming a truncated flight.
    if (!on) {
      this.slots.refill.arm.value = 0;
      this.refill = idleRefill();
      this.dirty = true;
    }
    this.syncConsumerUniforms();
  }

  isActive(): boolean {
    return this.hasComputed && !this.forceDisabled && this.fillKernel !== null;
  }

  update(absCamX: number, absCamY: number, absCamZ: number, view?: ExtinctionView): void {
    if (this.fillKernel === null || this.refillKernel === null) return;
    if (this.dustTexture === null) return;
    if (this.forceDisabled) return;
    const moved = movedBeyondEpsilon(
      this.lastCamX, this.lastCamY, this.lastCamZ,
      absCamX, absCamY, absCamZ,
      RECOMPUTE_EPSILON_PC,
    );
    if (this.syncGateBounds()) this.dirty = true;
    const bump = this.dirty || moved;
    let viewChanged = false;
    if (view !== undefined) {
      composeViewProjectionAbs(view.camera, view.worldOffset, this.viewScratch);
      viewChanged = !sameView(this.lastView, this.viewScratch);
      if (viewChanged) {
        this.lastView = (this.lastView ?? new Matrix4()).copy(this.viewScratch);
      }
    }
    // The first fill is whole (refill/README.md § Three places).
    if (!this.hasComputed) {
      if (!bump) return;
      this.setCameraGeneration(absCamX, absCamY, absCamZ);
      this.fillWhole();
      this.hasComputed = true;
      this.dirty = false;
      this.syncConsumerUniforms();
      return;
    }
    const { refill } = this.slots;
    if (bump) {
      refill.cameraGeneration.value += 1;
      this.setCameraGeneration(absCamX, absCamY, absCamZ);
    }
    // Consume before produce: the class marched now is the one the
    // compaction built LAST frame; the compaction this frame reads the arm
    // and the class left here (refill/README.md § The cursor).
    const plan = planRefill(this.refill, bump || viewChanged);
    this.refill = plan.next;
    if (plan.dispatch) {
      refill.quarter.value = plan.quarter;
      this.renderer.compute(this.refillKernel);
      this.generation++;
      this.mirror.invalidate();
    }
    refill.quarter.value = plan.next.quarter;
    refill.arm.value = plan.arm ? 1 : 0;
    this.dirty = false;
  }

  /** see refill/README.md § The generation stamp */
  private setCameraGeneration(x: number, y: number, z: number): void {
    this.absCameraPos.value.set(x, y, z);
    this.lastCamX = x;
    this.lastCamY = y;
    this.lastCamZ = z;
  }

  /** Every slot at one camera, and nothing owed after it (refill/README.md
   *  § Three places). */
  private fillWhole(): void {
    if (this.fillKernel === null) return;
    this.renderer.compute(this.fillKernel, this.count);
    this.refill = idleRefill();
    this.slots.refill.arm.value = 0;
    this.slots.refill.quarter.value = 0;
    this.generation++;
    this.mirror.invalidate();
  }

  /**
   * Raw physical A_V for one star, out of the very float the star vertex
   * stage indexes — exact, free, and over the whole catalog once the
   * mirror has landed. Null until then, which is the honest answer while
   * the buffer's contents exist only on the GPU: WebGPU offers no
   * synchronous readback (README.md § Cold reads).
   */
  readAvMag(idx: number): number | null {
    if (!this.isActive()) return null;
    return this.mirror.read(idx);
  }

  /** Stage the whole table for the picks a pointer event is about to
   *  make. One `copyBufferToBuffer` + map of the buffer, issued at most
   *  once per recompute and never while the camera is under way, landing
   *  inside the hover dwell. */
  warmAvReadback(): void {
    if (!this.isActive() || this.av === null) return;
    // Nothing in flight only: a copy taken mid-flight is superseded before
    // the dwell that wanted it can read a byte (README.md § Cold reads).
    if (refillInFlight(this.refill)) return;
    this.mirror.stage(this.av, this.generation);
  }

  /** The parity check of README.md § The prepass kernel: the same march as
   *  a fragment pass over the same positions, at the last computed camera,
   *  bit-compared against the whole buffer. Dev-console only. */
  async verifyParity(): Promise<AvParityReport | null> {
    if (!this.isActive() || this.av === null || this.dispatchOrder === null) return null;
    this.fillWhole();
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
    let moved = false;
    for (const key of STAR_VISIBILITY_BOUND_KEYS) {
      const next = this.uniforms[key].value;
      if (this.gateBounds[key].value === next) continue;
      this.gateBounds[key].value = next;
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
    this.uniforms.uAvPrepassEnabled.value = 0;
    this.slots.setAvBuffer(null);
    this.slots.refill.setBuffers(null, null);
    this.slots.refill.arm.value = 0;
    // The kernels' bind groups reference every buffer below: drop them first.
    this.fillKernel?.dispose();
    this.refillKernel?.dispose();
    for (const attr of [
      this.av, this.positions, this.order, this.stamps, this.refillTable,
    ]) {
      if (attr !== null) disposeStorageAttribute(this.renderer, attr);
    }
    this.fillKernel = null;
    this.refillKernel = null;
    this.av = null;
    this.positions = null;
    this.order = null;
    this.stamps = null;
    this.refillTable = null;
    this.dispatchOrder = null;
    this.mirror.dispose();
    this.refill = idleRefill();
    this.lastView = null;
    this.hasComputed = false;
    this.dirty = true;
    this.lastCamX = Infinity;
    this.lastCamY = Infinity;
    this.lastCamZ = Infinity;
  }
}
