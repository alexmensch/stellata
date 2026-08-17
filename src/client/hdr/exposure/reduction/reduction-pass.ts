// The GPU reduction of the HDR target's statistic attachment down to one
// texel, and the frame-late readback of it. See README.md.

import * as THREE from 'three';
import { fullscreenTriangleGeometry } from '../../../util/fullscreen-pass';
import fullscreenVert from '../../../util/fullscreen-pass.vert.glsl?raw';
import reduceFrag from './reduce.frag.glsl?raw';
import { ReductionReadback } from './reduction-readback';
import { reductionLevelSizes } from './reduction-pure';

/** One frame's reduced statistic. The two luminance channels are still in
 *  the exposure the frame was RENDERED with — `rescaleToBaseExposure` is
 *  the caller's step, because only the caller knows the instrument's base
 *  exposure. `coverage` is a fraction and needs no rescale. */
export interface ReducedStatistic {
  meanL: number;
  surfaceL: number;
  coverage: number;
  renderExposure: number;
}

interface Level {
  target: THREE.WebGLRenderTarget;
  width: number;
  height: number;
}

export class LuminanceReduction {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera();
  private readonly geometry = fullscreenTriangleGeometry();
  private readonly material: THREE.RawShaderMaterial;
  private levels: Level[] = [];
  private floatRenderable: boolean | null = null;
  private sourceWidth = 0;
  private sourceHeight = 0;
  private readback: ReductionReadback | null = null;
  private pendingExposure = 0;
  private latest: ReducedStatistic | null = null;
  // Whether the readback in flight was requested with the draws skipped,
  // and so carries a texel from an older frame than pendingExposure
  // describes. Landing it would feed the cut a mismatched pair.
  private pendingIsStale = false;

  constructor() {
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        uSource: { value: null },
        uSourceSize: { value: new THREE.Vector2() },
        uFromStatistic: { value: 0 },
      },
      vertexShader: fullscreenVert,
      fragmentShader: reduceFrag,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    const mesh = new THREE.Mesh(this.geometry, this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }

  /**
   * Reduce `source` — the statistic attachment, at the drawing buffer's
   * size — and ask for its one texel back. A frame whose predecessor has
   * not landed does no GPU work at all, so the measurement refreshes every
   * other frame at worst, far inside `ADAPT_SLEW_TAU_S`.
   *
   * `renderExposure` is the scalar the frame was drawn with, captured here
   * because the readback outlives it.
   *
   * `parked` skips the draws exactly as `enabled = false` does — fence
   * kept, landed texel dropped — driven per frame by the adaptation park
   * (`../README.md` § Parking the measurement) rather than by a debug
   * toggle.
   *
   * Leaves the render target at the canvas, the same contract the local
   * depth pass keeps.
   */
  /** Debug kill switch (frame-cost differentials): false skips the chain's
   *  DRAWS while still requesting the readback, so the statistic freezes
   *  at its last landed reading (unlike reset(), which drops it) and the
   *  fence stays in the frame. Dropping the fence too would price the
   *  loss of the frame's only submission barrier, not the draws. */
  enabled = true;

  /** Debug (frame-cost differentials): keep issuing the readback while the
   *  statistic is unavailable — chart mode — so the frame keeps its only
   *  ANGLE submission barrier and the `hdrChain` row prices the chain
   *  rather than the loss of that barrier. Off in production, where chart
   *  mode has no use for a readback it would pay for every frame. */
  fenceWhileParked = false;

  /** Readbacks issued so far. Cadence is emergent, not pinned — README.md
   *  § Latency. */
  get readbackRequests(): number {
    return this.readback?.requestsIssued ?? 0;
  }

  /** A readback in flight, so `measure()` will do no GPU work this frame
   *  whatever it is passed. The adaptation park reads it to open a probe
   *  on a frame the chain can actually draw (`../README.md` § Parking the
   *  measurement). */
  get readbackPending(): boolean {
    return this.readback?.pending ?? false;
  }

