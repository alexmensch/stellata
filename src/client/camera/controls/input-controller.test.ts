import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';
import { InputController, type InputControllerDeps } from './input-controller';
import { DEFAULT_FILTER, type FilterState } from '../../filters/filter-state';
import type { Picker } from './picker';
import type { PoiStore } from '../../poi/poi-store';
import type { CameraMode, StellataEventMap } from '../../stellata';
import type { EventBus } from '../../util/event-bus';

interface Harness {
  input: InputController;
  deps: {
    focusStar: ReturnType<typeof vi.fn>;
    flyToCloud: ReturnType<typeof vi.fn>;
    unfocus: ReturnType<typeof vi.fn>;
    togglePoi: ReturnType<typeof vi.fn>;
    setVectorTo: ReturnType<typeof vi.fn>;
    setVectorToCloud: ReturnType<typeof vi.fn>;
    setOrbitTargetCloud: ReturnType<typeof vi.fn>;
    aimAt: ReturnType<typeof vi.fn>;
  };
  state: {
    cameraMode: CameraMode;
    filter: FilterState;
    focusedStar: number | null;
    focusedCloud: number | null;
    vectorTo: number | null;
    vectorToCloud: number | null;
    pinned: Set<number>;
    pickStarResult: number;
    pickCloudResult: number | null;
  };
  emitted: string[];
  camera: THREE.PerspectiveCamera;
}

function makeHarness(): Harness {
  const state = {
    cameraMode: 'navigate' as CameraMode,
    filter: { ...DEFAULT_FILTER, showHud: true },
    focusedStar: null as number | null,
    focusedCloud: null as number | null,
    vectorTo: null as number | null,
    vectorToCloud: null as number | null,
    pinned: new Set<number>(),
    pickStarResult: -1,
    pickCloudResult: null as number | null,
  };
  const emitted: string[] = [];
  const canvas = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as HTMLCanvasElement;
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  const controls = {
    target: new THREE.Vector3(0, 0, -1),
    noPan: false,
    keys: ['', '', ''] as string[],
  } as unknown as TrackballControls;
  const deps = {
    focusStar: vi.fn(),
    flyToCloud: vi.fn(),
    unfocus: vi.fn(),
    togglePoi: vi.fn(() => true),
    setVectorTo: vi.fn(),
    setVectorToCloud: vi.fn(),
    setOrbitTargetCloud: vi.fn(),
    aimAt: vi.fn(),
  };
  const input = new InputController({
    canvas,
    camera,
    controls,
    picker: {
      pickStar: () => state.pickStarResult,
      pickCloud: () => state.pickCloudResult,
    } as unknown as Picker,
    bus: {
      emit: (name: string) => { emitted.push(name); },
    } as unknown as EventBus<StellataEventMap>,
    poiStore: {
      pinnable: (idx: number) => idx !== 0,
      has: (idx: number) => state.pinned.has(idx),
      atCap: () => false,
    } as unknown as PoiStore,
    getCameraMode: () => state.cameraMode,
    getFilter: () => state.filter,
    getFocusedStar: () => state.focusedStar,
    getFocusedCloud: () => state.focusedCloud,
    getVectorTo: () => state.vectorTo,
    getVectorToCloud: () => state.vectorToCloud,
    setVectorTo: deps.setVectorTo,
    setVectorToCloud: deps.setVectorToCloud,
    isWarpActive: () => false,
    isAimActive: () => false,
    isObserveTransitionActive: () => false,
    cancelUnfocusLerp: () => {},
    cancelFocusLerp: () => {},
    focusStar: deps.focusStar,
    flyToCloud: deps.flyToCloud,
    setOrbitTargetCloud: deps.setOrbitTargetCloud,
    unfocus: deps.unfocus,
    togglePoi: deps.togglePoi,
    aimAt: deps.aimAt,
  } satisfies InputControllerDeps);
  return { input, deps, state, emitted, camera };
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

describe('InputController.applyStarClick — navigate mode', () => {
  it('focuses the clicked star when nothing is focused', () => {
    const { input, deps } = makeHarness();
    expect(input.applyStarClick(7)).toBe(true);
    expect(deps.focusStar).toHaveBeenCalledWith(7);
  });

  it('unfocuses on click-the-focused-star with no vector', () => {
    const { input, deps, state } = makeHarness();
    state.focusedStar = 7;
    expect(input.applyStarClick(7)).toBe(true);
    expect(deps.unfocus).toHaveBeenCalled();
    expect(deps.setVectorTo).not.toHaveBeenCalled();
  });

  it('clears the vector (stays focused) on click-the-focused-star with a vector drawn', () => {
    const { input, deps, state } = makeHarness();
    state.focusedStar = 7;
    state.vectorTo = 12;
    expect(input.applyStarClick(7)).toBe(true);
    expect(deps.setVectorTo).toHaveBeenCalledWith(null);
    expect(deps.setVectorToCloud).toHaveBeenCalledWith(null);
    expect(deps.unfocus).not.toHaveBeenCalled();
  });

  it('pins an unpinned other star (ladder rung 1)', () => {
    const { input, deps, state } = makeHarness();
    state.focusedStar = 7;
    expect(input.applyStarClick(12)).toBe(true);
    expect(deps.togglePoi).toHaveBeenCalledWith(12);
  });

  it('sets the vector on a pinned other star that is not the destination', () => {
    const { input, deps, state } = makeHarness();
    state.focusedStar = 7;
    state.pinned.add(12);
    expect(input.applyStarClick(12)).toBe(true);
    expect(deps.setVectorTo).toHaveBeenCalledWith(12);
    expect(deps.togglePoi).not.toHaveBeenCalled();
  });

  it('clears vector AND unpins on the pinned vector destination', () => {
    const { input, deps, state } = makeHarness();
    state.focusedStar = 7;
    state.pinned.add(12);
    state.vectorTo = 12;
    expect(input.applyStarClick(12)).toBe(true);
    expect(deps.setVectorTo).toHaveBeenCalledWith(null);
    expect(deps.togglePoi).toHaveBeenCalledWith(12);
  });

  it('steps only the vector rungs when the HUD is hidden', () => {
    const { input, deps, state } = makeHarness();
    state.focusedStar = 7;
    state.filter.showHud = false;
    state.pinned.add(12);
    expect(input.applyStarClick(12)).toBe(true);
    expect(deps.setVectorTo).toHaveBeenCalledWith(12);
    expect(deps.togglePoi).not.toHaveBeenCalled();
  });
});

describe('InputController.applyStarClick — observe mode', () => {
  it('toggles the pin when the HUD is on', () => {
    const { input, deps, state } = makeHarness();
    state.cameraMode = 'observe';
    expect(input.applyStarClick(3)).toBe(true);
    expect(deps.togglePoi).toHaveBeenCalledWith(3);
  });

  it('is a noop when the HUD is hidden', () => {
    const { input, deps, state } = makeHarness();
    state.cameraMode = 'observe';
    state.filter.showHud = false;
    expect(input.applyStarClick(3)).toBe(false);
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
    expect(deps.focusStar).toHaveBeenCalledWith(5);
    expect(emitted).toEqual([]);
  });

  it('orbits a clicked cloud from no focus (pre-ladder cloud semantics)', () => {
    const { input, state, deps } = makeHarness();
    state.pickCloudResult = 2;
    (input as unknown as WithPrivates).dispatchSingleClick(10, 20);
    expect(deps.setOrbitTargetCloud).toHaveBeenCalledWith(2);
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
});
