// The HDR seam on WebGPU: ../../hdr/hdr-pipeline.ts's target, summation,
// resolve and dev-switch surface over TSL materials and a requested
// Depth32Float reversed-z depth attachment. See README.md.

import {
  DataTexture, DepthTexture, FloatType, HalfFloatType, NearestFilter,
  NoBlending, NodeMaterial, QuadMesh, RGBAFormat, RenderTarget, Vector2,
  type Texture, type WebGPURenderer,
} from 'three/webgpu';
import { Fn, ivec2, screenCoordinate, select, texture, uniform, vec4 } from 'three/tsl';
import type * as THREE from 'three';
import {
  applyHdrAttachmentState, makeHdrEmitterUniforms,
  HDR_ATTACHMENT_COUNT, type HdrEmitterUniforms,
} from '../../hdr/hdr-pipeline';
import type { HdrSeam } from '../../hdr/hdr-seam';
import {
  clearChromeBindings, setChromeOperatorActive, setChromeWhitePoint,
} from '../../hdr/chrome/chrome-colour';
import { DR_MAG, HIGHLIGHT_DESAT, tonemapWhitePoint } from '../../hdr/tonemap/tonemap-pure';
import { pixelSolidAngleArcsec2 } from '../../hdr/emission/emission-pure';
import { tonemapTsl } from '../tonemap-tsl';
import { makeEmitterGateNodes, type EmitterGateNodes } from './emitter-gates';
import { WebGpuLuminanceReduction } from './reduction-webgpu';
import { WebGpuSummationPass } from './summation-pass-webgpu';
import { summationMeanTsl } from './summation-tsl';

/** A layer whose colour materials swap between single-output and the MRT
 *  struct — kept in lockstep with the target mode (README.md § The gate
 *  becomes the output struct). */
export interface MrtOutputLayer {
  setMrtOutputs(on: boolean): void;
}

export class WebGpuHdrPipeline implements HdrSeam {
  /** Float render targets are core WebGPU — no extension verdict exists,
   *  so the only path off the target is chart mode. */
  readonly supported = true;

  readonly emitterUniforms: HdrEmitterUniforms = makeHdrEmitterUniforms();

  /** The statistic-write mask the star materials multiply
   *  (./emitter-gates.ts); this class owns every value write. */
  readonly gates: EmitterGateNodes = makeEmitterGateNodes();

  readonly reduction: WebGpuLuminanceReduction;

  private readonly renderer: WebGPURenderer;
  private readonly size = new Vector2();
  private readonly mrtLayers = new Set<MrtOutputLayer>();
  private rt: RenderTarget | null = null;
  private summation: WebGpuSummationPass | null = null;
  private resolveQuad: QuadMesh | null = null;
  private resolveMaterial: NodeMaterial | null = null;
  private hdrTexNode: ReturnType<typeof texture> | null = null;
  private readonly whitePointNode = uniform(tonemapWhitePoint());
  private readonly desatNode = uniform(HIGHLIGHT_DESAT);
  private readonly tonemapEnabledNode = uniform(1);
  /** What the resolve convolves when the diffuse attachment is masked out
   *  or absent — one black texel, so the centre tap adds nothing. */
  private blackTexture: DataTexture | null = null;
  private tonemapOn = true;
  private chart = false;
  private drMag = DR_MAG;
  private highlightDesat = HIGHLIGHT_DESAT;
  private statisticWrites = true;
  private statisticParked = false;
  private summationOn = true;
  private summationTapsOn = true;
  private extraAttachments = true;

  constructor(renderer: WebGPURenderer) {
    this.renderer = renderer;
    this.reduction = new WebGpuLuminanceReduction(renderer);
    this.syncMode();
  }

  /** Register a layer for the single↔struct output swap; applies the
   *  current mode immediately. Returns the unregister. */
  registerMrtLayer(layer: MrtOutputLayer): () => void {
    this.mrtLayers.add(layer);
    layer.setMrtOutputs(this.mrtOutputsOn());
    return () => this.mrtLayers.delete(layer);
  }

  /** Bind the target the scene draws into. The render pass's own clear
   *  writes every attachment — WebGPU has no drawBuffers gate to hold
   *  open, so no explicit clear call is needed (README.md). */
  bind(): void {
    const target = this.wantsTarget() && this.ensureResources() ? this.rt : null;
    this.renderer.setRenderTarget(target);
  }

