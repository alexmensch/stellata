// StarPipeline — the star renderer's CPU half. See README.md#the-pipeline.

import type * as THREE from 'three';
import type { BinariesAttachment } from '../binaries/binaries-attachment';
import { DIM_FLOOR } from '../binaries/eclipse/eclipse-photometry-pure';
import type { ResolvedCandidate } from '../camera/controls/star-geometry';
import * as starPhysics from '../camera/controls/star-physics';
import { resolveStarPickVisibility } from '../camera/controls/star-pick-visibility-pure';
import { chartDiscPxForAppMag, type ChartDiscParams } from '../chart-mode/chart-disc-pure';
import type { SurvivorCountsRead } from '../debug/survivor-counts';
import { mark as perfMark, measure as perfMeasure } from '../debug/perf-hud';
import type { FilterState } from '../filters/filter-state';
import type { SharedUniforms } from '../frame/shared-uniforms';
import type { ExposureController } from '../hdr/exposure/exposure-controller';
import type { HdrEmitterUniforms } from '../hdr/hdr-emitter-uniforms';
import type { Catalog } from '../loaders/catalog-loader';
import type { OccluderSet } from '../occlusion/occluder-set';
import type { ClockCadence } from '../render-gate/cadence/clock-cadence';
import { pulsationCadenceBudgetS } from '../render-gate/cadence/clock-cadence-pure';
import type { SceneLayer } from '../scene/scene-layer';
import { uploadFull } from '../util/attribute-upload';
import type { WebGpuSeam, WebGpuStarLayer } from '../webgpu/seam';
import type { ExtinctionAttachment } from './extinction/extinction-attachment';
import { StarLocalCluster } from './local-pass/star-local-cluster';
import { PHYS_RATIO_THRESHOLD, RESOLVED_DISC_MIN_PX } from './local-pass/star-local-cluster-pure';
import { writePulsationSuppressMask } from './pulsation/pulsation-suppress-pure';
import { CATALOG_BOUNDING_RADIUS_PC } from './shards/star-shards-pure';
import type { StarFrame } from './star-frame/star-frame';
import { type StarPassRouting, starPassRouting } from './star-pass';
import { buildStarSourceAttributes, type StarSourceAttributes } from './star-source-attributes';

export interface StarPipelineDeps {
  catalog: Catalog;
  frame: StarFrame;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  webgpu: Pick<WebGpuSeam, 'attachStarLayer'>;
  uniforms: SharedUniforms;
  emitterUniforms: Pick<HdrEmitterUniforms, 'uExposure' | 'uWhitePoint'>;
  binaries: Pick<BinariesAttachment,
    'sourceArrays' | 'markBaselinesDirty' | 'eclipseDimAt' | 'orbitPaths' | 'rate' | 'data'>;
  extinction: Pick<ExtinctionAttachment, 'avMagAt' | 'refreshPositions' | 'countInFrame'>;
  exposure: Pick<ExposureController, 'getLimitMag' | 'getThresholdMag'>;
  cadence: Pick<ClockCadence, 'tightenPulsationBound'>;
  occluders: OccluderSet;
  filter: () => Readonly<FilterState>;
  focusedStar: () => number | null;
  monochrome: () => boolean;
  invalidate: (reason: string) => void;
}

const sizeScratch = (): starPhysics.RenderedSizeComponents =>
  ({ appMag: 0, appSizePx: 0, physSizePx: 0, physSizePxUncapped: 0 });

export class StarPipeline {
  readonly localCluster: StarLocalCluster;
  readonly localClusterEntry: SceneLayer;
  /** Registered after `localClusterEntry`: a member's stamp must render even
   *  when the physSize-only window misses an appSize-driven member disc, so
   *  membership has to be this frame's. */
  readonly coreMaskEntry: SceneLayer;

  readonly attributes: StarSourceAttributes;
  private readonly layer: WebGpuStarLayer;
  private readonly suppressPulsationMask: Float32Array;
  private absorbedSuppressCount = 0;
  private coreMaskEnabled = true;
  private readonly sizeInputs: starPhysics.StarSizeInputs;
  private readonly pickScratch = sizeScratch();
  // Apart from pickScratch: the debug panel reads every frame and must not
  // clobber a pick walk mid-flight.
  private readonly passDebugScratch = sizeScratch();
  // Refilled per call: chart labels solve a disc per label per tick.
  private readonly chartParams: ChartDiscParams = { maxPx: 0, minPx: 0, magBright: 0 };
  private readonly unsubscribe: (() => void)[];

