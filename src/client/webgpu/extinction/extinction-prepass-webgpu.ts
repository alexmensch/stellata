// The per-star A_V cache on WebGPU: extinction-prepass.ts's fullscreen
// march into a star-indexed float target, with the synchronous readPixels
// replaced by the renderer's mapAsync-staged read. README.md.

import {
  DataTexture, FloatType, NearestFilter, NoBlending, NodeMaterial, QuadMesh,
  RGBAFormat, RedFormat, RenderTarget, Vector3,
  type Data3DTexture, type WebGPURenderer,
} from 'three/webgpu';
import { Fn, ivec2, screenCoordinate, texture, uniform, vec4 } from 'three/tsl';
import type { ExtinctionPrepassSeam, ExtinctionPrepassUniforms } from '../../star-pipeline/extinction/extinction-seam';
import {
  AV_TEX_WIDTH,
  RECOMPUTE_EPSILON_PC,
  avTexHeight,
  movedBeyondEpsilon,
  packPositionsRgba,
} from '../../star-pipeline/extinction/extinction-prepass-pure';
import type { SharedUniformNodes } from '../shared-uniform-nodes';
import { dustRaymarchAvTsl } from './dust-raymarch-tsl';
import type { ExtinctionTextureNodes } from './extinction-texture-nodes';

export interface WebGpuExtinctionPrepassOptions {
  renderer: WebGPURenderer;
  /** Absolute (heliocentric ICRS) star positions, xyz-interleaved —
   *  catalog.positions, NOT the floating-origin local buffer. */
  positions: Float32Array;
  count: number;
  nodes: SharedUniformNodes;
  /** The two texture slots, shared by object identity with the star
   *  layer's: one `attachDust` write reaches both the prepass march and
   *  the vertex fallback, and this pass points the A_V slot at its own
   *  target rather than the shell wiring it. */
  textures: ExtinctionTextureNodes;
  uniforms: ExtinctionPrepassUniforms;
}

export class WebGpuExtinctionPrepass implements ExtinctionPrepassSeam {
  /** Float render targets are core WebGPU — there is no
   *  EXT_color_buffer_float to gate on and no fallback branch to port. */
  readonly supported = true;

  private readonly renderer: WebGPURenderer;
  private readonly uniforms: ExtinctionPrepassUniforms;
  private readonly textures: ExtinctionTextureNodes;
  private rt: RenderTarget | null;
  private posTex: DataTexture | null;
  private material: NodeMaterial | null;
  private quad: QuadMesh | null;
  private readonly absCameraPos = uniform(new Vector3());

  // Readback memo, keyed by star index. The target's contents are the only
  // other input and update() is the only thing that writes them, so
  // clearing it there is the whole invalidation rule.
  private readonly avCache = new Map<number, number>();
  // Reads in flight, so a pointermove sweep re-asking for the same star
  // every frame issues one copy rather than one per frame. Keyed the same
  // way and cleared on the same recompute.
  private readonly avPending = new Set<number>();
  /** Bumped on every recompute: a read that resolves against an older
   *  target's contents lands in a generation nobody will consult. */
  private generation = 0;

  private dirty = true;
  private hasComputed = false;
  private forceDisabled = false;
  private disposed = false;
  private lastCamX = Infinity;
  private lastCamY = Infinity;
  private lastCamZ = Infinity;

  constructor({
    renderer, positions, count, nodes, textures, uniforms,
  }: WebGpuExtinctionPrepassOptions) {
    this.renderer = renderer;
    this.uniforms = uniforms;
    this.textures = textures;

    const height = avTexHeight(count);
    this.posTex = new DataTexture(
      packPositionsRgba(positions, count),
      AV_TEX_WIDTH, height, RGBAFormat, FloatType,
    );
    this.posTex.minFilter = NearestFilter;
    this.posTex.magFilter = NearestFilter;
    this.posTex.needsUpdate = true;

    this.rt = new RenderTarget(AV_TEX_WIDTH, height, {
      format: RedFormat,
      type: FloatType,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });

    const posTexNode = texture(this.posTex);
    this.material = new NodeMaterial();
    this.material.name = 'extinction-prepass-tsl';
    // One fragment per star: the position texture's texel at this
    // fragment's own coordinate is the star, so the fullscreen quad needs
    // no vertex work of its own. Padding texels past the catalog hold the
    // origin — their marches are wasted but never read. The target is
    // single-channel; the extra components of the vec4 are dropped.
    this.material.fragmentNode = Fn(() => {
      const starAbs = posTexNode.load(ivec2(screenCoordinate)).rgb;
      return vec4(
        dustRaymarchAvTsl(nodes, textures.dust, this.absCameraPos, starAbs), 0, 0, 1);
    })();
    this.material.depthTest = false;
    this.material.depthWrite = false;
    this.material.blending = NoBlending;
    this.quad = new QuadMesh(this.material);
    // The consumer's texture slot points here for this instance's whole
    // life; `uAvPrepassEnabled` is what gates the read, so a target that
    // has not been computed yet is bound but never fetched.
    textures.setAvPrepassTexture(this.rt.texture);
  }

