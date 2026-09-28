import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { VAR_TYPE_ECLIPSING } from '../../../scripts/catalog/record/catalog-pure';
import type { BinariesData } from '../binaries/binaries-loader';
import type { BinaryOrbitPathLayer } from '../binaries/orbit-paths/binary-orbit-path-layer';
import { chartDiscPxForAppMag } from '../chart-mode/chart-disc-pure';
import { DEFAULT_FILTER, type FilterState } from '../filters/filter-state';
import { FloatingOrigin } from '../frame/floating-origin';
import { buildSharedUniforms } from '../frame/shared-uniforms';
import { makeHdrEmitterUniforms } from '../hdr/hdr-emitter-uniforms';
import { makeEmptyCatalog } from '../loaders/catalog-mock';
import { OccluderSet } from '../occlusion/occluder-set';
import { CADENCE_REPORT_STILL } from '../render-gate/cadence/clock-cadence-pure';
import type { FrameCtx } from '../scene/scene-layer';
import { julianEpochYearToT } from '../solar-system/time/time';
import { LateCell } from '../util/late/late';
import { fakeWebGpuSeam } from '../webgpu/seam-mock';
import type { WebGpuStarLayer } from '../webgpu/seam';
import { StarFrame } from './star-frame/star-frame';
import { StarPipeline } from './star-pipeline';

const LIMIT_MAG = 6;
const FAR_PC = 1e5;

interface LayerLog {
  coreMaskVisible: boolean[];
  absorbs: number;
  disposed: boolean;
}

function fakeLayer(log: LayerLog): WebGpuStarLayer {
  return {
    setCoreMaskVisible: (on) => { log.coreMaskVisible.push(on); },
    setMonochrome: () => {},
    update: () => {},
    absorbRecords: () => { log.absorbs += 1; },
    readSurvivorCounts: async () => ({ glow: 3, disc: 1, prefilter: 5 }),
    localMirror: {
      group: new THREE.Group(),
      setMembers: () => {},
      sync: () => {},
      dispose: () => {},
    },
    dispose: () => { log.disposed = true; },
  };
}

function makeHarness(opts: { count?: number; loaded?: number; nearStar?: boolean } = {}) {
  const count = opts.count ?? 4;
  const catalog = makeEmptyCatalog(count, opts.loaded ?? count);
  for (let i = 0; i < count; i++) catalog.positions[i * 3 + 2] = -FAR_PC;
  if (opts.nearStar) catalog.positions[2] = -1e-6;
  const chunkListeners = new Set<() => void>();
  catalog.onRecordsDecoded = (fn) => {
    const l = () => fn({ first: 0, end: catalog.loadedCount });
    chunkListeners.add(l);
    return () => { chunkListeners.delete(l); };
  };

  const uniforms = buildSharedUniforms({
    pixelRatio: 1, fovYRad: Math.PI / 4, viewportW: 1000, viewportH: 1000,
    hdr: makeHdrEmitterUniforms(),
  });
  const camera = new THREE.PerspectiveCamera(45, 1, 1e-6, 1e7);
  const origin = new FloatingOrigin(uniforms.uWorldOffset);
  let pipeline: StarPipeline | null = null;
  const frame = new StarFrame({
    catalog,
    uniforms,
    worldOffset: origin.worldOffset,
    cameraPosition: camera.position,
    t: julianEpochYearToT(2016),
    onLocalPositionsWritten: () => pipeline?.localPositionsWritten(),
  });

  const layerLog: LayerLog = { coreMaskVisible: [], absorbs: 0, disposed: false };
  const filter: FilterState = { ...DEFAULT_FILTER };
  const record = {
    invalidations: [] as string[],
    bounds: [] as number[],
    refreshes: 0,
    baselinesDirty: 0,
    avMag: null as number | null,
  };
  const binariesData = new LateCell<BinariesData>();
  pipeline = new StarPipeline({
    catalog,
    frame,
    scene: new THREE.Scene(),
    camera,
    webgpu: fakeWebGpuSeam({ attachStarLayer: () => fakeLayer(layerLog) }),
    uniforms,
    emitterUniforms: makeHdrEmitterUniforms(),
    binaries: {
      sourceArrays: () => ({
        compositeSuppress: new Float32Array(count),
        eclipseDim: new Float32Array(count).fill(1),
      }),
      markBaselinesDirty: () => { record.baselinesDirty += 1; },
      eclipseDimAt: () => 1,
      orbitPaths: {
        group: new THREE.Group(),
        anyOrbitRingVisible: () => false,
        collectSpheres: () => {},
      } as unknown as BinaryOrbitPathLayer,
      rate: () => CADENCE_REPORT_STILL,
      data: binariesData,
    },
    extinction: {
      avMagAt: () => record.avMag,
      refreshPositions: () => { record.refreshes += 1; },
      countInFrame: () => 7,
    },
    exposure: { getLimitMag: () => LIMIT_MAG, getThresholdMag: () => LIMIT_MAG },
    cadence: { tightenPulsationBound: (s) => { record.bounds.push(s); } },
    occluders: new OccluderSet(),
    filter: () => filter,
    focusedStar: () => null,
    monochrome: () => false,
    invalidate: (reason) => { record.invalidations.push(reason); },
  });
  const landChunk = (loaded: number) => {
    catalog.loadedCount = loaded;
    for (const l of [...chunkListeners]) l();
  };
  return { pipeline, catalog, frame, filter, layerLog, record, landChunk, uniforms, camera };
}

const ctx = (camera: THREE.PerspectiveCamera) => ({ camera } as unknown as FrameCtx);

