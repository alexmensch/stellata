// The HDR seam: one float render target every light-emitting layer draws
// into, resolved to the canvas by one tone-map pass. See README.md.

import * as THREE from 'three';
import { fullscreenTriangleGeometry } from '../util/fullscreen-pass';
import fullscreenVert from '../util/fullscreen-pass.vert.glsl?raw';
import tonemapFrag from './tonemap.frag.glsl?raw';
import tonemapChunk from './tonemap.glsl?raw';
import emissionChunk from './emission.glsl?raw';
import { angularToPx } from '../camera/controls/star-geometry';
import { DEFAULT_FOV } from '../filters/filter-state';
import { DR_MAG, HIGHLIGHT_DESAT, tonemapWhitePoint } from './tonemap-pure';
import { pixelSolidAngleArcsec2 } from './emission-pure';
import { BASE_EPOCH_EXPOSURE } from './exposure/exposure-epoch';
import {
  clearChromeBindings,
  setChromeOperatorActive,
  setChromeWhitePoint,
} from './chrome/chrome-colour';
import { bindStatisticGate } from './statistic/statistic-attachment';

(THREE.ShaderChunk as Record<string, string>)['stellata_tonemap'] = tonemapChunk;
(THREE.ShaderChunk as Record<string, string>)['stellata_hdr_emission'] = emissionChunk;

/** Ship gate for the HDR epic — **live**. Stars, the Milky Way, and the
 *  planet layers all emit physical luminance now, so the target is the
 *  default path and the operator runs once at the resolve.
 *  `stellata.setHdrEnabled(false)` is the A/B: it parks every emitter on
 *  its inline operator and returns chrome to authored colours
 *  (README.md § Dev switches). `hdr-pipeline.test.ts` pins this value.
 *
 *  Un-shelving a layer that still carries a pre-HDR encoding — the Local
 *  Group emission pass is the one left (`LG_EMISSION_SHELVED`) — puts a
 *  mis-calibrated emitter on the shared scale. Convert first. */
export const HDR_DEFAULT_ENABLED = true;

/** The uniforms every physical emitter binds **by reference**, so the
 *  seam's state reaches all of them with one write. `uHdrTarget` is the
 *  branch: 0 means the fragment lands straight on the canvas and the
 *  emitter must apply `stellata_tonemap` itself (README.md § Fallback).
 *  `uExposure` is the one exposure control, written by `FilterController`
 *  from the magnitude limit; everything else here is `HdrPipeline`'s.
 *  The resolve pass shares the same white-point and desaturation objects,
 *  so the inline path and the fullscreen path can never disagree. */
export interface HdrEmitterUniforms {
  uHdrTarget: THREE.IUniform<number>;
  uWhitePoint: THREE.IUniform<number>;
  uHighlightDesat: THREE.IUniform<number>;
  uExposure: THREE.IUniform<number>;
  uOmegaPxArcsec2: THREE.IUniform<number>;
}

export const HDR_EMITTER_UNIFORM_KEYS = [
  'uHdrTarget',
  'uWhitePoint',
  'uHighlightDesat',
  'uExposure',
  'uOmegaPxArcsec2',
] as const satisfies readonly (keyof HdrEmitterUniforms)[];

/** Pick the seam's slots out of a wider shared-uniforms object, keeping
 *  each `{ value }` slot's identity — an emitter that copied the values
 *  would tone-map inline into an already-tone-mapped target the moment
 *  `HdrPipeline` rewrote `uHdrTarget`. Mirrors
 *  `pickPerceptualDiscUniforms`; used by the planet layers, which read the
 *  star pipeline's map rather than holding the pipeline. */
export function pickHdrEmitterUniforms<T extends HdrEmitterUniforms>(
  src: T,
): HdrEmitterUniforms {
  const out: Record<string, THREE.IUniform> = {};
  for (const key of HDR_EMITTER_UNIFORM_KEYS) {
    out[key] = src[key];
  }
  return out as unknown as HdrEmitterUniforms;
}

/** `uHdrTarget` seeds to 0 and `HdrPipeline`'s constructor rewrites it
 *  before the first frame, as it does `uWhitePoint` and `uHighlightDesat`
 *  (both live dev knobs, rewritten by `syncMode`). `uExposure` seeds at
 *  the base epoch; `ExposureController` owns every later write
 *  (`exposure/README.md`). `uOmegaPxArcsec2` seeds at the default FOV
 *  over a 1000 px viewport and is rewritten by `setPixelSolidAngle` on
 *  every FOV / resize change. */
