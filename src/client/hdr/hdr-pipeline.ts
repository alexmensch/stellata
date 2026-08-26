// The HDR seam: one float render target every light-emitting layer draws
// into, resolved to the canvas by one tone-map pass. See README.md.

import * as THREE from 'three';
import { fullscreenTriangleGeometry } from '../util/fullscreen-pass';
import fullscreenVert from '../util/fullscreen-pass.vert.glsl?raw';
import tonemapFrag from './tonemap/tonemap.frag.glsl?raw';
import tonemapChunk from './tonemap/tonemap.glsl?raw';
import emissionChunk from './emission/emission.glsl?raw';
import extendedEmitterChunk from './emission/extended-emitter.glsl?raw';
import summationChunk from './summation/summation.glsl?raw';
import { SummationPass } from './summation/summation-pass';
import { angularToPx } from '../camera/controls/star-geometry';
import { DEFAULT_FOV } from '../filters/filter-state';
import { DR_MAG, HIGHLIGHT_DESAT, tonemapWhitePoint } from './tonemap/tonemap-pure';
import { pixelSolidAngleArcsec2 } from './emission/emission-pure';
import {
  BASE_EPOCH_EXPOSURE,
  DEFAULT_SUMMATION_ARCSEC2,
} from './exposure/exposure-epoch';
import {
  clearChromeBindings,
  setChromeOperatorActive,
  setChromeWhitePoint,
} from './chrome/chrome-colour';
import {
  bindAttachmentGate,
  gateDrawSlots,
  type GatedAttachments,
  type GateState,
} from './attachments/attachment-gate';
import type { HdrSeam } from './hdr-seam';

(THREE.ShaderChunk as Record<string, string>)['stellata_tonemap'] = tonemapChunk;
(THREE.ShaderChunk as Record<string, string>)['stellata_hdr_emission'] = emissionChunk;
(THREE.ShaderChunk as Record<string, string>)['stellata_extended_emitter'] =
  extendedEmitterChunk;
(THREE.ShaderChunk as Record<string, string>)['stellata_summation'] = summationChunk;

/** Whether the target is even allocatable. The seam has no switch of its own
 *  any more (README.md § Fallback), so the only reason to render without it is
 *  a context that cannot: no `EXT_color_buffer_float` and no
 *  `EXT_color_buffer_half_float`, which the constructor checks.
 *
 *  A build with `supported` false is NOT a calibrated build. Every point
 *  source lands on its own peak, but a diffuse one loses attachment 2 and the
 *  convolution with it, so the band and the Local Group read several
 *  magnitudes faint. That is why this is a hardware verdict rather than a
 *  setting anybody can reach. */

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
  uOmegaSummationArcsec2: THREE.IUniform<number>;
}

export const HDR_EMITTER_UNIFORM_KEYS = [
  'uHdrTarget',
  'uWhitePoint',
  'uHighlightDesat',
  'uExposure',
  'uOmegaPxArcsec2',
  'uOmegaSummationArcsec2',
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
 *  (`exposure/README.md`), and `uOmegaSummationArcsec2` the same way.
 *  `uOmegaPxArcsec2` seeds at the default FOV
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
    uOmegaSummationArcsec2: { value: DEFAULT_SUMMATION_ARCSEC2 },
  };
}

export const HDR_ATTACHMENT_COUNT = 3;

/** Per-attachment format and filter state both backends' targets carry —
 *  the constructor options differ per renderer, the attachment contract
 *  does not (README.md § Three attachments). */
export function applyHdrAttachmentState(textures: readonly THREE.Texture[]): void {
  textures[0].colorSpace = THREE.LinearSRGBColorSpace;
  if (textures.length > 1) {
    // Half attachment 0's memory, and the reduction reads its missing
    // alpha as 1 — which is exactly the level-0 weight
    // (exposure/reduction/README.md § The chain).
    textures[1].format = THREE.RGFormat;
    textures[1].colorSpace = THREE.LinearSRGBColorSpace;
  }
  if (textures.length > 2) {
    // Linear to match the downsample target, though inert at factor 1: the
    // resolve reads this attachment directly there, at integer offsets from
    // gl_FragCoord, so every tap lands on a texel centre where bilinear and
    // nearest agree. It stops being inert the moment a tap is off-centre.
    textures[2].minFilter = THREE.LinearFilter;
    textures[2].magFilter = THREE.LinearFilter;
    textures[2].colorSpace = THREE.LinearSRGBColorSpace;
  }
}

/** The seam's render target: three half-float attachments over one 24-bit
 *  depth buffer, each carrying the format and filters its own consumer needs
 *  (README.md § Three attachments). */
export function createHdrTarget(
  width: number,
  height: number,
  count: number = HDR_ATTACHMENT_COUNT,
): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(width, height, {
    count,
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    depthBuffer: true,
    stencilBuffer: false,
    generateMipmaps: false,
  });
  applyHdrAttachmentState(rt.textures);
  return rt;
}