  constructor(private readonly deps: StarPipelineDeps) {
    const { catalog, frame, uniforms } = deps;
    this.suppressPulsationMask = new Float32Array(catalog.count);
    this.attributes = buildStarSourceAttributes({
      localPositions: frame.localPositions,
      ...deps.binaries.sourceArrays(),
      suppressPulsation: this.suppressPulsationMask,
    });
    this.layer = deps.webgpu.attachStarLayer(deps.scene, {
      catalog,
      logRadii: frame.logRadii,
      lumClassF32: frame.lumClassF32,
      distSol: frame.distSol,
      teffApsis: frame.teffApsis,
      boundingSphereRadiusPc: CATALOG_BOUNDING_RADIUS_PC,
      ...this.attributes,
    });
    this.sizeInputs = {
      catalog,
      camPos: deps.camera.position,
      localPositions: frame.localPositions,
      uniforms,
      get filter() { return deps.filter(); },
      suppressPulsation: this.suppressPulsationMask,
    };

    this.localCluster = new StarLocalCluster(
      this.layer.localMirror,
      deps.binaries.orbitPaths,
      uniforms.uLocalMemberIdx as { value: Int32Array },
      {
        catalog,
        binaries: deps.binaries.data,
        localPositions: () => frame.localPositions,
        renderedSizeComponents: (idx, out) => starPhysics.renderedSizeComponents(this.sizeInputs, idx, out),
        forEachStarNearCamera: (d, cb) => frame.forEachStarNearCamera(d, cb),
        // Membership needs physSize ≥ PHYS_RATIO_THRESHOLD × pxSize with
        // pxSize ≥ RESOLVED_DISC_MIN_PX, so the widest useful window is
        // where the largest star's disc crosses the product.
        scanWindowPc: () => frame.discWindowPcFor(RESOLVED_DISC_MIN_PX * PHYS_RATIO_THRESHOLD),
        occluders: deps.occluders,
        livePulsationRadiusFactor: (idx) => starPhysics.livePulsationRadiusFactor(
          catalog, idx, this.suppressPulsationMask, uniforms),
        hiddenStarIdx: () => uniforms.uHideFocusIdx.value,
      },
    );
    this.localClusterEntry = {
      timeBehaviour: { kind: 'clock', rate: deps.binaries.rate },
      contribution: { kind: 'always' },
      update: (ctx) => this.localCluster.update(ctx.camera, {
        monochrome: deps.monochrome(),
        focalIdx: deps.focusedStar(),
        thresholdMag: deps.exposure.getThresholdMag(),
      }),
      dispose: () => this.localCluster.dispose(),
    };
    this.coreMaskEntry = {
      timeBehaviour: { kind: 'clock', rate: deps.binaries.rate },
      contribution: {
        kind: 'gated',
        skip: () => {
          // The `coreMask` lever's A/B prices this walk, and the walk is
          // inside the predicate — so a disabled lever has to refuse above
          // it or both sides of the A/B pay it and the row prices nothing
          // (../debug/frame-cost/passes/README.md).
          if (!this.coreMaskEnabled) return null;
          perfMark('coreMask');
          const on = this.localCluster.hasMembers() || frame.shouldEnableCoreMask();
          perfMeasure('coreMask');
          return on ? null : 'legibility';
        },
        setContributing: (on) => { if (!on) this.layer.setCoreMaskVisible(false); },
      },
      update: () => this.layer.setCoreMaskVisible(this.coreMaskEnabled),
      dispose: () => {},
    };

    this.unsubscribe = [
      // Chunk 0 is already decoded and the layer was built against it, so the
      // first call below folds it in; every later one follows a landing chunk.
      catalog.onRecordsDecoded(() => this.absorbRecords()),
    ];
    this.absorbRecords();
  }

  localPositionsWritten(): void {
    uploadFull(this.attributes.iPositionAttr);
    this.deps.binaries.markBaselinesDirty();
  }

  /** The Picker's mirror of the shader's `iSuppressPulsation` gate. */
  get suppressPulsation(): Float32Array { return this.suppressPulsationMask; }

  /** The frame's compaction dispatch — after `syncUniformNodes`, before the
   *  render (`../webgpu/star/compaction/README.md`). */
  update(camera: THREE.Camera): void {
    this.layer.update(camera);
  }

  setMonochrome(on: boolean): void {
    this.layer.setMonochrome(on);
  }

  /** Debug kill switch for the core depth-mask draw AND the per-frame
   *  near-camera scan that gates it (frame-cost differentials). Backgrounds
   *  bleed through close star cores while false — never leave it off outside
   *  a measurement dwell. */
  setCoreMaskEnabled(on: boolean): void {
    this.coreMaskEnabled = on;
  }

  /** Rendered disc diameter (CSS px) — the CPU mirror of the shader's
   *  `max(appSize, physSize)` sizing. */
  renderedSizePx(idx: number): number {
    return starPhysics.renderedSizePx(this.sizeInputs, idx);
  }

  /** Opaque-disc diameter at the pulsation peak (`renderedDiscPxAtPeak`). */
  peakDiscSizePx(idx: number): number {
    return starPhysics.renderedDiscPxAtPeak(this.sizeInputs, idx);
  }

  /** Chart mode's ink-disc diameter for `appMag` at the instrument limit. */
  chartDiscPxFor(appMag: number): number {
    const u = this.deps.uniforms;
    const p = this.chartParams;
    p.maxPx = u.uChartDiscMaxPx.value;
    p.minPx = u.uChartDiscMinPx.value;
    p.magBright = u.uChartMagBright.value;
    return chartDiscPxForAppMag(appMag, p, this.deps.exposure.getLimitMag());
  }

