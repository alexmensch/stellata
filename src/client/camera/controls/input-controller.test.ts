import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';
import { InputController, type InputControllerDeps } from './input-controller';
import { DEFAULT_FILTER, type FilterState } from '../../filters/filter-state';
import { targetsEqual, type Target } from '../focus/focus-target';
import type { Picker } from './picker';
import type { PoiStore } from '../../poi/poi-store';
import type { CameraMode, StellataEventMap } from '../../stellata';
import type { EventBus } from '../../util/event-bus';

const star = (idx: number): Target => ({ kind: 'star', idx });
const planet = (idx: number): Target => ({ kind: 'planet', idx });

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
  };
  emitted: string[];
  camera: THREE.PerspectiveCamera;
  canvas: {
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
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
  };
  const emitted: string[] = [];
  const canvasMock = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  const canvas = canvasMock as unknown as HTMLCanvasElement;
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  const controls = {
    target: new THREE.Vector3(0, 0, -1),
    noPan: false,
    keys: ['', '', ''] as string[],
  } as unknown as TrackballControls;
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
      pickCloud: () => state.pickCloudResult,
      pickPlanetClick: () => (state.pickPlanetResult !== null
        ? {
            idx: state.pickPlanetResult,
            cameraDistancePc: state.pickPlanetDistancePc,
            tier: state.pickPlanetTier,
          }
        : null),
    } as unknown as Picker,
    bus: {
      emit: (name: string) => { emitted.push(name); },
    } as unknown as EventBus<StellataEventMap>,
    poiStore: {
      pinnable: (t: Target) => !(t.kind === 'star' && t.idx === 0),
      has: (t: Target) => state.pinned.some((p) => targetsEqual(p, t)),
      atCap: () => false,
    } as unknown as PoiStore,
    getCameraMode: () => state.cameraMode,
    getFilter: () => state.filter,
    getFocusedTarget: () => state.focused,
    getVectorTarget: () => state.vector,
    setVector: deps.setVector,
    isWarpActive: () => false,
    isAimActive: () => false,
    isObserveTransitionActive: () => false,
    cancelUnfocusLerp: () => {},
    cancelFocusLerp: () => {},
    flyTo: deps.flyTo,
    setOrbitTarget: deps.setOrbitTarget,
    unfocus: deps.unfocus,
    togglePoi: deps.togglePoi,
    aimAt: deps.aimAt,
  } satisfies InputControllerDeps);
  return { input, deps, state, emitted, camera, canvas: canvasMock };
}

type WithPrivates = {
  dispatchSingleClick(x: number, y: number): void;
  rollCamera(angle: number): void;
};

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
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

describe('InputController.rollCamera', () => {
  it('rolls camera.up around the forward axis without per-event allocation drift', () => {
    const { input, camera } = makeHarness();
    const upBefore = camera.up.clone();
    (input as unknown as WithPrivates).rollCamera(Math.PI / 2);
    expect(camera.up.length()).toBeCloseTo(1, 12);
    expect(Math.abs(camera.up.angleTo(upBefore))).toBeCloseTo(Math.PI / 2, 6);
  });

  it('also rolls the camera quaternion in observe mode (rendered-image roll)', () => {
    const { input, camera, state } = makeHarness();
    state.cameraMode = 'observe';
    const upBefore = camera.up.clone();
    const quatBefore = camera.quaternion.clone();
    (input as unknown as WithPrivates).rollCamera(Math.PI / 2);
    expect(camera.quaternion.length()).toBeCloseTo(1, 12);
    expect(camera.quaternion.angleTo(quatBefore)).toBeCloseTo(Math.PI / 2, 6);
    // up rolls in both modes — URL state encodes it, so observe can't skip it.
    expect(Math.abs(camera.up.angleTo(upBefore))).toBeCloseTo(Math.PI / 2, 6);
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
