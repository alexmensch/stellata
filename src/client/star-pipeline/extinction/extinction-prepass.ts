// Per-star A_V cache: renders one camera→star dust raymarch per star
// into a star-indexed float target, recomputed only when the camera
// moves beyond RECOMPUTE_EPSILON_PC. See README.md § Dust extinction.

import * as THREE from 'three';
import prepassVert from '../../util/fullscreen-pass.vert.glsl?raw';
import prepassFrag from './extinction-prepass.frag.glsl?raw';
import { fullscreenTriangleGeometry } from '../../util/fullscreen-pass';
import {
  AV_TEX_WIDTH,
  RECOMPUTE_EPSILON_PC,
  avTexHeight,
  packPositionsRgba,
  movedBeyondEpsilon,
} from './extinction-prepass-pure';

/** Uniform value-objects shared by reference with the star pipeline's
 *  sharedUniforms map: the dust-field inputs the prepass march reads,
 *  and the two consumer uniforms it owns the writes to. */
export interface ExtinctionPrepassUniforms {
  uDustTexture: { value: THREE.Data3DTexture | null };
  uDustBoundsPc: { value: number };
  uDustDensityMin: { value: number };
  uDustLogRatio: { value: number };
  uDustAvPerDensityPc: { value: number };
  uAvPrepassTex: { value: THREE.Texture | null };
  uAvPrepassEnabled: { value: number };
}

export interface ExtinctionPrepassOptions {
  renderer: THREE.WebGLRenderer;
  /** Absolute (heliocentric ICRS) star positions, xyz-interleaved —
   *  catalog.positions, NOT the floating-origin local buffer. */
  positions: Float32Array;
  count: number;
  uniforms: ExtinctionPrepassUniforms;
}

export class ExtinctionPrepass {
  /** False when EXT_color_buffer_float is unavailable — the instance is
   *  inert and star.vert stays on its in-vertex raymarch fallback. */
  readonly supported: boolean;

  private renderer: THREE.WebGLRenderer;
  private uniforms: ExtinctionPrepassUniforms;
  private rt: THREE.WebGLRenderTarget | null = null;
  private posTex: THREE.DataTexture | null = null;
  private material: THREE.RawShaderMaterial | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera();

  private readonly avScratch = new Float32Array(4);
  // Readback memo, keyed by star index. The target's contents are the
  // only other input, and update() is the only thing that writes them —
  // so clearing it there is the whole invalidation rule. Without this a
  // hover in a dense field stalls the pipeline once per candidate, and
  // pointermove outruns the frame rate.
  private readonly avCache = new Map<number, number>();

  private dirty = true;
  private hasComputed = false;
  private forceDisabled = false;
  private lastCamX = Infinity;
  private lastCamY = Infinity;
  private lastCamZ = Infinity;

