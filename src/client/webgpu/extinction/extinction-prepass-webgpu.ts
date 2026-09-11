// The per-star A_V cache on WebGPU: one compute thread per star marching
// camera→star into a storage buffer the star vertex stage indexes by
// instance; a cold CPU read is one mapped copy of that star's float. README.md.

import {
  StorageBufferAttribute, Vector3, type ComputeNode, type WebGPURenderer,
} from 'three/webgpu';
import { Fn, compute, instanceIndex, storage, uniform } from 'three/tsl';
import type { ExtinctionPrepassSeam, ExtinctionPrepassUniforms } from '../../star-pipeline/extinction/extinction-seam';
import type { AvParityReport } from '../../star-pipeline/extinction/av-parity-pure';
import {
  RECOMPUTE_EPSILON_PC,
  movedBeyondEpsilon,
  packPositionsVec4Into,
} from '../../star-pipeline/extinction/extinction-prepass-pure';
import type { SharedUniformNodes } from '../tsl/shared-uniform-nodes';
import { disposeStorageAttribute } from '../tsl/storage-attribute';
import { dustRaymarchAvTsl } from './dust-raymarch-tsl';
import type { ExtinctionNodes } from './extinction-nodes';
import { runReferenceMarch } from './extinction-parity';

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
  uniforms: ExtinctionPrepassUniforms;
}

const AV_BYTES = Float32Array.BYTES_PER_ELEMENT;

export class WebGpuExtinctionPrepass implements ExtinctionPrepassSeam {
  /** Storage buffers and compute are core WebGPU — there is no
   *  EXT_color_buffer_float to gate on and no fallback branch to port. */
  readonly supported = true;

  private readonly renderer: WebGPURenderer;
  private readonly uniforms: ExtinctionPrepassUniforms;
  private readonly slots: ExtinctionNodes;
  private readonly nodes: SharedUniformNodes;
  private readonly count: number;
  private positions: StorageBufferAttribute | null;
  private av: StorageBufferAttribute | null;
  private kernel: ComputeNode | null;
  private readonly positionsNode: ReturnType<typeof storage<'vec4'>>;
  private readonly absCameraPos = uniform(new Vector3());

  // Readback memo, keyed by star index. The buffer's contents are the only
  // other input and update() is the only thing that writes them, so
  // clearing it there is the whole invalidation rule.
  private readonly avCache = new Map<number, number>();
  // Reads in flight, so a pointermove sweep re-asking for the same star
  // every frame issues one copy rather than one per frame. Keyed the same
  // way and cleared on the same recompute.
  private readonly avPending = new Set<number>();
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
    renderer, positions, count, nodes, slots, uniforms,
  }: WebGpuExtinctionPrepassOptions) {
    this.renderer = renderer;
    this.uniforms = uniforms;
    this.slots = slots;
    this.nodes = nodes;
    this.count = count;

    // vec4 slots, not vec3: WGSL has no packed vec3 in a storage buffer, and
    // an itemSize-3 attribute is the one the backend silently re-strides
    // (../README.md § One writer per buffer per submit).
    this.positions = new StorageBufferAttribute(count, 4);
    packPositionsVec4Into(this.positions.array as Float32Array, positions, count);
    this.av = new StorageBufferAttribute(count, 1);
    // The consumers' slot points here for this instance's whole life;
    // `uAvPrepassEnabled` is what gates the read, so a buffer that has not
    // been computed yet is bound but never fetched.
    slots.setAvBuffer(this.av);

    this.positionsNode = storage(this.positions, 'vec4', count).toReadOnly();
    // One thread per star. three guards the threads past `count` in the
    // last workgroup with an early return, so neither buffer is touched
    // out of range.
    this.kernel = compute(Fn(() => {
      slots.av.element(instanceIndex).assign(dustRaymarchAvTsl(
        nodes, slots.dust, this.absCameraPos,
        this.positionsNode.element(instanceIndex).xyz));
    })(), count);
    this.kernel.setName('extinction-prepass-compute');
  }

  markDirty(): void {
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
    if (!this.dirty && !moved) return;

    this.absCameraPos.value.set(absCamX, absCamY, absCamZ);
    this.renderer.compute(this.kernel);

    this.generation++;
    this.avCache.clear();
    this.avPending.clear();
    this.lastCamX = absCamX;
    this.lastCamY = absCamY;
    this.lastCamZ = absCamZ;
    this.dirty = false;
    this.hasComputed = true;
    this.syncConsumerUniforms();
  }

  /**
   * Raw physical A_V for one star, out of the very float the star vertex
   * stage indexes. **A cold read returns null and warms the memo instead**
   * — WebGPU offers no synchronous readback, so the value lands a frame or
   * two later and the caller sees the no-cache answer until then
   * (README.md § Cold reads). A warm read is free and exact.
   *
   * Event-rate only, exactly as the WebGL twin: never sweep it over the
   * catalog. Each cold index costs one 4-byte `copyBufferToBuffer` + map.
   */
  readAvMag(idx: number): number | null {
    if (!this.isActive()) return null;
    const cached = this.avCache.get(idx);
    if (cached !== undefined) return cached;
    if (this.avPending.has(idx)) return null;
    this.avPending.add(idx);
    const generation = this.generation;
    this.renderer
      .getArrayBufferAsync(this.av!, null, idx * AV_BYTES, AV_BYTES)
      .then((bytes) => {
        if (this.disposed || generation !== this.generation) return;
        this.avPending.delete(idx);
        this.avCache.set(idx, new Float32Array(bytes)[0]);
      })
      .catch(() => {
        if (this.disposed || generation !== this.generation) return;
        this.avPending.delete(idx);
      });
    return null;
  }

  /** The parity check of README.md § The prepass kernel: the same march as
   *  a fragment pass over the same positions, at the last computed camera,
   *  bit-compared against the whole buffer. Dev-console only. */
  async verifyParity(): Promise<AvParityReport | null> {
    if (!this.isActive() || this.av === null) return null;
    return runReferenceMarch({
      renderer: this.renderer,
      nodes: this.nodes,
      dust: this.slots.dust,
      positions: this.positionsNode,
      absCameraPos: this.absCameraPos,
      av: this.av,
      count: this.count,
    });
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
    // The kernel's bind group references both buffers: drop it first.
    this.kernel?.dispose();
    if (this.av !== null) disposeStorageAttribute(this.renderer, this.av);
    if (this.positions !== null) disposeStorageAttribute(this.renderer, this.positions);
    this.kernel = null;
    this.av = null;
    this.positions = null;
    this.avCache.clear();
    this.avPending.clear();
    this.hasComputed = false;
    this.dirty = true;
    this.lastCamX = Infinity;
    this.lastCamY = Infinity;
    this.lastCamZ = Infinity;
  }
}