export function makeHdrEmitterUniforms(): HdrEmitterUniforms {
  return {
    uHdrTarget: { value: 0 },
    uWhitePoint: { value: tonemapWhitePoint() },
    uHighlightDesat: { value: HIGHLIGHT_DESAT },
    uExposure: { value: BASE_EPOCH_EXPOSURE },
    uOmegaPxArcsec2: {
      value: pixelSolidAngleArcsec2(angularToPx(1000, (DEFAULT_FOV * Math.PI) / 180)),
    },
  };
}

export class HdrPipeline {
  /** False when no float-renderable colour buffer exists. The instance
   *  is inert and every layer renders straight to the canvas —
   *  README.md § Fallback. */
  readonly supported: boolean;

  /** Bound by reference into every physical emitter's uniform map. */
  readonly emitterUniforms: HdrEmitterUniforms = makeHdrEmitterUniforms();

  private readonly renderer: THREE.WebGLRenderer;
  private readonly gl: WebGL2RenderingContext;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera();
  private readonly size = new THREE.Vector2();
  private rt: THREE.WebGLMultipleRenderTargets | null = null;
  private material: THREE.RawShaderMaterial | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private enabled = HDR_DEFAULT_ENABLED;
  private tonemapOn = true;
  private chart = false;
  private drMag = DR_MAG;
  private highlightDesat = HIGHLIGHT_DESAT;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    const gl = renderer.getContext() as WebGL2RenderingContext;
    this.gl = gl;
    this.supported =
      gl.getExtension('EXT_color_buffer_float') !== null ||
      gl.getExtension('EXT_color_buffer_half_float') !== null;
    // Before any layer is constructed, so chrome registers its colours
    // and emitters seed their branch against the right mode on a context
    // that can't take the target.
    this.syncMode();
  }

  /** The target is a full drawing-buffer RGBA16F plus its RG16F statistic
   *  attachment and a 24-bit depth attachment — a couple of hundred MB of
   *  VRAM at 2x DPR on a large display. Allocate it on first use so a
   *  build shipping with HDR_DEFAULT_ENABLED false costs nothing. */
  private ensureResources(): boolean {
    if (this.rt !== null) return true;
    if (!this.supported) return false;

    this.renderer.getDrawingBufferSize(this.size);
    this.rt = new THREE.WebGLMultipleRenderTargets(this.size.x, this.size.y, 2, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    this.rt.texture[0].colorSpace = THREE.LinearSRGBColorSpace;
    // Half attachment 0's memory, and the reduction reads its missing
    // alpha as 1 — which is exactly the level-0 weight
    // (exposure/reduction/README.md § The chain).
    this.rt.texture[1].format = THREE.RGFormat;
    this.rt.texture[1].colorSpace = THREE.LinearSRGBColorSpace;

    this.geometry = fullscreenTriangleGeometry();
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        uHdrTexture: { value: this.rt.texture[0] },
        uWhitePoint: this.emitterUniforms.uWhitePoint,
        uHighlightDesat: this.emitterUniforms.uHighlightDesat,
        uTonemapEnabled: { value: this.tonemapOn ? 1 : 0 },
      },
      vertexShader: fullscreenVert,
      fragmentShader: tonemapFrag,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    const mesh = new THREE.Mesh(this.geometry, this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.syncMode();
    return true;
  }

  /** Bind the surface the scene draws into. Call immediately before the
   *  main render; the local depth pass inherits the binding, which is
   *  what puts its repaint into the same target.
   *
   *  The explicit clear is the one place attachment 1 is written with the
   *  gate open: the renderer's own auto-clear runs after this, with the
   *  gate shut, so without it the statistic would accumulate across
   *  frames forever. It costs a redundant clear of attachment 0. */
  bind(): void {
    const target = this.wantsTarget() && this.ensureResources() ? this.rt : null;
    this.renderer.setRenderTarget(target);
    if (target === null) return;
    this.openStatisticGate();
    this.renderer.clear();
    this.closeStatisticGate();
  }

  /** Tone-map the target onto the canvas. Must pair with every `bind()`. */
  resolve(): void {
    if (!this.wantsTarget() || this.rt === null) return;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
  }

  /** The statistic attachment — flux-correct luminance in R, peak-correct
   *  in G, written only by the emitters `markStatisticEmitter` admitted,
   *  and reduced by `exposure/reduction/README.md`.
   *
   *  Null whenever it does not carry this frame's light: before the target
   *  exists, under the fallback path, and in chart mode, where nothing
   *  renders into the target at all. */
  statisticTexture(): THREE.Texture | null {
    if (this.rt === null || !this.wantsTarget()) return null;
    return this.rt.texture[1];
  }

  /** Attachment 1 is NONE at rest, so a draw that never asks for it can
   *  never reach the statistic. Three sets its own `drawBuffers` when it
   *  first binds an MRT target; every write here lands after that and the
   *  resting state is restored on the way out, so a mid-frame re-bind
   *  cannot leave the gate open. */
  private openStatisticGate = (): void => {
    const gl = this.gl;
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
  };

  private closeStatisticGate = (): void => {
    const gl = this.gl;
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.NONE]);
  };

  /** Pixel solid angle for surface-brightness emitters. `pxPerRadian` is
   *  `angularToPx(viewportHeightCssPx, fovYRad)` — CSS pixels, so the
   *  scene's brightness is `devicePixelRatio`-independent. Every FOV
   *  change and every resize has to reach this. */
  setPixelSolidAngle(pxPerRadian: number): void {
    this.emitterUniforms.uOmegaPxArcsec2.value = pixelSolidAngleArcsec2(pxPerRadian);
  }

  /** Re-derives from the renderer's drawing-buffer size, so it covers
   *  window resize and pixel-ratio changes alike. */
  syncSize(): void {
    if (this.rt === null) return;
    this.renderer.getDrawingBufferSize(this.size);
    this.rt.setSize(this.size.x, this.size.y);
  }

  /** Chart mode is a full bypass — direct to canvas, no tone-map, so
   *  chart output stays pixel-identical across the HDR epic. */
  setChartMode(on: boolean): void {
    this.chart = on;
    this.syncMode();
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.syncMode();
  }

  /**
   * Magnitudes of range from the threshold floor to full white — the
   * operator's shape, as a dev knob (README.md § Dev switches). Moves the
   * star field and the Milky Way band together, and re-authors every
   * chrome colour, since the mapping inverts against this white point.
   *
   * Extended Reinhard is already at 0.95 of full scale by `L` = 20
   * whatever the white point is, so raising this buys hue survival at the
   * top end and almost no visible gradient. Detail up there needs a
   * longer *shoulder*, which is a different change.
   */
  setDynamicRangeMag(drMag: number): void {
    this.drMag = drMag;
    this.syncMode();
  }

  getDynamicRangeMag(): number { return this.drMag; }

  /** Strength of the mix toward white above the knee — the other half of
   *  the top end's look, and the term that decides whether a clipping
   *  source keeps its hue. */
  setHighlightDesat(desat: number): void {
    this.highlightDesat = desat;
    this.syncMode();
  }

  getHighlightDesat(): number { return this.highlightDesat; }

  /** Park the resolve on straight pass-through, keeping the target. The
   *  A/B that isolates a plumbing regression from a calibration one. */
  setTonemapEnabled(on: boolean): void {
    this.tonemapOn = on;
    // May run before the target exists (HDR off at boot); ensureResources
    // seeds the uniform from this field, so it is the single source.
    if (this.material !== null) {
      this.material.uniforms.uTonemapEnabled.value = on ? 1 : 0;
    }
    this.syncMode();
  }

  /** Whether the scene should render into the target this frame. Does not
   *  imply the target exists yet — `bind()` allocates on demand. */
  private wantsTarget(): boolean {
    return this.supported && this.enabled && !this.chart;
  }

  /** Fan the seam's state out to the two things outside this class that
   *  depend on it: chrome's inverse mapping, which is only correct while
   *  the operator it inverts is running *and* only against the white point
   *  it inverts, and the physical emitters, which tone-map inline whenever
   *  the target isn't bound. Both read the same `wantsTarget()`, so the
   *  chart bypass reaches them for free. Every state change routes through
   *  here, which is what makes the operator's two shape knobs live. */
  private syncMode(): void {
    const targetActive = this.wantsTarget();
    const whitePoint = tonemapWhitePoint(this.drMag);
    this.emitterUniforms.uHdrTarget.value = targetActive ? 1 : 0;
    this.emitterUniforms.uWhitePoint.value = whitePoint;
    this.emitterUniforms.uHighlightDesat.value = this.highlightDesat;
    setChromeWhitePoint(whitePoint);
    setChromeOperatorActive(targetActive && this.tonemapOn);
    // Unbound whenever no MRT framebuffer is current: `drawBuffers` on the
    // default framebuffer accepts only BACK or NONE, so an emitter's hook
    // firing on the canvas path would be a GL error, not a no-op.
    const gateLive = targetActive && this.rt !== null;
    bindStatisticGate(
      gateLive ? this.openStatisticGate : null,
      gateLive ? this.closeStatisticGate : null,
    );
  }

  dispose(): void {
    this.scene.clear();
    this.rt?.dispose();
    this.material?.dispose();
    this.geometry?.dispose();
    this.rt = null;
    this.material = null;
    this.geometry = null;
    this.enabled = HDR_DEFAULT_ENABLED;
    this.tonemapOn = true;
    this.chart = false;
    this.drMag = DR_MAG;
    this.highlightDesat = HIGHLIGHT_DESAT;
    this.syncMode();
    clearChromeBindings();
  }
}
