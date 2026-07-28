import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FilterController, type FilterUniforms } from './filter-controller';
import {
  DEFAULT_FILTER,
  INSTRUMENTS,
  STAR_PHYSICS_FACTOR,
  starExaggerationK,
  resetStarKMultiplier,
  STAR_RENDER_DEFAULTS,
  starPxSizes,
  TARGET_PX,
} from './filter-state';
import {
  type SceneElementBinds,
  type SceneElementId,
  SCENE_ELEMENT_IDS,
  visibleSet,
} from '../scene/scene-elements';

function makeSceneBinds(): { binds: SceneElementBinds; permitted: Record<SceneElementId, boolean> } {
  const permitted = Object.fromEntries(
    SCENE_ELEMENT_IDS.map((id) => [id, true]),
  ) as Record<SceneElementId, boolean>;
  const binds = Object.fromEntries(
    SCENE_ELEMENT_IDS.map((id) => [id, (on: boolean) => { permitted[id] = on; }]),
  ) as SceneElementBinds;
  return { binds, permitted };
}

/** The set of ids currently permitted (bound to true) — for comparison
 *  against visibleSet(). */
function permittedSet(permitted: Record<SceneElementId, boolean>): Set<SceneElementId> {
  return new Set(SCENE_ELEMENT_IDS.filter((id) => permitted[id]));
}