  measure(
    renderer: THREE.WebGLRenderer,
    source: THREE.Texture | null,
    width: number,
    height: number,
    renderExposure: number,
    parked: boolean,
  ): void {
    this.poll();
    const gl = renderer.getContext() as WebGL2RenderingContext;
    // The chain's last level is RGBA32F, which needs the full float
    // extension — half-float-only hardware gets no measurement at all and
    // therefore no cut, the same tier HdrPipeline parks the whole seam on
    // (../../README.md § Fallback). Degrades to wide open rather than to a
    // wrong exposure.
    this.floatRenderable ??= gl.getExtension('EXT_color_buffer_float') !== null;
    if (!this.floatRenderable) return;
    this.readback ??= new ReductionReadback(gl, 1);
    if (this.readback.pending) return;
    this.ensureLevels(width, height);
    if (this.levels.length === 0) return;

    const drawing = this.enabled && !parked && source !== null;
    if (drawing) {
      let src = source;
      let srcW = width;
      let srcH = height;
      for (const [i, level] of this.levels.entries()) {
        this.material.uniforms.uSource.value = src;
        (this.material.uniforms.uSourceSize.value as THREE.Vector2).set(srcW, srcH);
        this.material.uniforms.uFromStatistic.value = i === 0 ? 1 : 0;
        renderer.setRenderTarget(level.target);
        renderer.render(this.scene, this.camera);
        src = level.target.texture;
        srcW = level.width;
        srcH = level.height;
      }
    } else {
      renderer.setRenderTarget(this.levels[this.levels.length - 1].target);
    }
    // The last level is still bound, which is the framebuffer readPixels
    // reads from. Disabled, that texel is from an older frame: the request
    // goes out anyway to keep the fence in the frame, and poll() drops
    // what it lands so the statistic holds still.
    this.readback.request(1);
    this.pendingIsStale = !drawing;
    if (drawing) this.pendingExposure = renderExposure;
    renderer.setRenderTarget(null);
  }

  /** The most recent landed measurement, or null until the first one
   *  arrives. Frames before that keep whatever cut the statistic already
   *  holds. */
  current(): ReducedStatistic | null {
    this.poll();
    return this.latest;
  }

  /** Chart mode measures nothing; dropping the last reading is what stops
   *  the frame that re-enters the scene adapting to a stale one. */
  reset(): void {
    this.latest = null;
  }

  dispose(): void {
    for (const level of this.levels) level.target.dispose();
    this.levels = [];
    this.sourceWidth = 0;
    this.sourceHeight = 0;
    this.readback?.dispose();
    this.readback = null;
    this.floatRenderable = null;
    this.latest = null;
    this.pendingExposure = 0;
    this.pendingIsStale = false;
    this.geometry.dispose();
    this.material.dispose();
    this.scene.clear();
  }

  private poll(): void {
    const landed = this.readback?.poll();
    if (landed === undefined || landed === null) return;
    if (this.pendingIsStale) {
      this.pendingIsStale = false;
      return;
    }
    this.latest = {
      meanL: landed.pixels[0],
      surfaceL: landed.pixels[1],
      coverage: landed.pixels[2],
      renderExposure: this.pendingExposure,
    };
  }

  /** The chain halves with `ceil` down to 1x1. Only the last level is
   *  RGBA32F — `readPixels` guarantees the RGBA/FLOAT pair for that format
   *  alone, and one texel of it costs nothing. */
  private ensureLevels(width: number, height: number): void {
    if (this.sourceWidth === width && this.sourceHeight === height) return;
    for (const level of this.levels) level.target.dispose();
    this.sourceWidth = width;
    this.sourceHeight = height;
    const sizes = reductionLevelSizes(width, height);
    this.levels = sizes.map(([w, h], i) => ({
      target: new THREE.WebGLRenderTarget(w, h, {
        type: i === sizes.length - 1 ? THREE.FloatType : THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        depthBuffer: false,
        stencilBuffer: false,
        generateMipmaps: false,
      }),
      width: w,
      height: h,
    }));
  }
}