  /** Upper bound on the radius `resolveStarPick` will report — what
   *  `pickFromCandidatesResolved`'s eligibility pass requires of the
   *  prefilter, and the reason the two can't just call the same function:
   *  chart inks a magnitude-mapped disc rather than the realistic footprint
   *  and either curve can be the larger, so the bound has to cover both.
   *  Extinction only dims, and a dimmer star maps to a smaller disc on both
   *  curves, so the resolved radius can only shrink from here. */
  pickPrefilterSizePx(idx: number): number {
    const c = starPhysics.renderedSizeComponents(this.sizeInputs, idx, this.pickScratch);
    const px = Math.max(c.appSizePx, c.physSizePx);
    return this.deps.filter().chart ? Math.max(px, this.chartDiscPxFor(c.appMag)) : px;
  }

  /** Whether the renderer puts a pixel on screen for this star, and the disc
   *  radius it actually draws — the pick gate proper, as against
   *  `drawCutoffMag`'s intrinsic-magnitude prefilter. Runs per pick
   *  candidate, never per frame. */
  resolveStarPick(idx: number): ResolvedCandidate {
    const { deps } = this;
    // No A_V answer errs toward pickable: the fallback path still dims the
    // star, and reproducing its march on the CPU needs the voxel grid the
    // loader uploads and drops.
    const avMag = deps.extinction.avMagAt(idx);
    const c = starPhysics.renderedSizeComponents(
      this.sizeInputs, idx, this.pickScratch, avMag === null ? 0 : avMag,
    );
    const filter = deps.filter();
    return resolveStarPickVisibility({
      focalHidden: deps.uniforms.uHideFocusIdx.value === idx,
      eclipseDim: deps.binaries.eclipseDimAt(idx),
      chartDiscPx: filter.chart ? this.chartDiscPxFor(c.appMag) : null,
      limitMag: deps.exposure.getLimitMag(),
      components: c,
      appSizePxForMag: (m) =>
        starPhysics.appSizePxForMag(m, filter, deps.uniforms.uSizeKnee.value),
      exposure: deps.emitterUniforms.uExposure.value,
      thresholdMag: deps.exposure.getThresholdMag(),
      whitePoint: deps.emitterUniforms.uWhitePoint.value,
    });
  }

  /** Debug-HUD view of the disc/glow routing for one star at a given eclipse
   *  dim: the pass the shaders route it to, and the pass a dimmed quad would
   *  have picked (README.md#star-rendering-instanced-quads-three-passes). */
  passRoutingFor(idx: number, eclipseDim: number): StarPassRouting {
    const c = starPhysics.renderedSizeComponents(this.sizeInputs, idx, this.passDebugScratch);
    const appSizeAtDim = (dim: number) => (dim >= 1
      ? c.appSizePx
      : starPhysics.appSizePxForMag(
        c.appMag - 2.5 * Math.log10(Math.max(dim, DIM_FLOOR)),
        this.deps.filter(),
        this.deps.uniforms.uSizeKnee.value,
      ));
    return starPassRouting(c.appSizePx, c.physSizePx, eclipseDim, DIM_FLOOR, appSizeAtDim);
  }

  async readSurvivorCounts(): Promise<SurvivorCountsRead | null> {
    this.deps.invalidate('debug:survivors');
    const counts = await this.layer.readSurvivorCounts();
    if (counts === null) return null;
    return { ...counts, inFrame: this.deps.extinction.countInFrame() };
  }

  dispose(): void {
    for (const off of this.unsubscribe) off();
    this.layer.dispose();
  }

  // see README.md#the-pipeline for the order.
  private absorbRecords(): void {
    const { catalog, frame } = this.deps;
    const absorbedFrom = this.absorbedSuppressCount;
    writePulsationSuppressMask(
      catalog.varType, this.suppressPulsationMask, absorbedFrom, catalog.loadedCount,
    );
    this.absorbedSuppressCount = catalog.loadedCount;
    uploadFull(this.attributes.iSuppressPulsationAttr);

    frame.absorbRecords();
    this.layer.absorbRecords();
    // Not markDirty — see ../webgpu/extinction/README.md#the-cache-gate.
    this.deps.extinction.refreshPositions();

    // The fastest pulsating variable bounds how long any frame may idle
    // before some star's brightness moves a JND, so a chunk carrying a
    // faster one has to shorten the budget. A minimum over the window alone:
    // rescanning every record per chunk is main-thread time the frame is
    // waiting on, and the answer cannot rise.
    this.deps.cadence.tightenPulsationBound(pulsationCadenceBudgetS(
      catalog.periodDays,
      catalog.amplitudeMag,
      this.suppressPulsationMask,
      absorbedFrom,
      catalog.loadedCount,
    ));
    this.deps.invalidate('catalog-chunk');
  }
}