  markDirty(): void {
    this.dirty = true;
  }

  setEnabled(on: boolean): void {
    this.forceDisabled = !on;
    this.syncConsumerUniforms();
  }

  isActive(): boolean {
    return this.hasComputed && !this.forceDisabled && this.rt !== null;
  }

  update(absCamX: number, absCamY: number, absCamZ: number): void {
    if (this.rt === null || this.quad === null) return;
    if (this.dustTexture === null) return;
    if (this.forceDisabled) return;
    const moved = movedBeyondEpsilon(
      this.lastCamX, this.lastCamY, this.lastCamZ,
      absCamX, absCamY, absCamZ,
      RECOMPUTE_EPSILON_PC,
    );
    if (!this.dirty && !moved) return;

    this.absCameraPos.value.set(absCamX, absCamY, absCamZ);
    // Ends at the canvas, not at whatever was bound on entry: every pass
    // on this backend keeps that contract, so no pass may run inside
    // another's binding (../hdr/reduction-webgpu.ts is the twin). The
    // WebGL2 build save/restores instead — README.md § The prepass draw.
    this.renderer.setRenderTarget(this.rt);
    this.quad.render(this.renderer);
    this.renderer.setRenderTarget(null);

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
   * Raw physical A_V for one star, out of the very texel the star vertex
   * stage fetches. **A cold read returns null and warms the memo instead**
   * — WebGPU offers no synchronous readback, so the value lands a frame or
   * two later and the caller sees the no-cache answer until then
   * (README.md § Cold reads). A warm read is free and exact.
   *
   * Event-rate only, exactly as the WebGL twin: never sweep it over the
   * catalog. Each cold index costs one `copyTextureToBuffer` + map.
   */
  readAvMag(idx: number): number | null {
    if (!this.isActive()) return null;
    const cached = this.avCache.get(idx);
    if (cached !== undefined) return cached;
    if (this.avPending.has(idx)) return null;
    this.avPending.add(idx);
    const generation = this.generation;
    this.renderer
      .readRenderTargetPixelsAsync(
        this.rt!, idx % AV_TEX_WIDTH, (idx / AV_TEX_WIDTH) | 0, 1, 1)
      .then((pixels) => {
        if (this.disposed || generation !== this.generation) return;
        this.avPending.delete(idx);
        this.avCache.set(idx, (pixels as Float32Array)[0]);
      })
      .catch(() => {
        if (this.disposed || generation !== this.generation) return;
        this.avPending.delete(idx);
      });
    return null;
  }

  /** The consumer's `uAvPrepassEnabled` gate is the one shared-map write
   *  this pass owns on either backend. `uAvPrepassTex` is a texture slot,
   *  which the node mirror does not carry — the star layer binds
   *  `avTexture` directly (../README.md § Shared uniform nodes). */
  private syncConsumerUniforms(): void {
    this.uniforms.uAvPrepassEnabled.value = this.isActive() ? 1 : 0;
  }

  private get dustTexture(): Data3DTexture | null {
    return this.uniforms.uDustTexture.value;
  }

  dispose(): void {
    this.disposed = true;
    this.uniforms.uAvPrepassEnabled.value = 0;
    this.textures.setAvPrepassTexture(null);
    this.rt?.dispose();
    this.posTex?.dispose();
    this.material?.dispose();
    this.rt = null;
    this.posTex = null;
    this.material = null;
    this.quad = null;
    this.avCache.clear();
    this.avPending.clear();
    this.hasComputed = false;
    this.dirty = true;
    this.lastCamX = Infinity;
    this.lastCamY = Infinity;
    this.lastCamZ = Infinity;
  }
}
