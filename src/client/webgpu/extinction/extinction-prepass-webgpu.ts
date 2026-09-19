// The per-star A_V cache on WebGPU: one compute thread per star marching
// camera→star into a storage buffer the star vertex stage indexes by
// instance, mirrored to the CPU in one mapped copy for the pick. README.md.

import {
  Matrix4, StorageBufferAttribute, Vector3, type ComputeNode, type WebGPURenderer,
} from 'three/webgpu';
import {
  Fn, If, bool, compute, distance, float, instanceIndex, int, max, storage, uint, uniform, vec4,
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
import { starQuadOffscreenTsl } from '../star/compaction/frustum-tsl';
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
import { AvMirror } from './mirror/av-mirror';
import {
  EXTINCTION_FRUSTUM_SLACK_PX, composeViewProjectionAbs, sameView,
} from './refill/refill-decision-pure';
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

/** `frustumMode` values: the whole catalogue marches, or only what the
 *  view sees and the generation has not stamped. */
const MODE_WHOLE = 0;
const MODE_FRUSTUM = 1;

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
   *  (refill/README.md § Only what is in frame). */
  private stamps: StorageBufferAttribute | null;
  private kernel: ComputeNode | null;
  private readonly positionsNode: ReturnType<typeof storage<'vec4'>>;
  private readonly orderNode: ReturnType<typeof storage<'uint'>>;
  private readonly stampsNode: ReturnType<typeof storage<'uint'>>;
  /** Dispatch slot → catalogue index, the CPU copy the parity check needs
   *  to put the reference march's slot-indexed target back into star order.
   *  Shares its array with the `order` buffer, so dispose has to drop both
   *  or the 1.48 MiB outlives the pass. */
  private dispatchOrder: Uint32Array | null;
  private readonly absCameraPos = uniform(new Vector3());
  /** Slot the running dispatch starts at (refill/README.md § The cursor).
   *  Zero for the whole-catalogue dispatches. */
  private readonly sliceBase = uniform(0, 'uint');
  private readonly frustumMode = uniform(MODE_WHOLE, 'uint');
  /** Starts past the zero the stamp buffer allocates with. */
  private readonly cameraGeneration = uniform(1, 'uint');
  private readonly viewProjectionAbs = uniform(new Matrix4());
  private readonly viewScratch = new Matrix4();
  private lastView: Matrix4 | null = null;
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
    renderer, positions, count, nodes, slots, uniforms, tables,
  }: WebGpuExtinctionPrepassOptions) {
    this.renderer = renderer;
    this.mirror = new AvMirror(renderer);
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
    this.stamps = new StorageBufferAttribute(new Uint32Array(count), 1);
    // The consumers' slot points here for this instance's whole life;
    // `uAvPrepassEnabled` is what gates the read, so a buffer that has not
    // been computed yet is bound but never fetched.
    slots.setAvBuffer(this.av);

    this.positionsNode = storage(this.positions, 'vec4', count).toReadOnly();
    this.orderNode = storage(this.order, 'uint', count).toReadOnly();
    this.stampsNode = storage(this.stamps, 'uint', count);
    // One thread per slot of the dispatched slice.
    // dispatch-order/README.md § Dispatch order.
    const gateBounds = this.gateBounds;
    this.visible = tables === null || gateBounds === null ? null
      : (self, starAbs) => starCacheVisibleTsl(
        gateBounds, tables, self, max(distance(starAbs, this.absCameraPos), 1e-30));
    const visible = this.visible;
    const slackNdc = float(EXTINCTION_FRUSTUM_SLACK_PX).div(nodes.uViewport);
    this.kernel = compute(Fn(() => {
      const slot = instanceIndex.add(this.sliceBase);
      // Ours, not three's: three's early return bounds `instanceIndex`, not
      // the slot (refill/README.md § The kernel bounds its own slot).
      If(slot.lessThan(uint(count)), () => {
        const self = int(this.orderNode.element(slot));
        const starAbs = this.positionsNode.element(slot).xyz;
        const refills = bool(true).toVar();
        If(this.frustumMode.equal(uint(MODE_FRUSTUM)), () => {
          const clip = this.viewProjectionAbs.mul(vec4(starAbs, 1.0)).toVar();
          const seen = starQuadOffscreenTsl(clip, slackNdc).not()
            .or(self.equal(nodes.uPinFocusToCenter));
          refills.assign(
            seen.and(this.stampsNode.element(self).notEqual(this.cameraGeneration)));
        });
        If(refills, () => {
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
          this.stampsNode.element(self).assign(this.cameraGeneration);
        });
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

  update(absCamX: number, absCamY: number, absCamZ: number, view?: ExtinctionView): void {
    if (this.kernel === null) return;
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
        this.viewProjectionAbs.value.copy(this.viewScratch);
        this.lastView = (this.lastView ?? new Matrix4()).copy(this.viewScratch);
      }
    }
    // The first fill is whole (refill/README.md § Three places).
    if (!this.hasComputed) {
      if (!bump) return;
      this.setCameraGeneration(absCamX, absCamY, absCamZ);
      this.dispatch(0, this.count, MODE_WHOLE);
      this.refill = idleRefill(this.count);
      this.hasComputed = true;
    } else {
      if (bump) {
        this.cameraGeneration.value += 1;
        this.setCameraGeneration(absCamX, absCamY, absCamZ);
      }
      const plan = planRefill(this.refill, bump || viewChanged, this.count, this.sliceLength);
      this.refill = plan.next;
      if (plan.base === null) return;
      this.dispatch(
        plan.base, plan.length, this.lastView === null ? MODE_WHOLE : MODE_FRUSTUM);
    }

    this.generation++;
    this.mirror.invalidate();
    this.dirty = false;
    this.syncConsumerUniforms();
  }

  /** see refill/README.md § The generation stamp */
  private setCameraGeneration(x: number, y: number, z: number): void {
    this.absCameraPos.value.set(x, y, z);
    this.lastCamX = x;
    this.lastCamY = y;
    this.lastCamZ = z;
  }

  /** `length` slots from `base`. Whole mode over every slot is the one that
   *  leaves the buffer belonging to a single camera (refill/README.md
   *  § Three places). */
  private dispatch(base: number, length: number, mode: number): void {
    if (this.kernel === null) return;
    this.frustumMode.value = mode;
    this.sliceBase.value = base;
    this.renderer.compute(this.kernel, length);
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
    // A parked cursor only: a copy taken mid-cycle is superseded before the
    // dwell that wanted it can read a byte (README.md § Cold reads).
    if (this.refill.base < this.count) return;
    this.mirror.stage(this.av, this.generation);
  }

  /** The parity check of README.md § The prepass kernel: the same march as
   *  a fragment pass over the same positions, at the last computed camera,
   *  bit-compared against the whole buffer. Dev-console only. */
  async verifyParity(): Promise<AvParityReport | null> {
    if (!this.isActive() || this.av === null || this.dispatchOrder === null) return null;
    // One camera behind the whole buffer (refill/README.md § Three places).
    this.dispatch(0, this.count, MODE_WHOLE);
    this.refill = idleRefill(this.count);
    this.generation++;
    this.mirror.invalidate();
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
    this.uniforms.uAvPrepassEnabled.value = 0;
    this.slots.setAvBuffer(null);
    // The kernel's bind group references all four buffers: drop it first.
    this.kernel?.dispose();
    if (this.av !== null) disposeStorageAttribute(this.renderer, this.av);
    if (this.positions !== null) disposeStorageAttribute(this.renderer, this.positions);
    if (this.order !== null) disposeStorageAttribute(this.renderer, this.order);
    if (this.stamps !== null) disposeStorageAttribute(this.renderer, this.stamps);
    this.kernel = null;
    this.av = null;
    this.positions = null;
    this.order = null;
    this.stamps = null;
    this.dispatchOrder = null;
    this.mirror.dispose();
    this.refill = idleRefill(this.count);
    this.lastView = null;
    this.hasComputed = false;
    this.dirty = true;
    this.lastCamX = Infinity;
    this.lastCamY = Infinity;
    this.lastCamZ = Infinity;
  }
}
