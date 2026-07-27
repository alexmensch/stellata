// The HDR seam: one float render target every light-emitting layer draws
// into, resolved to the canvas by one tone-map pass. See README.md.

import * as THREE from 'three';
import { fullscreenTriangleGeometry } from '../util/fullscreen-pass';
import fullscreenVert from '../util/fullscreen-pass.vert.glsl?raw';
import tonemapFrag from './tonemap.frag.glsl?raw';
import tonemapChunk from './tonemap.glsl?raw';
import { HIGHLIGHT_DESAT, tonemapWhitePoint } from './tonemap-pure';
import { clearChromeBindings, setChromeOperatorActive } from './chrome-colour';

(THREE.ShaderChunk as Record<string, string>)['stellata_tonemap'] = tonemapChunk;

/** Ship gate for the HDR epic. The seam is inert until the emitting
 *  layers actually carry physical luminance (H3 stars, H4 Milky Way,
 *  H5 planets) — with them still on their old encodings, turning it on
 *  changes brightness for no gain. Flip to true in the bead that lands
 *  the last conversion; `hdr-pipeline.test.ts` pins the current value so
 *  the flip has to be deliberate. `stellata.setHdrEnabled(true)` turns
 *  it on at runtime for development in the meantime. */
export const HDR_DEFAULT_ENABLED = false;

export class HdrPipeline {
  /** False when no float-renderable colour buffer exists. The instance
   *  is inert and every layer renders straight to the canvas —
   *  README.md § Fallback. */
  readonly supported: boolean;

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
    // against the right mode on a context that can't take the target.
    this.syncChrome();
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
        uWhitePoint: { value: tonemapWhitePoint() },
        uHighlightDesat: { value: HIGHLIGHT_DESAT },
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
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.syncChrome();
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
    this.syncChrome();
  }

  /** Whether the scene should render into the target this frame. Does not
   *  imply the target exists yet — `bind()` allocates on demand. */
  private wantsTarget(): boolean {
    return this.supported && this.enabled && !this.chart;
  }

  /** Chrome's inverse mapping is only correct while the operator it
   *  inverts is running. */
  private syncChrome(): void {
    setChromeOperatorActive(this.supported && this.enabled && this.tonemapOn);
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
    clearChromeBindings();
  }
}