function makeUniforms(): FilterUniforms {
  return {
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
  const { binds, permitted } = makeSceneBinds();
  const ctrl = new FilterController({
    camera,
    uniforms,
    bus,
    onFilterApplied,
    refreshOrbitFloor,
    sceneElementBinds: binds,
  });
  return { ctrl, uniforms, camera, emitted, onFilterApplied, refreshOrbitFloor, permitted };
}

beforeEach(() => {
  vi.stubGlobal('window', { innerWidth: 1920, innerHeight: 1080 });
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetStarKMultiplier();
});

describe('FilterController', () => {
  it('setFilter writes the shader uniforms and fires filter + state + the layer hook', () => {
    const { ctrl, uniforms, emitted, onFilterApplied } = makeHarness();
    ctrl.setFilter({ spectMask: 0b101, sizeMin: 2.5 });
    expect(uniforms.uSpectMask.value).toBe(0b101);
    expect(uniforms.uSizeMin.value).toBe(2.5);
    expect(onFilterApplied).toHaveBeenCalledWith(ctrl.getFilter());
    expect(emitted.map((e) => e.name)).toEqual(['filter', 'state']);
  });

  it('setInstrument sets its fields but respects override flags', () => {
    const { ctrl } = makeHarness();
    ctrl.setFilter({ sizeSpanOverridden: true, sizeSpan: 3 });
    ctrl.setInstrument('unaided-eye');
    const f = ctrl.getFilter();
    expect(f.instrument).toBe('unaided-eye');
    expect(f.sizeSpan).toBe(3);
    const sizes = starPxSizes('unaided-eye', 50, 1080);
    expect(f.sizeMin).toBe(sizes.sizeMinPx);
    expect(f.sizeMax).toBe(sizes.sizeMaxPx);
  });

  it('recomputeStarPxSizes clamps sizeMax up to a user-overridden sizeMin', () => {
    const { ctrl } = makeHarness();
    ctrl.setStarKMultiplier(0.01);
    ctrl.setFilter({ sizeMinOverridden: true, sizeMin: 50 });
    ctrl.recomputeStarPxSizes();
    const f = ctrl.getFilter();
    expect(f.sizeMax).toBe(50);
  });

  it('setCameraFov updates the projection, uFovYRad, orbit floor, and star sizes', () => {
    const { ctrl, uniforms, camera, refreshOrbitFloor } = makeHarness();
    ctrl.setCameraFov(80);
    expect(camera.fov).toBe(80);
    expect(camera.updateProjectionMatrix).toHaveBeenCalled();
    expect(uniforms.uFovYRad.value).toBeCloseTo((80 * Math.PI) / 180, 12);
    expect(refreshOrbitFloor).toHaveBeenCalledOnce();
    expect(ctrl.getFilter().sizeMin).toBe(starPxSizes('unaided-eye', 80, 1080).sizeMinPx);
  });

  it('setCameraFov is a no-op at the current FOV', () => {
    const { ctrl, camera, refreshOrbitFloor, emitted } = makeHarness();
    ctrl.setCameraFov(50);
    expect(camera.updateProjectionMatrix).not.toHaveBeenCalled();
    expect(refreshOrbitFloor).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
  });

  it('setStarKMultiplier scales the derived footprint and always emits', () => {
    const { ctrl, emitted } = makeHarness();
    const before = starPxSizes('unaided-eye', 50, 1080).sizeMinPx;
    ctrl.setFilter({ sizeMinOverridden: true, sizeMaxOverridden: true });
    emitted.length = 0;
    ctrl.setStarKMultiplier(2);
    expect(ctrl.getStarKMultiplier()).toBe(2);
    expect(starPxSizes('unaided-eye', 50, 1080).sizeMinPx).toBeCloseTo(before * 2, 12);
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

  it('applyDetailPreset drives the cumulative floor set for the realistic style', () => {
    const { ctrl, permitted, emitted } = makeHarness();
    ctrl.applyDetailPreset('physical');
    expect(permittedSet(permitted)).toEqual(visibleSet('physical', 'realistic'));
    expect(ctrl.getDetailLevel()).toBe('physical');
    expect(emitted.map((e) => e.name)).toEqual(['filter', 'state']);

    ctrl.applyDetailPreset('representational');
    expect(permittedSet(permitted)).toEqual(visibleSet('representational', 'realistic'));

    ctrl.applyDetailPreset('all');
    expect(permittedSet(permitted)).toEqual(visibleSet('all', 'realistic'));
  });

  it('applyDetailPreset uses the chart floors while chart is active', () => {
    const { ctrl, permitted } = makeHarness();
    ctrl.setFilter({ chart: true });
    ctrl.applyDetailPreset('physical');
    expect(permittedSet(permitted)).toEqual(visibleSet('physical', 'chart'));
  });

  it('a per-element override supersedes its floor until the next applyDetailPreset', () => {
    const { ctrl, permitted } = makeHarness();
    ctrl.applyDetailPreset('all');
    expect(permitted.constellationFigures).toBe(true);
    // Override one element off — others stay put.
    ctrl.setSceneElementVisible('constellationFigures', false);
    expect(permitted.constellationFigures).toBe(false);
    expect(permitted.planetLabels).toBe(true);
    // Re-applying the preset recomputes from floors, clearing the override.
    ctrl.applyDetailPreset('all');
    expect(permitted.constellationFigures).toBe(true);
  });

  it('applyDetailPreset clears the per-element user toggles (C / mw / lg)', () => {
    const { ctrl } = makeHarness();
    ctrl.setFilter({ showConstellation: false, showMilkyway: false, showLgEmission: false });
    ctrl.applyDetailPreset('representational');
    expect(ctrl.getFilter().showConstellation).toBe(true);
    expect(ctrl.getFilter().showMilkyway).toBe(true);
    expect(ctrl.getFilter().showLgEmission).toBe(true);
  });

  it('applyDetailPreset(level, false) preserves the toggles for a style recompute', () => {
    const { ctrl } = makeHarness();
    ctrl.setFilter({ showConstellation: false, showMilkyway: false, showLgEmission: false });
    ctrl.applyDetailPreset('representational', false);
    expect(ctrl.getFilter().showConstellation).toBe(false);
    expect(ctrl.getFilter().showMilkyway).toBe(false);
    expect(ctrl.getFilter().showLgEmission).toBe(false);
  });

  it('clearSizeOverrides drops the flags and restores the derived values', () => {
    const { ctrl } = makeHarness();
    ctrl.setFilter({
      sizeMinOverridden: true, sizeMin: 42,
      sizeSpanOverridden: true, sizeSpan: 3,
    });
    ctrl.clearSizeOverrides(['sizeMin', 'sizeSpan']);
    const f = ctrl.getFilter();
    expect(f.sizeMinOverridden).toBe(false);
    expect(f.sizeSpanOverridden).toBe(false);
    expect(f.sizeMin).toBe(starPxSizes('unaided-eye', 50, 1080).sizeMinPx);
    expect(f.sizeSpan).toBe(INSTRUMENTS['unaided-eye'].sizeSpan);
  });
});

describe('starPxSizes — plate-scale-derived K', () => {
  const EYE = INSTRUMENTS['unaided-eye'];
  // K floors at 1 where the true PSF already lands on TARGET_PX; below
  // that plate scale, real physics takes over.
  const CROSSOVER_ARCSEC_PER_PX = EYE.psfArcsec / TARGET_PX;

  it('lands a threshold star on TARGET_PX at every FOV above the crossover', () => {
    for (const fovDeg of [10, 20, 50, 80, 120]) {
      expect(starPxSizes('unaided-eye', fovDeg, 1080).sizeMinPx)
        .toBeCloseTo(TARGET_PX, 12);
    }
  });

  it('lands a threshold star on TARGET_PX at every viewport height', () => {
    // 390 = landscape mobile, the case the retired max(w, h) refDim
    // compromise existed for.
    for (const heightPx of [390, 720, 1080, 1440, 2160]) {
      expect(starPxSizes('unaided-eye', 50, heightPx).sizeMinPx)
        .toBeCloseTo(TARGET_PX, 12);
    }
  });

  it('pins the crossover: K = 1 exactly, and the disc grows below it', () => {
    const fovAtCrossover = (CROSSOVER_ARCSEC_PER_PX * 1080) / 3600;
    expect(fovAtCrossover).toBeCloseTo(2.3438, 4);
    expect(starExaggerationK('unaided-eye', CROSSOVER_ARCSEC_PER_PX)).toBe(1);
    // Narrower still: K stays floored, so the disc tracks the true PSF.
    const narrower = starExaggerationK('unaided-eye', CROSSOVER_ARCSEC_PER_PX / 4);
    expect(narrower).toBe(1);
    expect(starPxSizes('unaided-eye', fovAtCrossover / 4, 1080).sizeMinPx)
      .toBeCloseTo(TARGET_PX * 4, 10);
  });

  it('is invariant in window WIDTH — a wider window only reveals more sky', () => {
    // The reported defect: presetPxSizes divided by max(w, h), so
    // 1440 → 3440 wide grew every star. Width is no longer an input.
    const at1440 = starPxSizes('unaided-eye', 50, 1440);
    vi.stubGlobal('window', { innerWidth: 3440, innerHeight: 1440 });
    expect(starPxSizes('unaided-eye', 50, 1440)).toEqual(at1440);
  });

  it('scales the saturation disc off the threshold disc, floored at it', () => {
    const { sizeMinPx, sizeMaxPx } = starPxSizes('unaided-eye', 50, 1080);
    expect(sizeMaxPx / sizeMinPx)
      .toBeCloseTo(Math.sqrt(STAR_PHYSICS_FACTOR * EYE.sizeSpan), 12);
  });

  it('floors both sizes at 1 px and keeps max >= min', () => {
    const tiny = starPxSizes('unaided-eye', 120, 400, 0.001);
    expect(tiny.sizeMinPx).toBeGreaterThanOrEqual(1);
    expect(tiny.sizeMaxPx).toBeGreaterThanOrEqual(tiny.sizeMinPx);
  });
});
