// The downsample half of the rod-summation convolution: the target it
// box-averages into, the per-frame factor, and the uniforms it hands the
// resolve. See README.md.

import * as THREE from 'three';
import { fullscreenTriangleGeometry } from '../../util/fullscreen-pass';
import fullscreenVert from '../../util/fullscreen-pass.vert.glsl?raw';
import downsampleFrag from './summation-downsample.frag.glsl?raw';
import { summationDownsample, summationRadiusPx } from './summation-pure';

/** The slots the resolve reads, held **by reference** so one write per frame
 *  reaches the shader without re-binding a material. */
export interface SummationUniforms {
  /** Attachment 2 itself when no downsample runs, its box-average otherwise. */
  uDiffuseTexture: THREE.IUniform<THREE.Texture | null>;
  /** Patch radius in the bound source's texels. */
  uSummationRadiusTexels: THREE.IUniform<number>;
  /** Source texels per display pixel — the reciprocal of the factor. */
  uSummationTexelScale: THREE.IUniform<number>;
  /** Live sub-rect of the bound source, in texels. Taps clamp to it, because
   *  the target is sized for the widest factor and the rest of it is stale. */
  uSummationExtent: THREE.IUniform<THREE.Vector2>;
}

export function makeSummationUniforms(): SummationUniforms {
  return {
    uDiffuseTexture: { value: null },
    uSummationRadiusTexels: { value: 0 },
    uSummationTexelScale: { value: 1 },
    uSummationExtent: { value: new THREE.Vector2(1, 1) },
  };
}

export class SummationPass {
  readonly uniforms: SummationUniforms = makeSummationUniforms();

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera();
  private readonly size = new THREE.Vector2();
  private readonly material: THREE.RawShaderMaterial;
  private readonly geometry: THREE.BufferGeometry;
  /** Half the drawing buffer per axis: the smallest factor that downsamples
   *  at all is 2, so nothing larger is ever needed and every wider factor
   *  renders into a sub-rect of this. Sizing it here rather than per factor
   *  is what keeps a continuous zoom from reallocating a render target. */
  private target: THREE.WebGLRenderTarget | null = null;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.geometry = fullscreenTriangleGeometry();
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        uDiffuseTexture: { value: null },
        uFactor: { value: 1 },
        uSourceSize: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: fullscreenVert,
      fragmentShader: downsampleFrag,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    const mesh = new THREE.Mesh(this.geometry, this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }

  /**
   * Point the resolve at the field it should convolve, box-averaging first
   * when the patch is wide enough in pixels to need it.
   *
   * Leaves its own target bound when it downsamples; the resolve binds the
   * canvas as its next statement, so restoring the caller's target here would
   * be a write nothing reads.
   */
  render(
    diffuse: THREE.Texture,
    omegaSummationArcsec2: number,
    omegaPxArcsec2: number,
  ): void {
    this.renderer.getDrawingBufferSize(this.size);
    // Ω_px is a CSS-pixel solid angle — brightness must not track
    // devicePixelRatio — but every texel here is a DRAWING-BUFFER pixel, so
    // the patch radius has to cross that ratio (README.md § The kernel).
    const radiusPx =
      summationRadiusPx(omegaSummationArcsec2, omegaPxArcsec2) *
      this.renderer.getPixelRatio();
    const factor = summationDownsample(radiusPx);

    this.uniforms.uSummationRadiusTexels.value = radiusPx / factor;
    this.uniforms.uSummationTexelScale.value = 1 / factor;

    if (factor === 1) {
      this.uniforms.uDiffuseTexture.value = diffuse;
      this.uniforms.uSummationExtent.value.set(this.size.x, this.size.y);
      return;
    }

    const target = this.ensureTarget();
    const width = Math.ceil(this.size.x / factor);
    const height = Math.ceil(this.size.y / factor);
    this.material.uniforms.uDiffuseTexture.value = diffuse;
    this.material.uniforms.uFactor.value = factor;
    (this.material.uniforms.uSourceSize.value as THREE.Vector2).set(
      this.size.x,
      this.size.y,
    );

    // The sub-rect rides the TARGET's own viewport, which `setRenderTarget`
    // applies verbatim — never `renderer.setViewport`, which takes CSS units
    // and multiplies by `pixelRatio` on the way in while every number here is
    // a drawing-buffer pixel, and which would leave the CANVAS viewport
    // rewritten for the resolve and every frame after it. Any pass rendering
    // into part of a target belongs on this seam for the same two reasons.
    target.viewport.set(0, 0, width, height);
    target.scissor.set(0, 0, width, height);
    target.scissorTest = true;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);

    this.uniforms.uDiffuseTexture.value = target.texture;
    this.uniforms.uSummationExtent.value.set(width, height);
  }

  /** Re-derives from the renderer, so resize and pixel-ratio changes are one
   *  code path — as `HdrPipeline.syncSize` is. */
  syncSize(): void {
    if (this.target === null) return;
    this.renderer.getDrawingBufferSize(this.size);
    this.target.setSize(
      Math.max(1, Math.ceil(this.size.x / 2)),
      Math.max(1, Math.ceil(this.size.y / 2)),
    );
  }

  private ensureTarget(): THREE.WebGLRenderTarget {
    if (this.target !== null) return this.target;
    this.renderer.getDrawingBufferSize(this.size);
    // Linear so a coarse source resolves back to display resolution without
    // blocking: each tap is then a tent-weighted read rather than a nearest
    // one, which is also the better quadrature.
    this.target = new THREE.WebGLRenderTarget(
      Math.max(1, Math.ceil(this.size.x / 2)),
      Math.max(1, Math.ceil(this.size.y / 2)),
      {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: false,
        stencilBuffer: false,
        generateMipmaps: false,
      },
    );
    this.target.texture.colorSpace = THREE.LinearSRGBColorSpace;
    return this.target;
  }

  dispose(): void {
    this.scene.clear();
    this.target?.dispose();
    this.material.dispose();
    this.geometry.dispose();
    this.target = null;
    this.uniforms.uDiffuseTexture.value = null;
    this.uniforms.uSummationRadiusTexels.value = 0;
    this.uniforms.uSummationTexelScale.value = 1;
    this.uniforms.uSummationExtent.value.set(1, 1);
  }
}