describe('StarPipeline — absorbing the catalogue', () => {
  it('folds the first chunk in at construction and wakes the frame', () => {
    const { layerLog, record } = makeHarness();

    expect(layerLog.absorbs).toBe(1);
    expect(record.refreshes).toBe(1);
    expect(record.bounds).toHaveLength(1);
    expect(record.invalidations).toEqual(['catalog-chunk']);
  });

  it('extends the suppress mask in place from where the last chunk stopped', () => {
    const h = makeHarness({ count: 4, loaded: 2 });
    h.catalog.varType[0] = VAR_TYPE_ECLIPSING;
    h.catalog.varType[3] = VAR_TYPE_ECLIPSING;
    const mask = h.pipeline.suppressPulsation;

    h.landChunk(4);

    expect(h.pipeline.suppressPulsation).toBe(mask);
    // Record 0 was folded in by the first absorb, before its type changed.
    expect(Array.from(mask)).toEqual([0, 0, 0, 1]);
    expect(h.layerLog.absorbs).toBe(2);
    expect(h.record.invalidations).toEqual(['catalog-chunk', 'catalog-chunk']);
  });

  it('stops absorbing once disposed', () => {
    const h = makeHarness({ count: 4, loaded: 2 });
    h.pipeline.dispose();

    h.landChunk(4);

    expect(h.layerLog.absorbs).toBe(1);
    expect(h.layerLog.disposed).toBe(true);
  });
});

describe('StarPipeline — the core-mask entry', () => {
  it('refuses above the walk while the lever is off, so its A/B prices the walk', () => {
    const h = makeHarness({ nearStar: true });
    const walk = vi.spyOn(h.frame, 'shouldEnableCoreMask');
    h.pipeline.setCoreMaskEnabled(false);
    const gate = h.pipeline.coreMaskEntry.contribution;
    if (gate.kind !== 'gated') throw new Error('core mask must be gated');

    expect(gate.skip(ctx(h.camera))).toBeNull();
    expect(walk).not.toHaveBeenCalled();
    h.pipeline.coreMaskEntry.update?.(ctx(h.camera));
    expect(h.layerLog.coreMaskVisible).toEqual([false]);
  });

  it('walks once per verdict and skips for legibility with no star near', () => {
    const h = makeHarness();
    const walk = vi.spyOn(h.frame, 'shouldEnableCoreMask');
    const gate = h.pipeline.coreMaskEntry.contribution;
    if (gate.kind !== 'gated') throw new Error('core mask must be gated');

    expect(gate.skip(ctx(h.camera))).toBe('legibility');
    expect(walk).toHaveBeenCalledTimes(1);
  });

  it('contributes with a resolvable star near the camera', () => {
    const h = makeHarness({ nearStar: true });
    const gate = h.pipeline.coreMaskEntry.contribution;
    if (gate.kind !== 'gated') throw new Error('core mask must be gated');

    expect(gate.skip(ctx(h.camera))).toBeNull();
  });

  it('hides the mask when it stops contributing', () => {
    const h = makeHarness();
    const gate = h.pipeline.coreMaskEntry.contribution;
    if (gate.kind !== 'gated') throw new Error('core mask must be gated');

    gate.setContributing?.(false);
    gate.setContributing?.(true);

    expect(h.layerLog.coreMaskVisible).toEqual([false]);
  });
});

describe('StarPipeline — per-star answers', () => {
  it('solves the chart ink disc at the instrument limit', () => {
    const { pipeline, uniforms } = makeHarness();
    const params = {
      maxPx: uniforms.uChartDiscMaxPx.value,
      minPx: uniforms.uChartDiscMinPx.value,
      magBright: uniforms.uChartMagBright.value,
    };

    for (const mag of [-5, 0, 3, LIMIT_MAG, 9]) {
      expect(pipeline.chartDiscPxFor(mag)).toBe(chartDiscPxForAppMag(mag, params, LIMIT_MAG));
    }
  });

  it('bounds the chart pick by the ink disc as well as the realistic footprint', () => {
    const h = makeHarness({ nearStar: true });
    const realistic = h.pipeline.pickPrefilterSizePx(0);
    h.filter.chart = true;

    expect(h.pipeline.pickPrefilterSizePx(0)).toBeGreaterThanOrEqual(realistic);
    expect(h.pipeline.pickPrefilterSizePx(0))
      .toBeGreaterThanOrEqual(h.pipeline.chartDiscPxFor(h.catalog.absmag[0]));
  });

  it('reads no A_V answer as no extinction', () => {
    const h = makeHarness({ nearStar: true });
    const unanswered = h.pipeline.resolveStarPick(0);
    h.record.avMag = 0;

    expect(h.pipeline.resolveStarPick(0)).toEqual(unanswered);
  });

  it('refuses the star the focal hide collapses', () => {
    const h = makeHarness({ nearStar: true });
    h.uniforms.uHideFocusIdx.value = 0;

    expect(h.pipeline.resolveStarPick(0).visible).toBe(false);
  });
});

describe('StarPipeline — wiring legs', () => {
  it('re-derives the binary baselines on a wholesale position rewrite', () => {
    const h = makeHarness();
    const version = h.pipeline.attributes.iPositionAttr.version;

    h.frame.rewriteAt(new THREE.Vector3(1, 0, 0));

    expect(h.record.baselinesDirty).toBe(1);
    expect(h.pipeline.attributes.iPositionAttr.version).toBeGreaterThan(version);
  });

  it('wakes the gate for the survivor read and joins the in-frame count', async () => {
    const h = makeHarness();

    const counts = await h.pipeline.readSurvivorCounts();

    expect(counts).toEqual({ glow: 3, disc: 1, prefilter: 5, inFrame: 7 });
    expect(h.record.invalidations).toContain('debug:survivors');
  });
});