export class HdrPipeline implements HdrSeam {
  /** False when no float-renderable colour buffer exists. The instance
   *  is inert and every layer renders straight to the canvas —
   *  README.md § Fallback. */
  readonly supported: boolean;

  /** Bound by reference into every physical emitter's uniform map. */
  readonly emitterUniforms: HdrEmitterUniforms = makeHdrEmitterUniforms();

  private readonly rendererGL: THREE.WebGLRenderer;
  private readonly gl: WebGL2RenderingContext;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera();
  private readonly size = new THREE.Vector2();
  private rt: THREE.WebGLRenderTarget | null = null;
  private material: THREE.RawShaderMaterial | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private summation: SummationPass | null = null;
  private tonemapOn = true;
  private chart = false;
  private drMag = DR_MAG;
  private highlightDesat = HIGHLIGHT_DESAT;
  private statisticWrites = true;
  private statisticParked = false;
  private summationOn = true;
  private summationTapsOn = true;
  private extraAttachments = true;

  /** A WebGPU boot constructs `webgpu/hdr/hdr-pipeline-webgpu.ts` behind
   *  the import boundary instead — the shell holds either through the
   *  `HdrSeam` interface (./hdr-seam.ts). */
  constructor(renderer: THREE.WebGLRenderer) {
    this.rendererGL = renderer;
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

  /** The target is a full drawing-buffer RGBA16F, its RG16F statistic
   *  attachment, a second RGBA16F for the diffuse emitters
   *  (`summation/README.md`) and a 24-bit depth attachment — a few hundred MB
   *  of VRAM at 2x DPR on a large display. Allocate it on first use so a
   *  context that cannot render into it never pays for one. */
  private ensureResources(): boolean {
    if (this.rt !== null) return true;
    if (!this.supported) return false;

    this.rendererGL.getDrawingBufferSize(this.size);
    this.rt = createHdrTarget(
      this.size.x,
      this.size.y,
      this.extraAttachments ? HDR_ATTACHMENT_COUNT : 1,
    );

    this.summation = new SummationPass(this.rendererGL);
    this.geometry = fullscreenTriangleGeometry();
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        uHdrTexture: { value: this.rt.textures[0] },
        ...this.summation.uniforms,
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
   *  The explicit clear is the one place attachments 1 and 2 are written
   *  with every gate open: the renderer's own auto-clear runs after this,
   *  with them shut, so without it both would accumulate across frames
   *  forever. It costs a redundant clear of attachment 0. */
  bind(): void {
    const target = this.wantsTarget() && this.ensureResources() ? this.rt : null;
    this.rendererGL.setRenderTarget(target);
    if (target === null) return;
    this.openEveryAttachment();
    this.rendererGL.clear();
    this.closeEmitterGate();
  }

  /** Tone-map the target onto the canvas. Must pair with every `bind()`.
   *
   *  The summation convolution's downsample runs first, off the same
   *  attachment the resolve then averages — it belongs here rather than in
   *  `animate()` because it reads a target only this class knows the layout
   *  of, and because pairing it with the resolve is what stops the two
   *  disagreeing about the factor. */
  resolve(): void {
    const renderer = this.rendererGL;
    if (!this.wantsTarget() || this.rt === null || this.summation === null) return;
    if (this.summationOn && this.extraAttachments) {
      this.summation.render(
        this.rt.textures[2],
        this.emitterUniforms.uOmegaSummationArcsec2.value,
        this.emitterUniforms.uOmegaPxArcsec2.value,
      );
      // Taps lever: the downsample above ran (and chose the factor), so
      // forcing the radius to zero afterwards drops only the resolve's
      // off-centre taps — the finer half of the summation row's split.
      if (!this.summationTapsOn) {
        this.summation.uniforms.uSummationRadiusTexels.value = 0;
      }
    } else {
      // Zero radius is a single centre tap of the raw attachment (the kernel's
      // own weight rule), so the band keeps its unconvolved level while the
      // downsample and every off-centre tap drop out of the frame.
      const u = this.summation.uniforms;
      u.uDiffuseTexture.value = this.extraAttachments ? this.rt.textures[2] : null;
      u.uSummationRadiusTexels.value = 0;
      u.uSummationTexelScale.value = 1;
      renderer.getDrawingBufferSize(this.size);
      u.uSummationExtent.value.set(this.size.x, this.size.y);
    }
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);
  }

  /** The statistic attachment — flux-correct luminance in R, the
   *  lit-surface coverage fraction in G, written only by the emitters
   *  `markStatisticEmitter` admitted, and reduced by
   *  `exposure/reduction/README.md`.
   *
   *  Null whenever it does not carry this frame's light: before the target
   *  exists, under the fallback path, and in chart mode, where nothing
   *  renders into the target at all. */
  statisticTexture(): THREE.Texture | null {
    if (this.rt === null || !this.wantsTarget() || !this.extraAttachments) return null;
    return this.rt.textures[1];
  }

  /** Attachments 1 and 2 are NONE at rest, so a draw that never asks for
   *  either can neither reach the statistic nor leave the diffuse attachment
   *  undefined. Three sets its own `drawBuffers` when it first binds an MRT
   *  target; every write here lands after that and the resting state is
   *  restored on the way out, so a mid-frame re-bind cannot leave a gate
   *  open.
   *
   *  A volumetric emitter masks attachment **0** off instead: on-target it
   *  writes zero there and the resolve owns that pixel, so masking makes the
   *  contract explicit rather than relying on an additive blend of zero. An
   *  absorber takes both colour attachments and neither emits nor measures,
   *  and an emitter drawn in front of the diffuse field takes all three:
   *  `attachments/README.md` § The gate is the table. */
  private applyGateState(state: GateState): void {
    const gl = this.gl;
    const slots = gateDrawSlots(state, {
      statisticWrites: this.statisticWrites && !this.statisticParked,
      extraAttachments: this.extraAttachments,
    });
    gl.drawBuffers([
      slots[0] ? gl.COLOR_ATTACHMENT0 : gl.NONE,
      slots[1] ? gl.COLOR_ATTACHMENT1 : gl.NONE,
      slots[2] ? gl.COLOR_ATTACHMENT2 : gl.NONE,
    ]);
  }

  private openEmitterGate = (attachments: GatedAttachments): void => {
    this.applyGateState(attachments);
  };

  private closeEmitterGate = (): void => {
    this.applyGateState('rest');
  };

  /** The clear's own state, and the only one that writes all three: masking
   *  any of them here would leave last frame's contents to accumulate into.
   *  (`gateDrawSlots` keeps a masked statistic slot open here for the same
   *  reason — the attachment must read zero, not stale.) */
  private openEveryAttachment = (): void => {
    this.applyGateState('clear');
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
    this.rendererGL.getDrawingBufferSize(this.size);
    this.rt.setSize(this.size.x, this.size.y);
    this.summation?.syncSize();
  }

  /** Chart mode is a full bypass — direct to canvas, no tone-map, so
   *  chart output stays pixel-identical across the HDR epic. */
  setChartMode(on: boolean): void {
    this.chart = on;
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

  /** Frame-cost lever (`../debug/frame-cost/README.md`): mask the statistic
   *  attachment out of every emitter draw while the clear keeps writing it,
   *  so attachment 1 reads zero rather than stale and the reduction keeps
   *  running — over an empty attachment, which is the compression probe.
   *  Live, with the cut not held, it fades the adaptation to zero. */
  setStatisticWritesEnabled(on: boolean): void {
    this.statisticWrites = on;
  }

  /** The adaptation park's half of the same mask, held separately so the
   *  park and the frame-cost lever cannot clobber each other's restore
   *  (`exposure/park/README.md`). The shell rewrites
   *  it every rendered frame, before `bind()`. */
  setStatisticWritesParked(on: boolean): void {
    this.statisticParked = on;
  }

  /** Frame-cost lever: skip the rod-summation downsample and collapse the
   *  resolve's kernel to one centre tap. The band keeps its level (a uniform
   *  field is the identity case); resolved diffuse objects sharpen. */
  setSummationEnabled(on: boolean): void {
    this.summationOn = on;
  }

  /** Frame-cost lever — the finer split of the summation row: keep the
   *  downsample running but collapse the resolve's kernel to one centre tap
   *  of its output. Differencing this row against `summation` is what
   *  separates the tap cost from the downsample's. */
  setSummationTapsEnabled(on: boolean): void {
    this.summationTapsOn = on;
  }

  /** Frame-cost lever — the MRT-vs-single-target cut: rebuild the target with
   *  attachment 0 alone. The statistic parks (hold `fenceWhileParked` across
   *  it, as the chart park does) and every diffuse write discards, so the band
   *  and the Local Group vanish for the span. Reallocates the target both
   *  ways. */
  setExtraAttachmentsEnabled(on: boolean): void {
    if (on === this.extraAttachments) return;
    this.extraAttachments = on;
    this.releaseTarget();
    this.syncMode();
  }

  /** Whether the scene should render into the target this frame. Does not
   *  imply the target exists yet — `bind()` allocates on demand. */
  private wantsTarget(): boolean {
    return this.supported && !this.chart;
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
    bindAttachmentGate(
      gateLive ? this.openEmitterGate : null,
      gateLive ? this.closeEmitterGate : null,
    );
  }

  private releaseTarget(): void {
    this.scene.clear();
    this.rt?.dispose();
    this.material?.dispose();
    this.geometry?.dispose();
    this.summation?.dispose();
    this.rt = null;
    this.material = null;
    this.geometry = null;
    this.summation = null;
  }

  dispose(): void {
    this.releaseTarget();
    this.tonemapOn = true;
    this.chart = false;
    this.drMag = DR_MAG;
    this.highlightDesat = HIGHLIGHT_DESAT;
    this.statisticWrites = true;
    this.statisticParked = false;
    this.summationOn = true;
    this.summationTapsOn = true;
    this.extraAttachments = true;
    this.syncMode();
    clearChromeBindings();
  }
}
