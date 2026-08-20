// The rod-summation downsample on WebGPU: summation-pass.ts's factor
// choice and sub-rect contract over the same summation-pure math, the
// resolve's inputs handed over as TSL nodes.

import {
  HalfFloatType, LinearFilter, LinearSRGBColorSpace, NodeMaterial, NoBlending,
  QuadMesh, RGBAFormat, RenderTarget, Vector2, type Texture, type WebGPURenderer,
} from 'three/webgpu';
import { ivec2, texture, uniform } from 'three/tsl';
import {
  summationDownsample, summationRadiusPx,
} from '../../hdr/summation/summation-pure';
import { buildSummationDownsampleFragment } from './summation-tsl';

export class WebGpuSummationPass {
  /** The slots the resolve's node graph reads — the texture node's value
   *  is the raw attachment at factor 1, the box-averaged copy otherwise. */
  readonly nodes;

  private readonly renderer: WebGPURenderer;
  private readonly size = new Vector2();
  private readonly factorNode = uniform(1, 'int');
  private readonly sourceSizeNode = uniform(new Vector2(1, 1), 'ivec2');
  private readonly material: NodeMaterial;
  private readonly quad: QuadMesh;
  /** Half the drawing buffer per axis — the smallest factor that
   *  downsamples at all is 2, and every wider factor renders into a
   *  sub-rect, so a continuous zoom never reallocates. */
  private target: RenderTarget | null = null;

  constructor(renderer: WebGPURenderer, seed: Texture) {
    this.renderer = renderer;
    this.nodes = {
      uDiffuse: texture(seed),
      uRadiusTexels: uniform(0),
      uTexelScale: uniform(1),
      uExtent: uniform(new Vector2(1, 1)),
    };
    this.material = new NodeMaterial();
    this.material.name = 'summation-downsample-tsl';
    this.material.fragmentNode = buildSummationDownsampleFragment(
      this.nodes.uDiffuse, this.factorNode, ivec2(this.sourceSizeNode));
    this.material.depthTest = false;
    this.material.depthWrite = false;
    this.material.blending = NoBlending;
    this.quad = new QuadMesh(this.material);
  }

  /**
   * Point the resolve at the field it should convolve, box-averaging
   * first when the patch is wide enough in pixels to need it. Leaves its
   * own target bound when it downsamples; the resolve binds the canvas
   * as its next statement.
   */
  render(diffuse: Texture, omegaSummationArcsec2: number, omegaPxArcsec2: number): void {
    this.renderer.getDrawingBufferSize(this.size);
    // Ω_px is a CSS-pixel solid angle — brightness must not track
    // devicePixelRatio — but every texel here is a DRAWING-BUFFER pixel, so
    // the patch radius has to cross that ratio
    // (../../hdr/summation/README.md § The kernel).
    const radiusPx =
      summationRadiusPx(omegaSummationArcsec2, omegaPxArcsec2) *
      this.renderer.getPixelRatio();
    const factor = summationDownsample(radiusPx);

    this.nodes.uRadiusTexels.value = radiusPx / factor;
    this.nodes.uTexelScale.value = 1 / factor;

    if (factor === 1) {
      this.nodes.uDiffuse.value = diffuse;
      this.nodes.uExtent.value.set(this.size.x, this.size.y);
      return;
    }

    const target = this.ensureTarget();
    const width = Math.ceil(this.size.x / factor);
    const height = Math.ceil(this.size.y / factor);
    this.nodes.uDiffuse.value = diffuse;
    this.factorNode.value = factor;
    this.sourceSizeNode.value.set(this.size.x, this.size.y);

    // The sub-rect rides the TARGET's own viewport — never
    // `renderer.setViewport`, which takes CSS units and rewrites the
    // canvas viewport for the resolve and every frame after it
    // (../../hdr/summation/summation-pass.ts says why).
    target.viewport.set(0, 0, width, height);
    target.scissor.set(0, 0, width, height);
    target.scissorTest = true;
    this.renderer.setRenderTarget(target);
    this.quad.render(this.renderer);

    this.nodes.uDiffuse.value = target.texture;
    this.nodes.uExtent.value.set(width, height);
  }

  /** Re-derives from the renderer, so resize and pixel-ratio changes are
   *  one code path. */
  syncSize(): void {
    if (this.target === null) return;
    this.renderer.getDrawingBufferSize(this.size);
    this.target.setSize(
      Math.max(1, Math.ceil(this.size.x / 2)),
      Math.max(1, Math.ceil(this.size.y / 2)),
    );
  }

  private ensureTarget(): RenderTarget {
    if (this.target !== null) return this.target;
    this.renderer.getDrawingBufferSize(this.size);
    // Linear so a coarse source resolves back to display resolution
    // without blocking: each tap is then a tent-weighted read.
    this.target = new RenderTarget(
      Math.max(1, Math.ceil(this.size.x / 2)),
      Math.max(1, Math.ceil(this.size.y / 2)),
      {
        type: HalfFloatType,
        format: RGBAFormat,
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        depthBuffer: false,
        stencilBuffer: false,
        generateMipmaps: false,
      },
    );
    this.target.texture.colorSpace = LinearSRGBColorSpace;
    return this.target;
  }

  // QuadMesh's geometry is a module-level shared triangle — never
  // disposed here, or every other quad pass loses it.
  dispose(): void {
    this.target?.dispose();
    this.target = null;
    this.material.dispose();
    this.nodes.uRadiusTexels.value = 0;
    this.nodes.uTexelScale.value = 1;
    this.nodes.uExtent.value.set(1, 1);
  }
}
