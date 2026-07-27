// The HDR seam: one float render target every light-emitting layer draws
// into, resolved to the canvas by one tone-map pass. See README.md.

import * as THREE from 'three';
import { fullscreenTriangleGeometry } from '../util/fullscreen-pass';
import fullscreenVert from '../util/fullscreen-pass.vert.glsl?raw';
import tonemapFrag from './tonemap.frag.glsl?raw';
import tonemapChunk from './tonemap.glsl?raw';
import { HIGHLIGHT_DESAT, tonemapWhitePoint } from './tonemap-pure';

(THREE.ShaderChunk as Record<string, string>)['stellata_tonemap'] = tonemapChunk;

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
  private forceDisabled = false;
  private chart = false;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    const gl = renderer.getContext();
    this.supported =
      gl.getExtension('EXT_color_buffer_float') !== null ||
      gl.getExtension('EXT_color_buffer_half_float') !== null;
    if (!this.supported) return;

    renderer.getDrawingBufferSize(this.size);
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
        uTonemapEnabled: { value: 1 },
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
  }

  /** Bind the surface the scene draws into. Call immediately before the
   *  main render; the local depth pass inherits the binding, which is
   *  what puts its repaint into the same target. */
  bind(): void {
    this.renderer.setRenderTarget(this.active() ? this.rt : null);
  }

  /** Tone-map the target onto the canvas. Must pair with every `bind()`. */
  resolve(): void {
    if (!this.active()) return;
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
    this.forceDisabled = !on;
  }

  /** Park the resolve on straight pass-through, keeping the target. The
   *  A/B that isolates a plumbing regression from a calibration one. */
  setTonemapEnabled(on: boolean): void {
    if (this.material === null) return;
    this.material.uniforms.uTonemapEnabled.value = on ? 1 : 0;
  }

  private active(): boolean {
    return this.rt !== null && !this.forceDisabled && !this.chart;
  }

  dispose(): void {
    this.scene.clear();
    this.rt?.dispose();
    this.material?.dispose();
    this.geometry?.dispose();
    this.rt = null;
    this.material = null;
    this.geometry = null;
    this.forceDisabled = false;
    this.chart = false;
  }
}