  constructor({ renderer, positions, count, uniforms }: ExtinctionPrepassOptions) {
    this.renderer = renderer;
    this.uniforms = uniforms;
    this.supported =
      renderer.getContext().getExtension('EXT_color_buffer_float') !== null;
    if (!this.supported) return;

    const height = avTexHeight(count);
    this.posTex = new THREE.DataTexture(
      packPositionsRgba(positions, count),
      AV_TEX_WIDTH,
      height,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    this.posTex.minFilter = THREE.NearestFilter;
    this.posTex.magFilter = THREE.NearestFilter;
    this.posTex.needsUpdate = true;

    this.rt = new THREE.WebGLRenderTarget(AV_TEX_WIDTH, height, {
      format: THREE.RedFormat,
      type: THREE.FloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });

    this.geometry = fullscreenTriangleGeometry();
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        uDustTexture: uniforms.uDustTexture,
        uDustBoundsPc: uniforms.uDustBoundsPc,
        uDustDensityMin: uniforms.uDustDensityMin,
        uDustLogRatio: uniforms.uDustLogRatio,
        uDustAvPerDensityPc: uniforms.uDustAvPerDensityPc,
        uPosTex: { value: this.posTex },
        uAbsCameraPos: { value: new THREE.Vector3() },
      },
      vertexShader: prepassVert,
      fragmentShader: prepassFrag,
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(this.geometry, this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }

  /** Invalidate the cache — next update() recomputes regardless of
   *  camera displacement. Called on dust attach and per chunk upload. */
  markDirty() {
    this.dirty = true;
  }

  /** Dev-console A/B switch: false parks star.vert on the in-vertex
   *  raymarch fallback and pauses cache maintenance (so the A/B never
   *  pays fill cost on the fallback side); the cache itself is kept and
   *  re-validates against camera displacement on re-enable. */
  setEnabled(on: boolean) {
    this.forceDisabled = !on;
    this.syncConsumerUniforms();
  }

  /** Whether star.vert is consuming the cache this frame (computed,
   *  float target present, not parked by the A/B switch). */
  isActive(): boolean {
    return this.hasComputed && !this.forceDisabled && this.rt !== null;
  }

  /** Per-frame hook, called with the camera's absolute (heliocentric
   *  ICRS) position before the main render. Recomputes the A_V target
   *  when dirty or the camera moved beyond epsilon; otherwise free. */
  update(absCamX: number, absCamY: number, absCamZ: number) {
    if (this.rt === null || this.material === null) return;
    if (this.uniforms.uDustTexture.value === null) return;
    if (this.forceDisabled) return;
    const moved = movedBeyondEpsilon(
      this.lastCamX, this.lastCamY, this.lastCamZ,
      absCamX, absCamY, absCamZ,
      RECOMPUTE_EPSILON_PC,
    );
    if (!this.dirty && !moved) return;

    (this.material.uniforms.uAbsCameraPos.value as THREE.Vector3)
      .set(absCamX, absCamY, absCamZ);
    const prevTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(prevTarget);

    this.avCache.clear();
    this.lastCamX = absCamX;
    this.lastCamY = absCamY;
    this.lastCamZ = absCamZ;
    this.dirty = false;
    this.hasComputed = true;
    this.syncConsumerUniforms();
  }

  /**
   * Raw physical A_V for one star, read out of the very texel
   * `star.vert.glsl` fetches — so a CPU consumer cannot drift from the
   * shader the way a re-implemented march would. Null when the cache is
   * inert (no `EXT_color_buffer_float`, no dust yet, or the dev A/B
   * switch parked it), where the shader is on its in-vertex fallback and
   * there is nothing to read.
   *
   * Memoised per star until the next `update()` recompute, so a repeat
   * read is free. A COLD read is a synchronous `readPixels` and stalls
   * the pipeline — the thing the reduction's fence exists to avoid
   * (`../../hdr/exposure/reduction/README.md` § Latency) — so this stays
   * an event-rate entry point: never sweep it over the catalog.
   */
  readAvMag(idx: number): number | null {
    if (this.rt === null || !this.isActive()) return null;
    const cached = this.avCache.get(idx);
    if (cached !== undefined) return cached;
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.rt);
    // RGBA/FLOAT is the pair readPixels guarantees on a float
    // attachment; the target's own RED/FLOAT is implementation-defined
    // and rejected outright by some drivers.
    gl.readPixels(
      idx % AV_TEX_WIDTH,
      (idx / AV_TEX_WIDTH) | 0,
      1, 1,
      gl.RGBA, gl.FLOAT,
      this.avScratch,
    );
    this.renderer.setRenderTarget(prev);
    const av = this.avScratch[0];
    this.avCache.set(idx, av);
    return av;
  }

  private syncConsumerUniforms() {
    const on = this.isActive();
    this.uniforms.uAvPrepassEnabled.value = on ? 1 : 0;
    this.uniforms.uAvPrepassTex.value = on ? this.rt!.texture : null;
  }

  dispose() {
    this.uniforms.uAvPrepassEnabled.value = 0;
    this.uniforms.uAvPrepassTex.value = null;
    this.rt?.dispose();
    this.posTex?.dispose();
    this.material?.dispose();
    this.geometry?.dispose();
    this.rt = null;
    this.posTex = null;
    this.material = null;
    this.geometry = null;
    this.avCache.clear();
    this.hasComputed = false;
    this.dirty = true;
    this.lastCamX = Infinity;
    this.lastCamY = Infinity;
    this.lastCamZ = Infinity;
  }
}
