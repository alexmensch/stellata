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
import { HIGHLIGHT_DESAT, tonemapWhitePoint } from './tonemap-pure';
import { BASE_EPOCH_EXPOSURE, pixelSolidAngleArcsec2 } from './emission-pure';
import { clearChromeBindings, setChromeOperatorActive } from './chrome-colour';

(THREE.ShaderChunk as Record<string, string>)['stellata_tonemap'] = tonemapChunk;
(THREE.ShaderChunk as Record<string, string>)['stellata_hdr_emission'] = emissionChunk;

/** Ship gate for the HDR epic. The seam is inert until the emitting
 *  layers actually carry physical luminance (H3 stars, H4 Milky Way,
 *  H5 planets) — with them still on their old encodings, turning it on
 *  changes brightness for no gain. Flip to true in the bead that lands
 *  the last conversion; `hdr-pipeline.test.ts` pins the current value so
 *  the flip has to be deliberate. `stellata.setHdrEnabled(true)` turns
 *  it on at runtime for development in the meantime. */
export const HDR_DEFAULT_ENABLED = false;

/** The uniforms every physical emitter binds **by reference**, so the
 *  seam's state reaches all of them with one write. `uHdrTarget` is the
 *  branch: 0 means the fragment lands straight on the canvas and the
 *  emitter must apply `stellata_tonemap` itself (README.md § Fallback).
 *  The resolve pass shares the same white-point and desaturation objects,
 *  so the inline path and the fullscreen path can never disagree. */
export interface HdrEmitterUniforms {
  uHdrTarget: THREE.IUniform<number>;
  uWhitePoint: THREE.IUniform<number>;
  uHighlightDesat: THREE.IUniform<number>;
  uExposure: THREE.IUniform<number>;
  uOmegaPxArcsec2: THREE.IUniform<number>;
}

/** `uHdrTarget` seeds to 0 — the shipped path while the ship gate is
 *  false — and `HdrPipeline` owns every write after that. `uExposure` is
 *  pinned to the base epoch until H6 routes the slider through it.
 *  `uOmegaPxArcsec2` seeds at the default FOV over a 1000 px viewport and
 *  is rewritten by `setPixelSolidAngle` on every FOV / resize change. */
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
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera();
  private readonly size = new THREE.Vector2();
  private rt: THREE.WebGLRenderTarget | null = null;
  private material: THREE.RawShaderMaterial | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private enabled = HDR_DEFAULT_ENABLED;
  private tonemapOn = true;
  private chart = false;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    const gl = renderer.getContext();
    this.supported =
      gl.getExtension('EXT_color_buffer_float') !== null ||
      gl.getExtension('EXT_color_buffer_half_float') !== null;
    // Before any layer is constructed, so chrome registers its colours
    // and emitters seed their branch against the right mode on a context
    // that can't take the target.
    this.syncMode();
  }

  /** The target is a full drawing-buffer RGBA16F plus a 24-bit depth
   *  attachment — a couple of hundred MB of VRAM at 2x DPR on a large
   *  display. Allocate it on first use so a build shipping with
   *  HDR_DEFAULT_ENABLED false costs nothing. */
  private ensureResources(): boolean {
    if (this.rt !== null) return true;
    if (!this.supported) return false;

    this.renderer.getDrawingBufferSize(this.size);
    this.rt = new THREE.WebGLRenderTarget(this.size.x, this.size.y, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    this.rt.texture.colorSpace = THREE.LinearSRGBColorSpace;

    this.geometry = fullscreenTriangleGeometry();
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        uHdrTexture: { value: this.rt.texture },
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
    return true;
  }

  /** Bind the surface the scene draws into. Call immediately before the
   *  main render; the local depth pass inherits the binding, which is
   *  what puts its repaint into the same target. */
  bind(): void {
    const target = this.wantsTarget() && this.ensureResources() ? this.rt : null;
    this.renderer.setRenderTarget(target);
  }

  /** Tone-map the target onto the canvas. Must pair with every `bind()`. */
  resolve(): void {
    if (!this.wantsTarget() || this.rt === null) return;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
  }

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
   *  the operator it inverts is running, and the physical emitters, which
   *  tone-map inline whenever the target isn't bound. Both read the same
   *  `wantsTarget()`, so the chart bypass reaches them for free. */
  private syncMode(): void {
    const targetActive = this.wantsTarget();
    this.emitterUniforms.uHdrTarget.value = targetActive ? 1 : 0;
    setChromeOperatorActive(targetActive && this.tonemapOn);
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
    this.syncMode();
    clearChromeBindings();
  }
}
