import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FilterController, type FilterUniforms } from './filter-controller';
import {
  DEFAULT_FILTER,
  MAG_PRESETS,
  presetPxSizes,
  resetStarExaggerationK,
  STAR_RENDER_DEFAULTS,
} from './filter-state';

function makeUniforms(): FilterUniforms {
  return {
    uMaxAppMag: { value: DEFAULT_FILTER.maxAppMag },
    uMinDistSol: { value: DEFAULT_FILTER.minDistSol },
    uMaxDistSol: { value: DEFAULT_FILTER.maxDistSol },
    uSpectMask: { value: DEFAULT_FILTER.spectMask },
    uSizeMin: { value: DEFAULT_FILTER.sizeMin },
    uSizeMax: { value: DEFAULT_FILTER.sizeMax },
    uSizeSpan: { value: DEFAULT_FILTER.sizeSpan },
    uFovYRad: { value: (50 * Math.PI) / 180 },
    uVisibleThreshold: { value: STAR_RENDER_DEFAULTS.visibleThreshold },
    uVisibleK: { value: -Math.log(STAR_RENDER_DEFAULTS.visibleThreshold) },
    uCoreThreshold: { value: STAR_RENDER_DEFAULTS.coreThreshold },
    uDiscardThreshold: { value: STAR_RENDER_DEFAULTS.discardThreshold },
    uDistNMin: { value: STAR_RENDER_DEFAULTS.distNMin },
    uDistNMax: { value: STAR_RENDER_DEFAULTS.distNMax },
    uLumBiasMin: { value: STAR_RENDER_DEFAULTS.lumBiasMin },
    uLumBiasMax: { value: STAR_RENDER_DEFAULTS.lumBiasMax },
    uSizeKnee: { value: STAR_RENDER_DEFAULTS.sizeKnee },
  };
}

function makeHarness() {
  const uniforms = makeUniforms();
  const camera = {
    fov: 50,
    updateProjectionMatrix: vi.fn(),
  } as unknown as import('three').PerspectiveCamera;
  const emitted: Array<{ name: string }> = [];
  const bus = {
    emit: (name: string) => { emitted.push({ name }); },
  } as never;
  const onFilterApplied = vi.fn();
  const refreshOrbitFloor = vi.fn();
  const ctrl = new FilterController({
    camera,
    uniforms,
    bus,
    onFilterApplied,
    refreshOrbitFloor,
  });
  return { ctrl, uniforms, camera, emitted, onFilterApplied, refreshOrbitFloor };
}

beforeEach(() => {
  vi.stubGlobal('window', { innerWidth: 1920, innerHeight: 1080 });
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetStarExaggerationK();
});