  /** Convolve the diffuse attachment, then tone-map the target onto the
   *  canvas. Must pair with every `bind()` — same contract as the WebGL
   *  seam's resolve. */
  resolve(): void {
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
        this.summation.nodes.uRadiusTexels.value = 0;
      }
    } else {
      // Zero radius is a single centre tap of the raw attachment (the
      // kernel's own weight rule); with the attachments lever off there is
      // no attachment 2, so the tap reads the one-texel black stand-in.
      const nodes = this.summation.nodes;
      nodes.uDiffuse.value = this.extraAttachments
        ? this.rt.textures[2]
        : this.ensureBlackTexture();
      nodes.uRadiusTexels.value = 0;
      nodes.uTexelScale.value = this.extraAttachments ? 1 : 0;
      this.renderer.getDrawingBufferSize(this.size);
      nodes.uExtent.value.set(
        this.extraAttachments ? this.size.x : 1,
        this.extraAttachments ? this.size.y : 1,
      );
    }
    this.renderer.setRenderTarget(null);
    this.resolveQuad?.render(this.renderer);
  }

  /** Null whenever the attachment does not carry this frame's light:
   *  before the target exists, in chart mode, and with the
   *  extra-attachments lever off. */
  statisticTexture(): THREE.Texture | null {
    if (this.rt === null || !this.wantsTarget() || !this.extraAttachments) return null;
    return this.rt.textures[1] as unknown as THREE.Texture;
  }

  setPixelSolidAngle(pxPerRadian: number): void {
    this.emitterUniforms.uOmegaPxArcsec2.value = pixelSolidAngleArcsec2(pxPerRadian);
  }

  syncSize(): void {
    if (this.rt === null) return;
    this.renderer.getDrawingBufferSize(this.size);
    this.rt.setSize(this.size.x, this.size.y);
    this.summation?.syncSize();
  }

  setChartMode(on: boolean): void {
    this.chart = on;
    this.syncMode();
  }

  setDynamicRangeMag(drMag: number): void {
    this.drMag = drMag;
    this.syncMode();
  }

  getDynamicRangeMag(): number { return this.drMag; }

  setHighlightDesat(desat: number): void {
    this.highlightDesat = desat;
    this.syncMode();
  }

  getHighlightDesat(): number { return this.highlightDesat; }

  setTonemapEnabled(on: boolean): void {
    this.tonemapOn = on;
    this.tonemapEnabledNode.value = on ? 1 : 0;
    this.syncMode();
  }

  setStatisticWritesEnabled(on: boolean): void {
    this.statisticWrites = on;
    this.syncStatisticGate();
  }

  /** The adaptation park's half of the mask, held separately so the park
   *  and the frame-cost lever cannot clobber each other's restore. The
   *  shell rewrites it every rendered frame, before `bind()`. */
  setStatisticWritesParked(on: boolean): void {
    this.statisticParked = on;
    this.syncStatisticGate();
  }

  setSummationEnabled(on: boolean): void {
    this.summationOn = on;
  }

  /** Frame-cost lever — the finer split of the summation row: keep the
   *  downsample running but collapse the resolve's kernel to one centre tap
   *  of its output (../../hdr/hdr-pipeline.ts). */
  setSummationTapsEnabled(on: boolean): void {
    this.summationTapsOn = on;
  }

  /** The MRT-vs-single-target frame-cost cut. Reallocates the target both
   *  ways and swaps every registered layer to the matching output count —
   *  a three-member struct over a one-attachment target fails pipeline
   *  creation (README.md). */
  setExtraAttachmentsEnabled(on: boolean): void {
    if (on === this.extraAttachments) return;
    this.extraAttachments = on;
    this.releaseTarget();
    this.syncMode();
  }

  dispose(): void {
    this.releaseTarget();
    this.reduction.dispose();
    this.blackTexture?.dispose();
    this.blackTexture = null;
    this.tonemapOn = true;
    this.chart = false;
    this.drMag = DR_MAG;
    this.highlightDesat = HIGHLIGHT_DESAT;
    this.statisticWrites = true;
    this.statisticParked = false;
    this.summationOn = true;
    this.summationTapsOn = true;
    this.extraAttachments = true;
    this.tonemapEnabledNode.value = 1;
    this.syncMode();
    clearChromeBindings();
  }

  private wantsTarget(): boolean {
    return this.supported && !this.chart;
  }

  private mrtOutputsOn(): boolean {
    return this.wantsTarget() && this.extraAttachments;
  }

  private ensureResources(): boolean {
    if (this.rt !== null) return true;
    this.renderer.getDrawingBufferSize(this.size);
    const rt = new RenderTarget(this.size.x, this.size.y, {
      count: this.extraAttachments ? HDR_ATTACHMENT_COUNT : 1,
      type: HalfFloatType,
      format: RGBAFormat,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    // The reversed-z → Depth32Float inference is CANVAS-only: for a
    // render target three auto-creates a Depth24Plus depth texture
    // regardless of reversedDepthBuffer, silently fixed-point — which
    // voids the local depth pass's K = 1 bracket
    // (../../local-depth/bracket/README.md § Precision analysis). An
    // explicit FloatType depth texture is what REQUESTS Depth32Float; no
    // runtime check can confirm it landed — README.md § The depth format
    // is requested, not asserted.
    const depthTexture = new DepthTexture(this.size.x, this.size.y);
    depthTexture.type = FloatType;
    rt.depthTexture = depthTexture;
    applyHdrAttachmentState(rt.textures as unknown as THREE.Texture[]);
    this.rt = rt;

    const diffuseSeed = this.extraAttachments
      ? this.rt.textures[2]
      : this.ensureBlackTexture();
    this.summation = new WebGpuSummationPass(this.renderer, diffuseSeed);
    this.buildResolve(this.rt.textures[0]);
    this.syncMode();
    return true;
  }

  private buildResolve(hdrAttachment: Texture): void {
    const summation = this.summation;
    if (summation === null) return;
    this.hdrTexNode = texture(hdrAttachment);
    const hdrTexNode = this.hdrTexNode;
    const material = new NodeMaterial();
    material.name = 'hdr-resolve-tsl';
    material.fragmentNode = Fn(() => {
      const hdr = hdrTexNode.load(ivec2(screenCoordinate));
      // The diffuse emitters write attachment 2 and leave attachment 0
      // alone, so this add is the only path their light reaches the canvas
      // by. Alpha 1, not attachment 0's — a diffuse fragment's alpha is the
      // clear's zero while its rgb is the whole band, and a premultiplied
      // canvas composites rgb > a as nothing.
      const linear = hdr.rgb.add(summationMeanTsl(
        summation.nodes.uDiffuse,
        screenCoordinate.mul(summation.nodes.uTexelScale),
        summation.nodes.uRadiusTexels,
        summation.nodes.uExtent,
      ));
      return select(
        this.tonemapEnabledNode.lessThan(0.5),
        vec4(linear, 1.0),
        vec4(tonemapTsl(
          linear, this.whitePointNode, this.desatNode, screenCoordinate), 1.0),
      );
    })();
    material.depthTest = false;
    material.depthWrite = false;
    material.blending = NoBlending;
    this.resolveMaterial = material;
    this.resolveQuad = new QuadMesh(material);
  }

  private ensureBlackTexture(): DataTexture {
    if (this.blackTexture !== null) return this.blackTexture;
    this.blackTexture = new DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
    this.blackTexture.needsUpdate = true;
    return this.blackTexture;
  }

  private syncStatisticGate(): void {
    this.gates.statisticWrites.value =
      this.statisticWrites && !this.statisticParked ? 1 : 0;
  }

  /** Fan the seam's state out exactly as the WebGL syncMode does — chrome
   *  mapping, emitter branch, operator knobs — plus the WebGPU-only
   *  output-struct swap. */
  private syncMode(): void {
    const targetActive = this.wantsTarget();
    const whitePoint = tonemapWhitePoint(this.drMag);
    this.emitterUniforms.uHdrTarget.value = targetActive ? 1 : 0;
    this.emitterUniforms.uWhitePoint.value = whitePoint;
    this.emitterUniforms.uHighlightDesat.value = this.highlightDesat;
    this.whitePointNode.value = whitePoint;
    this.desatNode.value = this.highlightDesat;
    setChromeWhitePoint(whitePoint);
    setChromeOperatorActive(targetActive && this.tonemapOn);
    this.syncStatisticGate();
    const mrtOn = this.mrtOutputsOn();
    for (const layer of this.mrtLayers) layer.setMrtOutputs(mrtOn);
  }

  private releaseTarget(): void {
    this.rt?.depthTexture?.dispose();
    this.rt?.dispose();
    this.rt = null;
    this.summation?.dispose();
    this.summation = null;
    this.resolveMaterial?.dispose();
    this.resolveMaterial = null;
    // QuadMesh's geometry is a module-level shared triangle — not ours.
    this.resolveQuad = null;
    this.hdrTexNode = null;
  }
}
