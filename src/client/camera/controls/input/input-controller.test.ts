import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';
import { InputController, type InputControllerDeps } from './input-controller';
import { DEFAULT_FILTER, type FilterState } from '../../../filters/filter-state';
import { targetsEqual, type Target } from '../../focus/focus-target';
import type { Picker } from '../picker';
import { PoiStore } from '../../../poi/poi-store';
import type { CameraMode, StellataEventMap } from '../../../stellata';
import type { EventBus } from '../../../util/event-bus';
import { RollController } from './roll-controller';
import { PINCH_NOTCH_GAIN, WHEEL_NOTCH_DELTA_PX } from './pinch-zoom-pure';
import { GALACTIC_NORTH_POLE_ICRS } from '../../../galactic/galactic-coords';


const star = (idx: number): Target => ({ kind: 'star', idx });
const planet = (idx: number): Target => ({ kind: 'planet', idx });
const lg = (idx: number): Target => ({ kind: 'lg', idx });
const probe = (idx: number): Target => ({ kind: 'probe', idx });

interface Harness {
  input: InputController;
  deps: {
    flyTo: ReturnType<typeof vi.fn>;
    unfocus: ReturnType<typeof vi.fn>;
    togglePoi: ReturnType<typeof vi.fn>;
    setVector: ReturnType<typeof vi.fn>;
    setOrbitTarget: ReturnType<typeof vi.fn>;
    aimAt: ReturnType<typeof vi.fn>;
  };
  state: {
    cameraMode: CameraMode;
    filter: FilterState;
    focused: Target | null;
    vector: Target | null;
    pinned: Target[];
    pickStarResult: number;
    pickStarDistancePc: number;
    pickStarTier: 'prime' | 'fallback';
    pickCloudResult: number | null;
    pickPlanetResult: number | null;
    pickPlanetDistancePc: number;
    pickPlanetTier: 'prime' | 'fallback';
    pickLgResult: number | null;
    pickLgDistancePc: number;
    pickLgTier: 'prime' | 'fallback';
    pickProbeResult: number | null;
    pickProbeDistancePc: number;
    pickProbeTier: 'prime' | 'fallback';
    warpActive: boolean;
    aimActive: boolean;
    observeTransitionActive: boolean;
  };
  cancelled: string[];
  emitted: string[];
  camera: THREE.PerspectiveCamera;
  controls: TrackballControls;
  roll: RollController;
  canvas: {
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
    dispatchEvent: ReturnType<typeof vi.fn>;
    contains: ReturnType<typeof vi.fn>;
  };
}

function makeHarness(): Harness {
  const state = {
    cameraMode: 'navigate' as CameraMode,
    filter: { ...DEFAULT_FILTER, showHud: true },
    focused: null as Target | null,
    vector: null as Target | null,
    pinned: [] as Target[],
    pickStarResult: -1,
    pickStarDistancePc: 1,
    pickStarTier: 'prime' as 'prime' | 'fallback',
    pickCloudResult: null as number | null,
    pickPlanetResult: null as number | null,
    pickPlanetDistancePc: 1,
    pickPlanetTier: 'prime' as 'prime' | 'fallback',
    pickLgResult: null as number | null,
    pickLgDistancePc: 1,
    pickLgTier: 'prime' as 'prime' | 'fallback',
    pickProbeResult: null as number | null,
    pickProbeDistancePc: 1,
    pickProbeTier: 'prime' as 'prime' | 'fallback',
    warpActive: false,
    aimActive: false,
    observeTransitionActive: false,
  };
  const emitted: string[] = [];
  const cancelled: string[] = [];
  const canvasMock = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    contains: vi.fn(() => true),
  };
  const canvas = canvasMock as unknown as HTMLCanvasElement;
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  const controls = {
    target: new THREE.Vector3(0, 0, -1),
    noPan: true,
    noRotate: false,
    keys: ['', '', ''] as string[],
  } as unknown as TrackballControls;
  const roll = new RollController();
  const deps = {
    flyTo: vi.fn(),
    unfocus: vi.fn(),
    togglePoi: vi.fn(() => true),
    setVector: vi.fn(),
    setOrbitTarget: vi.fn(),
    aimAt: vi.fn(),
  };
  const input = new InputController({
    canvas,
    camera,
    controls,
    picker: {
      pickStar: () => state.pickStarResult,
      pickStarHit: () => (state.pickStarResult >= 0
        ? {
            idx: state.pickStarResult,
            cameraDistancePc: state.pickStarDistancePc,
            tier: state.pickStarTier,
          }
        : null),
      pickKindHit: (kind: string) => {
        if (kind === 'planet' && state.pickPlanetResult !== null) {
          return {
            idx: state.pickPlanetResult,
            cameraDistancePc: state.pickPlanetDistancePc,
            tier: state.pickPlanetTier,
          };
        }
        if (kind === 'probe' && state.pickProbeResult !== null) {
          return {
            idx: state.pickProbeResult,
            cameraDistancePc: state.pickProbeDistancePc,
            tier: state.pickProbeTier,
          };
        }
        if (kind === 'cloud' && state.pickCloudResult !== null) {
          return { idx: state.pickCloudResult, cameraDistancePc: 1, tier: 'fallback' };
        }
        if (kind === 'lg' && state.pickLgResult !== null) {
          return {
            idx: state.pickLgResult,
            cameraDistancePc: state.pickLgDistancePc,
            tier: state.pickLgTier,
          };
        }
        return null;
      },
    } as unknown as Picker,
    bus: {
      emit: (name: string) => { emitted.push(name); },
    } as unknown as EventBus<StellataEventMap>,
    poiStore: {
      pinnable: () => true,
      has: (t: Target) => state.pinned.some((p) => targetsEqual(p, t)),
      atCap: () => false,
    } as unknown as PoiStore,
    roll,
    getCameraMode: () => state.cameraMode,
    getFilter: () => state.filter,
    getFocusedTarget: () => state.focused,
    getVectorTarget: () => state.vector,
    setVector: deps.setVector,
    isWarpActive: () => state.warpActive,
    isAimActive: () => state.aimActive,
    isObserveTransitionActive: () => state.observeTransitionActive,
    cancelUnfocusLerp: () => { cancelled.push('unfocus'); },
    cancelFocusLerp: () => { cancelled.push('focus'); },
    flyTo: deps.flyTo,
    setOrbitTarget: deps.setOrbitTarget,
    unfocus: deps.unfocus,
    togglePoi: deps.togglePoi,
    aimAt: deps.aimAt,
  } satisfies InputControllerDeps);
  return { input, deps, state, emitted, cancelled, camera, controls, roll, canvas: canvasMock };
}