describe('FilterController', () => {
  it('setFilter writes the shader uniforms and fires filter + state + the layer hook', () => {
    const { ctrl, uniforms, emitted, onFilterApplied } = makeHarness();
    ctrl.setFilter({ maxAppMag: 12, spectMask: 0b101, sizeMin: 2.5 });
    expect(uniforms.uMaxAppMag.value).toBe(12);
    expect(uniforms.uSpectMask.value).toBe(0b101);
    expect(uniforms.uSizeMin.value).toBe(2.5);
    expect(onFilterApplied).toHaveBeenCalledWith(ctrl.getFilter());
    expect(emitted.map((e) => e.name)).toEqual(['filter', 'state']);
  });

  it('applyMagnitudePreset sets preset fields but respects override flags', () => {
    const { ctrl } = makeHarness();
    ctrl.setFilter({ sizeSpanOverridden: true, sizeSpan: 3 });
    ctrl.applyMagnitudePreset('all');
    const f = ctrl.getFilter();
    expect(f.activePreset).toBe('all');
    expect(f.maxAppMag).toBe(MAG_PRESETS.all.maxAppMag);
    expect(f.sizeSpan).toBe(3);
    const sizes = presetPxSizes('all', 50, 1920);
    expect(f.sizeMin).toBe(sizes.sizeMinPx);
    expect(f.sizeMax).toBe(sizes.sizeMaxPx);
  });

  it('recomputePresetPxSizes clamps sizeMax up to a user-overridden sizeMin', () => {
    const { ctrl } = makeHarness();
    ctrl.setStarExaggerationK(0.01);
    ctrl.setFilter({ sizeMinOverridden: true, sizeMin: 50 });
    ctrl.recomputePresetPxSizes();
    const f = ctrl.getFilter();
    expect(f.sizeMax).toBe(50);
  });

  it('setCameraFov updates the projection, uFovYRad, orbit floor, and preset sizes', () => {
    const { ctrl, uniforms, camera, refreshOrbitFloor } = makeHarness();
    ctrl.setCameraFov(80);
    expect(camera.fov).toBe(80);
    expect(camera.updateProjectionMatrix).toHaveBeenCalled();
    expect(uniforms.uFovYRad.value).toBeCloseTo((80 * Math.PI) / 180, 12);
    expect(refreshOrbitFloor).toHaveBeenCalledOnce();
    expect(ctrl.getFilter().sizeMin).toBe(presetPxSizes('naked-eye', 80, 1920).sizeMinPx);
  });

  it('setCameraFov is a no-op at the current FOV', () => {
    const { ctrl, camera, refreshOrbitFloor, emitted } = makeHarness();
    ctrl.setCameraFov(50);
    expect(camera.updateProjectionMatrix).not.toHaveBeenCalled();
    expect(refreshOrbitFloor).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
  });

  it('setStarExaggerationK re-derives MAG_PRESETS and always emits', () => {
    const { ctrl, emitted } = makeHarness();
    const before = MAG_PRESETS['naked-eye'].sizeMinArcsec;
    ctrl.setFilter({ sizeMinOverridden: true, sizeMaxOverridden: true });
    emitted.length = 0;
    ctrl.setStarExaggerationK(24, 'naked-eye');
    expect(ctrl.getStarExaggerationK('naked-eye')).toBe(24);
    expect(MAG_PRESETS['naked-eye'].sizeMinArcsec).toBe(before * 2);
    expect(emitted.map((e) => e.name)).toEqual(['filter', 'state']);
  });

  it('setStarRenderParams keeps uVisibleK in lockstep with uVisibleThreshold', () => {
    const { ctrl, uniforms } = makeHarness();
    ctrl.setStarRenderParams({ visibleThreshold: 0.5, sizeKnee: 4 });
    expect(uniforms.uVisibleThreshold.value).toBe(0.5);
    expect(uniforms.uVisibleK.value).toBeCloseTo(-Math.log(0.5), 12);
    expect(uniforms.uSizeKnee.value).toBe(4);
    expect(ctrl.getStarRenderParams().visibleThreshold).toBe(0.5);
  });

  it('clearSizeOverrides drops the flags and restores preset values', () => {
    const { ctrl } = makeHarness();
    ctrl.setFilter({
      sizeMinOverridden: true, sizeMin: 42,
      sizeSpanOverridden: true, sizeSpan: 3,
    });
    ctrl.clearSizeOverrides(['sizeMin', 'sizeSpan']);
    const f = ctrl.getFilter();
    expect(f.sizeMinOverridden).toBe(false);
    expect(f.sizeSpanOverridden).toBe(false);
    expect(f.sizeMin).toBe(presetPxSizes('naked-eye', 50, 1920).sizeMinPx);
    expect(f.sizeSpan).toBe(MAG_PRESETS['naked-eye'].sizeSpan);
  });
});

describe('presetPxSizes', () => {
  it('floors both sizes at 1 px and keeps max >= min', () => {
    resetStarExaggerationK();
    const tiny = presetPxSizes('all', 120, 400);
    expect(tiny.sizeMinPx).toBeGreaterThanOrEqual(1);
    expect(tiny.sizeMaxPx).toBeGreaterThanOrEqual(tiny.sizeMinPx);
  });
});