type WithPrivates = {
  dispatchSingleClick(x: number, y: number): void;
  dispatchDoubleClick(x: number, y: number): void;
  rollCamera(angle: number): void;
};

beforeEach(() => {
  const win = new EventTarget() as EventTarget & { innerWidth: number; innerHeight: number };
  win.innerWidth = 800;
  win.innerHeight = 600;
  vi.stubGlobal('window', win);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('InputController.applyObjectClick — navigate mode', () => {
  it('travels to the clicked object when nothing is focused', () => {
    const { input, deps } = makeHarness();
    expect(input.applyObjectClick(star(7))).toBe(true);
    expect(deps.flyTo).toHaveBeenCalledWith(star(7));
  });

  it('unfocuses on click-the-focused-object with no vector', () => {
    const { input, deps, state } = makeHarness();
    state.focused = star(7);
    expect(input.applyObjectClick(star(7))).toBe(true);
    expect(deps.unfocus).toHaveBeenCalled();
    expect(deps.setVector).not.toHaveBeenCalled();
  });

  it('clears the vector (stays focused) on click-the-focused-object with a vector drawn', () => {
    const { input, deps, state } = makeHarness();
    state.focused = star(7);
    state.vector = star(12);
    expect(input.applyObjectClick(star(7))).toBe(true);
    expect(deps.setVector).toHaveBeenCalledWith(null);
    expect(deps.unfocus).not.toHaveBeenCalled();
  });

  it('pins an unpinned other star (ladder rung 1)', () => {
    const { input, deps, state } = makeHarness();
    state.focused = star(7);
    expect(input.applyObjectClick(star(12))).toBe(true);
    expect(deps.togglePoi).toHaveBeenCalledWith(star(12));
  });

  it('sets the vector on a pinned other star that is not the destination', () => {
    const { input, deps, state } = makeHarness();
    state.focused = star(7);
    state.pinned.push(star(12));
    expect(input.applyObjectClick(star(12))).toBe(true);
    expect(deps.setVector).toHaveBeenCalledWith(star(12));
    expect(deps.togglePoi).not.toHaveBeenCalled();
  });

  it('clears vector AND unpins on the pinned vector destination', () => {
    const { input, deps, state } = makeHarness();
    state.focused = star(7);
    state.pinned.push(star(12));
    state.vector = star(12);
    expect(input.applyObjectClick(star(12))).toBe(true);
    expect(deps.setVector).toHaveBeenCalledWith(null);
    expect(deps.togglePoi).toHaveBeenCalledWith(star(12));
  });

  it('steps only the vector rungs when the HUD is hidden', () => {
    const { input, deps, state } = makeHarness();
    state.focused = star(7);
    state.filter.showHud = false;
    state.pinned.push(star(12));
    expect(input.applyObjectClick(star(12))).toBe(true);
    expect(deps.setVector).toHaveBeenCalledWith(star(12));
    expect(deps.togglePoi).not.toHaveBeenCalled();
  });

  it('runs the SAME ladder for planets: pin, then vector, then clear both', () => {
    const { input, deps, state } = makeHarness();
    state.focused = star(0);
    expect(input.applyObjectClick(planet(4))).toBe(true);
    expect(deps.togglePoi).toHaveBeenCalledWith(planet(4));

    state.pinned.push(planet(4));
    expect(input.applyObjectClick(planet(4))).toBe(true);
    expect(deps.setVector).toHaveBeenCalledWith(planet(4));

    state.vector = planet(4);
    expect(input.applyObjectClick(planet(4))).toBe(true);
    expect(deps.setVector).toHaveBeenCalledWith(null);
    expect(deps.togglePoi).toHaveBeenCalledTimes(2);
  });

  it('a star pin and a planet pin with the same idx are distinct ladder states', () => {
    const { input, deps, state } = makeHarness();
    state.focused = star(7);
    state.pinned.push(star(4));
    expect(input.applyObjectClick(planet(4))).toBe(true);
    expect(deps.togglePoi).toHaveBeenCalledWith(planet(4));
  });
});

describe('InputController.applyObjectClick × real PoiStore — full ladder walk', () => {
  // Integration over the store seam the mocked harness skips: the real
  // PoiStore decides pinnable / pinned / atCap, so a store-level
  // carve-out that silently degrades the ladder (click → vector with
  // no pin, the reported regression shape) fails here even when the
  // pure ladder tests stay green.
  function makeIntegrated() {
    const h = makeHarness();
    const store = new PoiStore({
      pinnable: {
        star: (idx) => idx >= 0 && idx < 10,
        planet: (idx) => idx >= 0 && idx < 9,
        lg: (idx) => idx >= 0 && idx < 4,
        shell: () => false,
        probe: () => false,
        cloud: () => false,
      },
      onChange: () => {},
    });
    const deps = (h.input as unknown as { deps: Record<string, unknown> }).deps;
    deps.poiStore = store;
    deps.togglePoi = (t: Target) => store.toggle(t);
    deps.setVector = (t: Target | null) => { h.state.vector = t; };
    return { ...h, store };
  }

  function walkLadder(h: ReturnType<typeof makeIntegrated>, target: Target) {
    // Rung 1: fresh object pins — no vector.
    expect(h.input.applyObjectClick(target)).toBe(true);
    expect(h.store.has(target)).toBe(true);
    expect(h.state.vector).toBe(null);
    // Rung 2: pinned object becomes the vector destination, stays pinned.
    expect(h.input.applyObjectClick(target)).toBe(true);
    expect(h.state.vector).toEqual(target);
    expect(h.store.has(target)).toBe(true);
    // Rung 3: pinned vector destination clears both.
    expect(h.input.applyObjectClick(target)).toBe(true);
    expect(h.state.vector).toBe(null);
    expect(h.store.has(target)).toBe(false);
  }

  it('walks pin → vector → clear-both on a fresh star', () => {
    const h = makeIntegrated();
    h.state.focused = star(1);
    walkLadder(h, star(2));
  });

  it('walks the same ladder for a planet', () => {
    const h = makeIntegrated();
    h.state.focused = star(1);
    walkLadder(h, planet(4));
  });

  it('walks the same ladder for a Local Group object', () => {
    const h = makeIntegrated();
    h.state.focused = star(1);
    walkLadder(h, lg(2));
  });

  it('walks the same ladder for Sol — no per-object carve-out', () => {
    // Regression: PoiStore once excluded Sol from pinning, so a click
    // on Sol while focused elsewhere skipped rung 1 and drew the
    // distance vector immediately.
    const h = makeIntegrated();
    h.state.focused = star(1);
    walkLadder(h, star(0));
  });
});

describe('InputController.applyObjectClick — observe mode', () => {
  it('toggles the pin when the HUD is on — stars and planets alike', () => {
    const { input, deps, state } = makeHarness();
    state.cameraMode = 'observe';
    expect(input.applyObjectClick(star(3))).toBe(true);
    expect(deps.togglePoi).toHaveBeenCalledWith(star(3));
    expect(input.applyObjectClick(planet(2))).toBe(true);
    expect(deps.togglePoi).toHaveBeenCalledWith(planet(2));
  });

  it('is a noop when the HUD is hidden', () => {
    const { input, deps, state } = makeHarness();
    state.cameraMode = 'observe';
    state.filter.showHud = false;
    expect(input.applyObjectClick(star(3))).toBe(false);
    expect(deps.togglePoi).not.toHaveBeenCalled();
  });
});

describe('InputController click dispatch', () => {
  it('emits noopClick when a single click hits empty sky', () => {
    const { input, emitted } = makeHarness();
    (input as unknown as WithPrivates).dispatchSingleClick(10, 20);
    expect(emitted).toEqual(['noopClick']);
  });

  it('does not emit noopClick when the click did something', () => {
    const { input, emitted, state, deps } = makeHarness();
    state.pickStarResult = 5;
    (input as unknown as WithPrivates).dispatchSingleClick(10, 20);
    expect(deps.flyTo).toHaveBeenCalledWith(star(5));
    expect(emitted).toEqual([]);
  });

  it('orbits a clicked cloud from no focus (pre-ladder cloud semantics)', () => {
    const { input, state, deps } = makeHarness();
    state.pickCloudResult = 2;
    (input as unknown as WithPrivates).dispatchSingleClick(10, 20);
    expect(deps.setOrbitTarget).toHaveBeenCalledWith({ kind: 'cloud', idx: 2 });
  });
});

// The deferred-dispatch gate (`blocksClick`). Both handlers share one
// predicate, so each term is pinned on both to catch a one-sided edit.
describe('InputController deferred-click gate', () => {
  const gates = ['warpActive', 'aimActive', 'observeTransitionActive'] as const;

  for (const gate of gates) {
    it(`drops a single click while ${gate}`, () => {
      const { input, state, deps, emitted } = makeHarness();
      state.pickStarResult = 5;
      state[gate] = true;
      (input as unknown as WithPrivates).dispatchSingleClick(10, 20);
      expect(deps.flyTo).not.toHaveBeenCalled();
      expect(emitted).toEqual([]);
    });

    it(`drops a double click while ${gate}`, () => {
      const { input, state, deps, emitted } = makeHarness();
      state.pickStarResult = 5;
      state[gate] = true;
      (input as unknown as WithPrivates).dispatchDoubleClick(10, 20);
      expect(deps.flyTo).not.toHaveBeenCalled();
      expect(emitted).toEqual([]);
    });
  }

  // The cloud pick carried its own warp gate until the kind module took
  // it over; this predicate is what subsumes it, so the cloud path is
  // pinned here too rather than only through the star pick above.
  it('drops a cloud single click while warping (no orbit target, no vector)', () => {
    const { input, state, deps, emitted } = makeHarness();
    state.pickCloudResult = 2;
    state.warpActive = true;
    (input as unknown as WithPrivates).dispatchSingleClick(10, 20);
    expect(deps.setOrbitTarget).not.toHaveBeenCalled();
    expect(deps.setVector).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
  });

  it('drops a cloud double click while warping (no travel)', () => {
    const { input, state, deps, emitted } = makeHarness();
    state.pickCloudResult = 2;
    state.warpActive = true;
    (input as unknown as WithPrivates).dispatchDoubleClick(10, 20);
    expect(deps.flyTo).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
  });

  it('dispatches normally when no gate is set', () => {
    const { input, state, deps } = makeHarness();
    state.pickStarResult = 5;
    (input as unknown as WithPrivates).dispatchSingleClick(10, 20);
    expect(deps.flyTo).toHaveBeenCalledWith(star(5));
  });
});

// Hoisting the observe bail above the cancels is the refactor these pin against.
describe('InputController.onPointerUp — claim-the-camera order', () => {
  function pointerClick(canvas: Harness['canvas']) {
    const handlerFor = (name: string) => canvas.addEventListener.mock.calls
      .find((c: unknown[]) => c[0] === name)?.[1] as (e: PointerEvent) => void;
    const at = { button: 0, clientX: 10, clientY: 20 } as PointerEvent;
    handlerFor('pointerdown')(at);
    handlerFor('pointerup')(at);
  }

  it('cancels both lerps before bailing on an observe transition', () => {
    const { canvas, state, cancelled } = makeHarness();
    state.observeTransitionActive = true;
    pointerClick(canvas);
    expect(cancelled).toEqual(['unfocus', 'focus']);
  });

  it('bails on warp WITHOUT cancelling — the warp owns the camera outright', () => {
    const { canvas, state, cancelled } = makeHarness();
    state.warpActive = true;
    pointerClick(canvas);
    expect(cancelled).toEqual([]);
  });

  it('bails on aim WITHOUT cancelling', () => {
    const { canvas, state, cancelled } = makeHarness();
    state.aimActive = true;
    pointerClick(canvas);
    expect(cancelled).toEqual([]);
  });

  it('cancels both lerps on an ordinary click', () => {
    const { canvas, cancelled } = makeHarness();
    pointerClick(canvas);
    expect(cancelled).toEqual(['unfocus', 'focus']);
  });
});

describe('InputController planet clicks — navigate mode', () => {
  it('single click on a planet with nothing focused travels to it', () => {
    const { input, state, deps, emitted } = makeHarness();
    state.pickPlanetResult = 4;
    (input as unknown as WithPrivates).dispatchSingleClick(10, 20);
    expect(deps.flyTo).toHaveBeenCalledWith(planet(4));
    expect(emitted).toEqual([]);
  });

  it('single click on a planet while a star is focused PINS it (no focus change)', () => {
    const { input, state, deps } = makeHarness();
    state.focused = star(0);
    state.pickPlanetResult = 4;
    (input as unknown as WithPrivates).dispatchSingleClick(10, 20);
    expect(deps.togglePoi).toHaveBeenCalledWith(planet(4));
    expect(deps.flyTo).not.toHaveBeenCalled();
  });

  it('single click on the focused planet unfocuses', () => {
    const { input, state, deps } = makeHarness();
    state.focused = planet(4);
    state.pickPlanetResult = 4;
    (input as unknown as WithPrivates).dispatchSingleClick(10, 20);
    expect(deps.unfocus).toHaveBeenCalled();
    expect(deps.flyTo).not.toHaveBeenCalled();
  });

  it('single click on the focused planet clears a drawn vector first', () => {
    const { input, state, deps } = makeHarness();
    state.focused = planet(4);
    state.pickPlanetResult = 4;
    state.vector = star(9);
    (input as unknown as WithPrivates).dispatchSingleClick(10, 20);
    expect(deps.setVector).toHaveBeenCalledWith(null);
    expect(deps.unfocus).not.toHaveBeenCalled();
  });

  it('star vs planet overlap: same tier, closer to camera wins', () => {
    const { input, state, deps } = makeHarness();
    state.pickStarResult = 5;
    state.pickStarDistancePc = 2;
    state.pickPlanetResult = 4;
    state.pickPlanetDistancePc = 1e-5;
    (input as unknown as WithPrivates).dispatchSingleClick(10, 20);
    expect(deps.flyTo).toHaveBeenCalledWith(planet(4));
  });

  it('star vs planet overlap: prime beats fallback regardless of distance', () => {
    const { input, state, deps } = makeHarness();
    state.pickStarResult = 5;
    state.pickStarDistancePc = 1e-6; // closer, but only a fallback hit
    state.pickStarTier = 'fallback';
    state.pickPlanetResult = 4;
    state.pickPlanetDistancePc = 1;
    (input as unknown as WithPrivates).dispatchSingleClick(10, 20);
    expect(deps.flyTo).toHaveBeenCalledWith(planet(4));
  });

  it('double click on a planet travels to it', () => {
    const { input, state, deps } = makeHarness();
    state.pickPlanetResult = 4;
    (input as unknown as { dispatchDoubleClick(x: number, y: number): void })
      .dispatchDoubleClick(10, 20);
    expect(deps.flyTo).toHaveBeenCalledWith(planet(4));
  });
});

describe('InputController Local Group clicks — navigate mode', () => {
  it('single click on an LG object with nothing focused travels to it', () => {
    const { input, state, deps, emitted } = makeHarness();
    state.pickLgResult = 2;
    (input as unknown as WithPrivates).dispatchSingleClick(10, 20);
    expect(deps.flyTo).toHaveBeenCalledWith(lg(2));
    expect(emitted).toEqual([]);
  });

  it('single click on an LG object while a star is focused PINS it', () => {
    const { input, state, deps } = makeHarness();
    state.focused = star(0);
    state.pickLgResult = 2;
    (input as unknown as WithPrivates).dispatchSingleClick(10, 20);
    expect(deps.togglePoi).toHaveBeenCalledWith(lg(2));
    expect(deps.flyTo).not.toHaveBeenCalled();
  });

  it('star vs LG overlap: a prime star hit beats a fallback LG hit', () => {
    const { input, state, deps } = makeHarness();
    state.pickStarResult = 5;
    state.pickStarDistancePc = 100;
    state.pickLgResult = 2;
    state.pickLgDistancePc = 1; // closer, but only a fallback hit
    state.pickLgTier = 'fallback';
    (input as unknown as WithPrivates).dispatchSingleClick(10, 20);
    expect(deps.flyTo).toHaveBeenCalledWith(star(5));
  });

  it('double click on an LG object travels to it', () => {
    const { input, state, deps } = makeHarness();
    state.pickLgResult = 2;
    (input as unknown as { dispatchDoubleClick(x: number, y: number): void })
      .dispatchDoubleClick(10, 20);
    expect(deps.flyTo).toHaveBeenCalledWith(lg(2));
  });
});

describe('InputController probe clicks — navigate mode', () => {
  it('single click on a probe with nothing focused travels to it', () => {
    const { input, state, deps, emitted } = makeHarness();
    state.pickProbeResult = 3;
    (input as unknown as WithPrivates).dispatchSingleClick(10, 20);
    expect(deps.flyTo).toHaveBeenCalledWith(probe(3));
    expect(emitted).toEqual([]);
  });

  it('single click on a probe while a star is focused PINS it', () => {
    const { input, state, deps } = makeHarness();
    state.focused = star(0);
    state.pickProbeResult = 3;
    (input as unknown as WithPrivates).dispatchSingleClick(10, 20);
    expect(deps.togglePoi).toHaveBeenCalledWith(probe(3));
    expect(deps.flyTo).not.toHaveBeenCalled();
  });

  // The probe marker draws over the planet glare it overlaps, so the
  // ladder has to resolve the same way the eye does.
  it('probe vs planet overlap: the nearer prime hit wins', () => {
    const { input, state, deps } = makeHarness();
    state.pickPlanetResult = 4;
    state.pickPlanetDistancePc = 100;
    state.pickProbeResult = 3;
    state.pickProbeDistancePc = 1;
    (input as unknown as WithPrivates).dispatchSingleClick(10, 20);
    expect(deps.flyTo).toHaveBeenCalledWith(probe(3));
  });

  it('double click on a probe travels to it', () => {
    const { input, state, deps } = makeHarness();
    state.pickProbeResult = 3;
    (input as unknown as { dispatchDoubleClick(x: number, y: number): void })
      .dispatchDoubleClick(10, 20);
    expect(deps.flyTo).toHaveBeenCalledWith(probe(3));
  });
});

describe('InputController.rollCamera', () => {
  it('rolls the rendered up by the requested angle, and the roll persists', () => {
    const { input, camera, roll } = makeHarness();
    roll.levelTo(camera, GALACTIC_NORTH_POLE_ICRS);
    const upBefore = camera.up.clone();

    (input as unknown as WithPrivates).rollCamera(Math.PI / 2);

    expect(camera.up.length()).toBeCloseTo(1, 12);
    expect(camera.up.angleTo(upBefore)).toBeCloseTo(Math.PI / 2, 6);
    // The tilt lives on camera.up itself, and no per-frame step writes it,
    // so a plain lookAt reproduces the rolled pose rather than unwinding it.
    const upRolled = camera.up.clone();
    camera.lookAt(new THREE.Vector3(0, 0, 0));
    expect(camera.up.angleTo(upRolled)).toBeCloseTo(0, 12);
  });

  it('also rolls the camera quaternion in observe mode (rendered-image roll)', () => {
    const { input, camera, state } = makeHarness();
    state.cameraMode = 'observe';
    const upBefore = camera.up.clone();
    const quatBefore = camera.quaternion.clone();

    (input as unknown as WithPrivates).rollCamera(Math.PI / 2);

    expect(camera.quaternion.length()).toBeCloseTo(1, 12);
    expect(camera.quaternion.angleTo(quatBefore)).toBeCloseTo(Math.PI / 2, 6);
    // up tracks the quaternion in observe — the URL encodes camera.up.
    expect(camera.up.angleTo(upBefore)).toBeCloseTo(Math.PI / 2, 6);
  });
});

describe('InputController Shift-drag roll', () => {
  const CENTRE_X = 400;
  const CENTRE_Y = 300;
  const RADIUS = 200;

  const pointer = (over: Partial<PointerEvent> = {}) => ({
    button: 0, pointerId: 1, shiftKey: false, clientX: CENTRE_X + RADIUS, clientY: CENTRE_Y, ...over,
  } as PointerEvent);

  /** Pointer at `bearing` rad around screen centre. A move from b0 to b1
   *  requests a roll of −(b1 − b0) (finger CW on screen → world CW). */
  const at = (bearing: number, over: Partial<PointerEvent> = {}) => pointer({
    clientX: CENTRE_X + RADIUS * Math.cos(bearing),
    clientY: CENTRE_Y + RADIUS * Math.sin(bearing),
    ...over,
  });


  function handlers(canvas: ReturnType<typeof makeHarness>['canvas']) {
    const byType = new Map<string, (e: Event) => void>();
    for (const [type, fn] of canvas.addEventListener.mock.calls) {
      byType.set(type as string, fn as (e: Event) => void);
    }
    return byType;
  }

  it('suppresses TrackballControls rotation for the gesture, and restores it on release', () => {
    const { canvas, controls } = makeHarness();
    const h = handlers(canvas);

    h.get('pointerdown')!(pointer({ shiftKey: true }) as unknown as Event);
    expect(controls.noRotate).toBe(true);

    h.get('pointerup')!(pointer() as unknown as Event);
    expect(controls.noRotate).toBe(false);
  });

  it('rolls on drag and never dispatches a click', () => {
    const { canvas, camera, roll, deps } = makeHarness();
    const h = handlers(canvas);
    roll.levelTo(camera, GALACTIC_NORTH_POLE_ICRS);
    const upBefore = camera.up.clone();

    // Quarter turn of bearing, well outside the snap band.
    h.get('pointerdown')!(at(0, { shiftKey: true }) as unknown as Event);
    h.get('pointermove')!(at(Math.PI / 2) as unknown as Event);
    h.get('pointerup')!(at(Math.PI / 2) as unknown as Event);

    expect(camera.up.angleTo(upBefore)).toBeCloseTo(Math.PI / 2, 6);
    expect(deps.flyTo).not.toHaveBeenCalled();
    expect(deps.togglePoi).not.toHaveBeenCalled();
  });

  it('ignores bearing samples inside the centre dead-zone', () => {
    const { canvas, camera, roll } = makeHarness();
    const h = handlers(canvas);
    roll.levelTo(camera, GALACTIC_NORTH_POLE_ICRS);
    const upBefore = camera.up.clone();

    h.get('pointerdown')!(pointer({ shiftKey: true, clientX: CENTRE_X + 5, clientY: CENTRE_Y }) as unknown as Event);
    h.get('pointermove')!(pointer({ clientX: CENTRE_X, clientY: CENTRE_Y + 5 }) as unknown as Event);

    expect(camera.up.angleTo(upBefore)).toBeCloseTo(0, 9);
  });
});

describe('InputController Shift as a live modifier', () => {
  const pointer = (over: Partial<PointerEvent> = {}) => ({
    button: 0, pointerId: 1, shiftKey: false, clientX: 600, clientY: 300, ...over,
  } as PointerEvent);

  function handlers(canvas: ReturnType<typeof makeHarness>['canvas']) {
    const byType = new Map<string, (e: Event) => void>();
    for (const [type, fn] of canvas.addEventListener.mock.calls) {
      byType.set(type as string, fn as (e: Event) => void);
    }
    return byType;
  }

  function shift(type: 'keydown' | 'keyup', code = 'ShiftLeft') {
    const e = new Event(type, { bubbles: true });
    Object.assign(e, { key: 'Shift', code });
    window.dispatchEvent(e);
  }

  it.each(['ShiftLeft', 'ShiftRight'])('starts rolling mid-drag when %s goes down', (code) => {
    const { canvas, controls, camera, roll } = makeHarness();
    const h = handlers(canvas);
    roll.levelTo(camera, GALACTIC_NORTH_POLE_ICRS);
    const upBefore = camera.up.clone();

    // Plain drag first: orbit is TrackballControls', and no roll happens.
    h.get('pointerdown')!(pointer() as unknown as Event);
    h.get('pointermove')!(pointer({ clientX: 400, clientY: 500 }) as unknown as Event);
    expect(controls.noRotate).toBe(false);
    expect(camera.up.angleTo(upBefore)).toBeCloseTo(0, 9);

    shift('keydown', code);
    expect(controls.noRotate).toBe(true);

    // Bearing from (400,500) back to (600,300): a quarter turn.
    h.get('pointermove')!(pointer({ clientX: 600, clientY: 300 }) as unknown as Event);
    expect(camera.up.angleTo(upBefore)).toBeCloseTo(Math.PI / 2, 6);
  });

  it.each(['ShiftLeft', 'ShiftRight'])('stops rolling the moment %s is released mid-drag', (code) => {
    const { canvas, controls, camera, roll } = makeHarness();
    const h = handlers(canvas);
    roll.levelTo(camera, GALACTIC_NORTH_POLE_ICRS);

    h.get('pointerdown')!(pointer({ shiftKey: true }) as unknown as Event);
    expect(controls.noRotate).toBe(true);

    shift('keyup', code);
    expect(controls.noRotate).toBe(false);

    // Still dragging, but the pointer stream belongs to orbit again.
    const upBefore = camera.up.clone();
    h.get('pointermove')!(pointer({ clientX: 400, clientY: 500 }) as unknown as Event);
    expect(camera.up.angleTo(upBefore)).toBeCloseTo(0, 9);
  });

  it('re-arms on a second Shift press within the same drag', () => {
    const { canvas, controls } = makeHarness();
    const h = handlers(canvas);

    h.get('pointerdown')!(pointer() as unknown as Event);
    shift('keydown');
    shift('keyup');
    expect(controls.noRotate).toBe(false);
    shift('keydown');
    expect(controls.noRotate).toBe(true);
  });

  it('does not claim the drag when Shift is pressed with no pointer down', () => {
    const { canvas, controls } = makeHarness();
    handlers(canvas);
    shift('keydown');
    expect(controls.noRotate).toBe(false);
  });

  it('releases the roll on window blur, so a missed keyup cannot latch it', () => {
    const { canvas, controls } = makeHarness();
    const h = handlers(canvas);

    h.get('pointerdown')!(pointer({ shiftKey: true }) as unknown as Event);
    expect(controls.noRotate).toBe(true);

    window.dispatchEvent(new Event('blur'));
    expect(controls.noRotate).toBe(false);
  });
});

describe('InputController pinch-to-zoom', () => {
  function handlers(canvas: ReturnType<typeof makeHarness>['canvas']) {
    const byType = new Map<string, (e: Event) => void>();
    for (const [type, fn] of canvas.addEventListener.mock.calls) {
      byType.set(type as string, fn as (e: Event) => void);
    }
    return byType;
  }

  /** Pinch deltaY worth `n` notches after amplification — written in these
   *  units so tuning the gains can't rot the wiring cases. */
  const notchUnits = (n: number) => (n * WHEEL_NOTCH_DELTA_PX) / PINCH_NOTCH_GAIN;

  function wheel(over: { ctrlKey?: boolean; deltaY?: number } = {}) {
    const e = new Event('wheel', { cancelable: true });
    Object.assign(e, { ctrlKey: true, deltaY: 0, ...over });
    return e;
  }

  /** The pinch listener sits on window in the capture phase, ahead of the
   *  canvas listeners TrackballControls / ObserveControls own. */
  function pinch(e: Event) {
    window.dispatchEvent(e);
  }

  it('re-emits an amplified pinch as one ordinary wheel notch on the canvas', () => {
    const { canvas } = makeHarness();

    // Two events worth 0.6 notches each: the notch lands on the second.
    pinch(wheel({ deltaY: notchUnits(0.6) }));
    expect(canvas.dispatchEvent).not.toHaveBeenCalled();

    pinch(wheel({ deltaY: notchUnits(0.6) }));
    expect(canvas.dispatchEvent).toHaveBeenCalledTimes(1);
    const emitted = canvas.dispatchEvent.mock.calls[0][0] as WheelEvent;
    expect(emitted.type).toBe('wheel');
    expect(emitted.deltaY).toBe(WHEEL_NOTCH_DELTA_PX);
    expect(emitted.deltaMode).toBe(0);
    // Re-emitted without ctrlKey, or the capture listener would re-enter.
    expect(emitted.ctrlKey).toBe(false);
  });

  it('consumes the pinch so the browser cannot page-zoom and TC cannot double-count', () => {
    const { canvas } = makeHarness();
    const e = wheel({ deltaY: notchUnits(1) });
    const prevented = vi.spyOn(e, 'preventDefault');
    const stopped = vi.spyOn(e, 'stopPropagation');

    pinch(e);

    expect(prevented).toHaveBeenCalled();
    expect(stopped).toHaveBeenCalled();
    expect(canvas.dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it('leaves a plain scroll alone — that path is already calibrated', () => {
    const { canvas } = makeHarness();
    const e = wheel({ ctrlKey: false, deltaY: 100 });
    const prevented = vi.spyOn(e, 'preventDefault');

    pinch(e);

    expect(prevented).not.toHaveBeenCalled();
    expect(canvas.dispatchEvent).not.toHaveBeenCalled();
  });

  it('ignores a pinch that is not over the canvas', () => {
    const { canvas } = makeHarness();
    canvas.contains.mockReturnValue(false);

    pinch(wheel({ deltaY: 100 }));

    expect(canvas.dispatchEvent).not.toHaveBeenCalled();
  });

  it('zooms from a WebKit gesture scale — Safari never sends a ctrlKey wheel', () => {
    const { canvas } = makeHarness();
    const gestureHandlers = handlers(canvas);
    const gesture = (type: string, over: Record<string, number> = {}) => {
      const e = new Event(type, { cancelable: true });
      Object.assign(e, { rotation: 0, scale: 1, ...over });
      return e;
    };

    gestureHandlers.get('gesturestart')!(gesture('gesturestart'));
    // Spreading the fingers: scale climbs, camera zooms in (negative delta).
    gestureHandlers.get('gesturechange')!(gesture('gesturechange', { scale: 1.5 }));

    expect(canvas.dispatchEvent).toHaveBeenCalled();
    const emitted = canvas.dispatchEvent.mock.calls[0][0] as WheelEvent;
    expect(emitted.type).toBe('wheel');
    expect(emitted.deltaY).toBe(-WHEEL_NOTCH_DELTA_PX);
  });

  it('stands the wheel path down while a WebKit gesture owns the pinch', () => {
    const { canvas } = makeHarness();
    const h = handlers(canvas);
    const gesture = (type: string, over: Record<string, number> = {}) => {
      const e = new Event(type, { cancelable: true });
      Object.assign(e, { rotation: 0, scale: 1, ...over });
      return e;
    };

    h.get('gesturestart')!(gesture('gesturestart'));
    const consumed = wheel({ deltaY: 100 });
    const prevented = vi.spyOn(consumed, 'preventDefault');
    pinch(consumed);

    // Still consumed (no page zoom, no TC nudge) but not counted twice.
    expect(prevented).toHaveBeenCalled();
    expect(canvas.dispatchEvent).not.toHaveBeenCalled();

    // Once the gesture ends the wheel path takes over again.
    h.get('gestureend')!(gesture('gestureend'));
    pinch(wheel({ deltaY: 100 }));
    expect(canvas.dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it('zooms out on the opposite pinch direction', () => {
    const { canvas } = makeHarness();
    pinch(wheel({ deltaY: notchUnits(-1) }));
    const emitted = canvas.dispatchEvent.mock.calls[0][0] as WheelEvent;
    expect(emitted.deltaY).toBe(-WHEEL_NOTCH_DELTA_PX);
  });
});

describe('InputController.dispose', () => {
  it('removes every canvas listener it added', () => {
    const { input, canvas } = makeHarness();
    const added = canvas.addEventListener.mock.calls;
    expect(added.length).toBeGreaterThan(0);
    input.dispose();
    const removed = canvas.removeEventListener.mock.calls;
    expect(removed.length).toBe(added.length);
    for (const [type, handler] of added) {
      expect(removed).toContainEqual([type, handler]);
    }
  });
});
