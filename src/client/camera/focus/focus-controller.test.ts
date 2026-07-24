// FocusController tests — focus FSM, focus-park lerp, pin-engage
// geometry, FocusTarget round-trip, observe-cleanup / unfocus-close-zoom
// branches.

import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import {
  FocusController,
  type FocusControllerDeps,
  type FrameAnchor,
  GLOBAL_MIN_DIST_PC,
  PIN_ENGAGE_THRESHOLD_SQ_PC,
} from './focus-controller';
import { makeAimStub, makeControlsStub, makeObserveControlsStub } from '../camera-test-stubs';
import type { ObserveTransition } from '../observe/observe-transition';
import type { WarpController } from '../warp/warp-controller';
import type { FocusableProvider, FocusableProviders } from './focus-target';
import { ShellRegistry, type ShellInstance } from '../../fresnel-shell/shell-registry';
import { PlanetBodyField } from '../../solar-system/planet-body-field';
import type { PlanetSystem } from '../../solar-system/planet-system';
import { AU_PC, KM_PC, R_SUN_PC } from '../../util/astronomy-constants';
import {
  fovMinorRad,
  minOrbitDistForPlanet,
  parkDistForPlanet,
} from '../controls/star-physics';
import type { Catalog } from '../../loaders/catalog-loader';
import { makeEmptyCatalog } from '../../loaders/catalog-mock';
import type { CameraMode, StellataEventMap } from '../../stellata';
import { EventBus } from '../../util/event-bus';
import { FOCUS_LERP_MS } from '../timing';

interface WarpStub {
  isActive: ReturnType<typeof vi.fn>;
  isRecenteredToDest: ReturnType<typeof vi.fn>;
}
function makeWarpStub(): WarpController & WarpStub {
  return {
    isActive: vi.fn(() => false),
    isRecenteredToDest: vi.fn(() => false),
  } as unknown as WarpController & WarpStub;
}

interface ObserveStub {
  isActive: ReturnType<typeof vi.fn>;
  isAnyActive: ReturnType<typeof vi.fn>;
  cancelTransition: ReturnType<typeof vi.fn>;
  cancelUnfocusLerp: ReturnType<typeof vi.fn>;
  startExit: ReturnType<typeof vi.fn>;
  startUnfocusLerp: ReturnType<typeof vi.fn>;
}
function makeObserveStub(): ObserveTransition & ObserveStub {
  return {
    isActive: vi.fn(() => false),
    isAnyActive: vi.fn(() => false),
    cancelTransition: vi.fn(),
    cancelUnfocusLerp: vi.fn(),
    startExit: vi.fn(),
    startUnfocusLerp: vi.fn(),
  } as unknown as ObserveTransition & ObserveStub;
}

// Seeds N stars at evenly spaced positions along +X with a uniform
// physical radius so parkDistForStar / minOrbitDistForStar are
// deterministic. solIndex defaults to 0 so the initial `setFocus(0)`
// round-trip mirrors the production cold-start.
function makeCatalog(opts: {
  count?: number;
  positions?: number[];
  physicalRadius?: number;
  absmag?: number[];
  solIndex?: number;
} = {}): Catalog {
  const count = opts.count ?? 4;
  const cat = makeEmptyCatalog(count);
  if (opts.positions) {
    for (let i = 0; i < opts.positions.length; i++) cat.positions[i] = opts.positions[i];
  } else {
    const xs = [0, 10, 50, 100];
    for (let i = 0; i < count; i++) cat.positions[i * 3] = xs[i] ?? i * 10;
  }
  cat.physicalRadius.fill(opts.physicalRadius ?? 1.0);
  if (opts.absmag) {
    for (let i = 0; i < opts.absmag.length; i++) cat.absmag[i] = opts.absmag[i];
  }
  cat.solIndex = opts.solIndex ?? 0;
  return cat;
}

// FrameAnchor stub — mirrors the production behaviour: shifts a
// per-instance worldOffset, lets star-local positions roll through
// (catalog.positions - worldOffset).
interface FrameStub {
  anchor: FrameAnchor;
  worldOffset: THREE.Vector3;
  catalog: Catalog;
  recenterCalls: THREE.Vector3[];
}
function makeFrameAnchor(
  catalog: Catalog,
  pert: { fn: (idx: number, out: THREE.Vector3) => boolean },
): FrameStub {
  const worldOffset = new THREE.Vector3();
  const recenterCalls: THREE.Vector3[] = [];
  const scratch = new THREE.Vector3();
  // Mirror production: the star buffer holds baseline + orbital
  // perturbation (the walk wrote it). Reads add the pert hook's output so
  // starLocalPositionInto returns the LIVE local position.
  const liveInto = (idx: number, out: THREE.Vector3): THREE.Vector3 => {
    const p = catalog.positions;
    out.set(
      p[idx * 3] - worldOffset.x,
      p[idx * 3 + 1] - worldOffset.y,
      p[idx * 3 + 2] - worldOffset.z,
    );
    if (pert.fn(idx, scratch)) out.add(scratch);
    return out;
  };
  const anchor: FrameAnchor = {
    recenterOrigin: (newOrigin) => {
      const dx = newOrigin.x - worldOffset.x;
      const dy = newOrigin.y - worldOffset.y;
      const dz = newOrigin.z - worldOffset.z;
      if (dx === 0 && dy === 0 && dz === 0) return null;
      worldOffset.copy(newOrigin);
      recenterCalls.push(new THREE.Vector3(dx, dy, dz));
      return new THREE.Vector3(dx, dy, dz);
    },
    getWorldOffset: () => worldOffset,
    starLocalPosition: (idx) => liveInto(idx, new THREE.Vector3()),
    starLocalPositionInto: (idx, out) => liveInto(idx, out),
  };
  return { anchor, worldOffset, catalog, recenterCalls };
}

interface Harness {
  focus: FocusController;
  camera: THREE.PerspectiveCamera;
  controls: ReturnType<typeof makeControlsStub>;
  observeControls: ReturnType<typeof makeObserveControlsStub>;
  aim: ReturnType<typeof makeAimStub>;
  warp: WarpController & WarpStub;
  observe: ObserveTransition & ObserveStub;
  catalog: Catalog;
  frame: FrameStub;
  uHide: { value: number };
  bus: EventBus<StellataEventMap>;
  busEvents: Array<{ name: string; payload: unknown }>;
  setCameraMode: (m: CameraMode) => void;
  getCameraMode: () => CameraMode;
  pert: { fn: (idx: number, out: THREE.Vector3) => boolean };
  planetField: PlanetBodyField;
  shells: ShellRegistry;
}

function makeHarness(opts: {
  mode?: CameraMode;
  catalog?: Catalog;
} = {}): Harness {
  const catalog = opts.catalog ?? makeCatalog();
  const camera = new THREE.PerspectiveCamera(60, 1, 1e-10, 100_000);
  const controls = makeControlsStub();
  const observeControls = makeObserveControlsStub();
  const aim = makeAimStub();
  const warp = makeWarpStub();
  const observe = makeObserveStub();
  // Focal perturbation hook — default no-op (no binaries). Tests that
  // exercise the ride / live-target snap override pert.fn. Shared with the
  // frame anchor so the simulated star buffer carries the perturbation.
  const pert: { fn: (idx: number, out: THREE.Vector3) => boolean } = {
    fn: () => false,
  };
  const frame = makeFrameAnchor(catalog, pert);
  const uHide = { value: -1 };
  const bus = new EventBus<StellataEventMap>();

  const busEvents: Array<{ name: string; payload: unknown }> = [];
  for (const name of ['focus', 'planetSystem', 'focusLerp', 'state', 'cameraMode', 'vector'] as const) {
    bus.on(name, (payload: unknown) => {
      busEvents.push({ name, payload });
    });
  }

  // Stub geometry registry: the star leg mirrors the frame anchor; the
  // soft kinds report a fixed position so setOrbitTarget / flyTo have
  // something to aim at without a real layer.
  const softProvider: FocusableProvider = {
    localPositionInto: (_idx, out) => { out.set(1, 2, 3); return true; },
    focusParkDistance: () => 1,
    arrivalRadiusPc: () => null,
    renderedSizePx: () => 10,
  };
  const focusables: FocusableProviders = {
    star: {
      localPositionInto: (idx, out) => {
        frame.anchor.starLocalPositionInto(idx, out);
        return true;
      },
      focusParkDistance: (idx) => focus.parkDistForStar(idx),
      arrivalRadiusPc: () => null,
      renderedSizePx: () => 10,
    },
    cloud: softProvider,
    lg: softProvider,
    planet: softProvider,
    shell: softProvider,
  };

  // Body field stub with no attached hosts — planet-kind paths no-op
  // (planetAt returns null). Tests exercising planet focus construct a
  // real PlanetBodyField instead.
  const planetField = new PlanetBodyField({
    uMonochrome: { value: 0 },
    uChartDiscMaxPx: { value: 28 },
    uChartDiscMinPx: { value: 1.5 },
    uChartMagBright: { value: -2 },
    uMaxAppMag: { value: 6.5 },
    uSizeMin: { value: 2 },
    uSizeMax: { value: 24 },
    uSizeSpan: { value: 8 },
    uSizeKnee: { value: 16 },
    uVisibleThreshold: { value: 0.2 },
    uVisibleK: { value: -Math.log(0.2) },
    uCoreThreshold: { value: 0.4 },
    uDiscardThreshold: { value: 0.02 },
    uDistNMin: { value: 2.2 },
    uDistNMax: { value: 10.0 },
    uLumBiasMin: { value: 1.0 },
    uLumBiasMax: { value: 0.6 },
    uViewport: { value: new THREE.Vector2(800, 600) },
    uPixelRatio: { value: 1 },
    uFovYRad: { value: (60 * Math.PI) / 180 },
  });

  // Production recenterOrigin fans out to every scene layer's recenter
  // hook (the body field included); mirror that so a planet-focus
  // recentre updates hostLocalPos before the target snap reads it.
  const innerRecenter = frame.anchor.recenterOrigin;
  frame.anchor.recenterOrigin = (newOrigin) => {
    planetField.recenter(newOrigin);
    return innerRecenter(newOrigin);
  };

  const shells = new ShellRegistry();

  const deps: FocusControllerDeps = {
    camera,
    controls,
    observeControls,
    catalog,
    bus,
    frameAnchor: frame.anchor,
    aim,
    setFocalBodyHidden: (target) => {
      uHide.value = target?.kind === 'star' ? target.idx : -1;
    },
    getClouds: () => null,
    getLocalGroup: () => null,
    getShells: () => shells,
    getPlanetField: () => planetField,
    getWarp: () => warp,
    getObserve: () => observe,
    getFocusables: () => focusables,
    focalPerturbationInto: (idx, out) => pert.fn(idx, out),
  };

  const focus = new FocusController(deps);
  if (opts.mode) focus.setCameraModeValue(opts.mode);

  return {
    focus,
    camera,
    controls,
    observeControls,
    aim,
    warp,
    observe,
    catalog,
    frame,
    uHide,
    bus,
    busEvents,
    setCameraMode: (m) => focus.setCameraModeValue(m),
    getCameraMode: () => focus.getCameraMode(),
    pert,
    planetField,
    shells,
  };
}

describe('FocusController — initial state', () => {
  it('starts unfocused with no focus-lerp', () => {
    const h = makeHarness();
    expect(h.focus.getFocusedStar()).toBeNull();
    expect(h.focus.getFocusedTarget()).toBeNull();
    expect(h.focus.getFocusedPlanetSystem()).toBeNull();
    expect(h.focus.isFocusLerpActive()).toBe(false);
  });

  it('isCameraBusy is false when nothing is active', () => {
    const h = makeHarness();
    expect(h.focus.isCameraBusy()).toBe(false);
  });
});

describe('FocusController.setFocus — star focus FSM', () => {
  it('focusing a star at the origin recentres worldOffset, emits focus + state', () => {
    const h = makeHarness();
    h.focus.setFocus(1);
    expect(h.focus.getFocusedStar()).toBe(1);
    // Star 1 was at (10,0,0) — worldOffset shifted to that position.
    expect(h.frame.worldOffset.x).toBeCloseTo(10, 6);
    // controls.target snapped to local (0,0,0).
    expect(h.controls.target.x).toBeCloseTo(0, 6);
    // Emitted events end with 'focus' + 'state'.
    expect(h.busEvents.map((e) => e.name)).toEqual(['focus', 'state']);
    expect(h.busEvents[0].payload).toEqual({ kind: 'star', idx: 1 });
  });

  it('setFocus(null) does NOT recentre worldOffset)', () => {
    const h = makeHarness();
    h.focus.setFocus(1);
    h.busEvents.length = 0;
    h.frame.recenterCalls.length = 0;
    h.focus.setFocus(null);
    expect(h.focus.getFocusedStar()).toBeNull();
    // worldOffset stays at the former focal star (10, 0, 0).
    expect(h.frame.worldOffset.x).toBeCloseTo(10, 6);
    expect(h.frame.recenterCalls).toEqual([]);
    expect(h.busEvents.map((e) => e.name)).toEqual(['focus', 'state']);
    expect(h.busEvents[0].payload).toBeNull();
  });

  it('re-focusing the same star is a no-op (no events, no recentre)', () => {
    const h = makeHarness();
    h.focus.setFocus(1);
    h.busEvents.length = 0;
    h.frame.recenterCalls.length = 0;
    h.focus.setFocus(1);
    expect(h.busEvents).toEqual([]);
    expect(h.frame.recenterCalls).toEqual([]);
  });

  it('focusing a star clears any prior cloud focus + emits cloudFocus(null) before focus(idx)', () => {
    const h = makeHarness();
    h.focus.setFocus(1);
    // Force a cloud focus through the dedicated setter; uses a custom
    // fixture since clouds layer isn't wired here.
    // Direct invocation of setFocusedCloud(null) wouldn't help — we
    // need a non-null cloud value, so re-enter through the FocusTarget
    // round-trip below in a dedicated test.
    // For this test just verify the cloud-clear branch doesn't fire on
    // a star → star transition.
    h.busEvents.length = 0;
    h.focus.setFocus(2);
    const names = h.busEvents.map((e) => e.name);
    expect(names).toEqual(['focus', 'state']);
  });

  it('observe-cleanup branch fires when setFocus runs in observe mode', () => {
    const h = makeHarness({ mode: 'navigate' });
    h.focus.setFocus(1);
    // Flip to observe mode manually (mirrors what ObserveTransition.setMode
    // would do via setCameraModeValue) then change focus.
    h.setCameraMode('observe');
    h.uHide.value = 1; // simulate observe-mode invariant
    h.busEvents.length = 0;
    h.observe.cancelTransition.mockClear();
    h.aim.cancel.mockClear();
    h.observeControls.disable.mockClear();

    h.focus.setFocus(2);
    expect(h.observe.cancelTransition).toHaveBeenCalledTimes(1);
    expect(h.aim.cancel).toHaveBeenCalledTimes(1);
    expect(h.observeControls.disable).toHaveBeenCalledTimes(1);
    expect(h.getCameraMode()).toBe('navigate');
    expect(h.uHide.value).toBe(-1);
    expect(h.controls.enabled).toBe(true);
    // Order: cameraMode → focus → state. The observe-cleanup branch
    // emits cameraMode BEFORE the focus mutation runs.
    expect(h.busEvents.map((e) => e.name)).toEqual(['cameraMode', 'focus', 'state']);
  });

  it('setFocus(null) clamps controls.minDistance to ≤ current eye distance', () => {
    const h = makeHarness();
    h.focus.setFocus(1);
    // Move camera close to the focal star (eye = 1e-4 pc < GLOBAL_MIN_DIST_PC).
    h.camera.position.set(1e-4, 0, 0);
    h.controls.target.set(0, 0, 0);
    h.focus.setFocus(null);
    expect(h.controls.minDistance).toBeLessThanOrEqual(1e-4);
    expect(h.controls.minDistance).toBeLessThan(GLOBAL_MIN_DIST_PC);
  });
});

describe('FocusController.focusStar — focus-park lerp', () => {
  it('near focus (eye ≤ parkDist): no lerp starts', () => {
    const h = makeHarness();
    h.focus.setFocus(0); // worldOffset = origin
    h.camera.position.set(1e-7, 0, 0); // very close
    h.busEvents.length = 0;
    h.focus.focusStar(0);
    expect(h.focus.isFocusLerpActive()).toBe(false);
  });

  it('far focus (eye > parkDist): starts a focus-park lerp and emits focusLerp(true)', () => {
    const h = makeHarness();
    h.camera.position.set(0, 0, 1000); // far away
    h.busEvents.length = 0;
    h.focus.focusStar(2); // star at (50,0,0)
    expect(h.focus.isFocusLerpActive()).toBe(true);
    const lerpEvents = h.busEvents.filter((e) => e.name === 'focusLerp');
    expect(lerpEvents).toHaveLength(1);
    expect(lerpEvents[0].payload).toBe(true);
  });

  it('cancelFocusLerp mid-lerp clears the slot and emits focusLerp(false)', () => {
    const h = makeHarness();
    h.camera.position.set(0, 0, 1000);
    h.focus.focusStar(2);
    expect(h.focus.isFocusLerpActive()).toBe(true);
    h.busEvents.length = 0;
    h.focus.cancelFocusLerp();
    expect(h.focus.isFocusLerpActive()).toBe(false);
    expect(h.busEvents).toEqual([{ name: 'focusLerp', payload: false }]);
  });

  it('focusStar bails when warp is active', () => {
    const h = makeHarness();
    h.warp.isActive.mockReturnValue(true);
    h.focus.focusStar(2);
    expect(h.focus.getFocusedStar()).toBeNull();
    expect(h.focus.isFocusLerpActive()).toBe(false);
  });

  it('focusStar with animate:false snaps the camera to parkDist instead of starting a lerp', () => {
    const h = makeHarness();
    h.camera.position.set(0, 0, 1000);
    h.focus.focusStar(2, { animate: false });
    expect(h.focus.isFocusLerpActive()).toBe(false);
    // Eye distance is now parkDist (or whatever the helper computed).
    const eye = h.camera.position.length();
    expect(eye).toBeGreaterThan(0);
    expect(eye).toBeLessThan(1); // not 1000 anymore
  });

  it('tick lands the focus-park lerp and emits focusLerp(false) at end', () => {
    const h = makeHarness();
    const startMs = 1000;
    vi.spyOn(performance, 'now').mockReturnValue(startMs);
    h.camera.position.set(0, 0, 1000);
    h.focus.focusStar(2);
    h.busEvents.length = 0;

    // Tick past the lerp duration to land it.
    h.focus.tick(startMs + FOCUS_LERP_MS + 100);

    expect(h.focus.isFocusLerpActive()).toBe(false);
    expect(h.busEvents).toEqual([{ name: 'focusLerp', payload: false }]);
    expect(h.controls.update).toHaveBeenCalled();
  });
});

describe('FocusController.isPinEngaged', () => {
  it('engages when focused, navigate, target ≈ origin, no other animation', () => {
    const h = makeHarness();
    h.focus.setFocus(1);
    h.controls.target.set(0, 0, 0);
    expect(h.focus.isPinEngaged()).toBe(true);
  });

  it('disengages when no star is focused', () => {
    const h = makeHarness();
    expect(h.focus.isPinEngaged()).toBe(false);
  });

  it('disengages when target is past the threshold', () => {
    const h = makeHarness();
    h.focus.setFocus(1);
    h.controls.target.set(1e-3, 0, 0); // 1e-6 pc² > 1e-12 threshold
    expect(h.focus.isPinEngaged()).toBe(false);
  });

  it('disengages during warp until recenteredToDest', () => {
    const h = makeHarness();
    h.focus.setFocus(1);
    h.controls.target.set(0, 0, 0);
    h.warp.isActive.mockReturnValue(true);
    expect(h.focus.isPinEngaged()).toBe(false);
    h.warp.isRecenteredToDest.mockReturnValue(true);
    expect(h.focus.isPinEngaged()).toBe(true);
  });

  it('disengages during aim slerp', () => {
    const h = makeHarness();
    h.focus.setFocus(1);
    h.controls.target.set(0, 0, 0);
    h.aim.isActive.mockReturnValue(true);
    expect(h.focus.isPinEngaged()).toBe(false);
  });

  it('getPinEngageThresholdSq returns the constant', () => {
    const h = makeHarness();
    expect(h.focus.getPinEngageThresholdSq()).toBe(PIN_ENGAGE_THRESHOLD_SQ_PC);
  });
});

describe('FocusController — live focal position (binary members)', () => {
  it('setFocus snaps controls.target onto baseline + perturbation, preserving the pose', () => {
    const h = makeHarness();
    const P = new THREE.Vector3(1e-4, 2e-4, -3e-5);
    h.pert.fn = (idx, out) => {
      if (idx === 1) { out.copy(P); return true; }
      return false;
    };
    // Seed the pre-focus pose (focusStar's contract seeds target too).
    h.camera.position.set(10, 0, 0.5);
    h.controls.target.copy(h.frame.anchor.starLocalPosition(1));
    const eyeBefore = h.camera.position.clone().sub(h.controls.target);

    h.focus.setFocus(1);

    // Target lands on the live local position (baseline 0 after recenter + P).
    expect(h.controls.target.x).toBeCloseTo(P.x, 9);
    expect(h.controls.target.y).toBeCloseTo(P.y, 9);
    expect(h.controls.target.z).toBeCloseTo(P.z, 9);
    // Camera-to-target vector preserved — the snap doesn't move the view.
    const eyeAfter = h.camera.position.clone().sub(h.controls.target);
    expect(eyeAfter.distanceTo(eyeBefore)).toBeLessThan(1e-9);
  });

  it('isPinEngaged engages at a non-origin target that rides the perturbation', () => {
    const h = makeHarness();
    // Perturbation well above the pin threshold (5e-5 pc ≫ 1e-6 pc): the
    // old target.lengthSq() check would read this as disengaged.
    const P = new THREE.Vector3(5e-5, 0, 0);
    h.pert.fn = (idx, out) => {
      if (idx === 1) { out.copy(P); return true; }
      return false;
    };
    h.focus.setFocus(1);
    expect(h.controls.target.x).toBeCloseTo(P.x, 9);
    expect(h.focus.isPinEngaged()).toBe(true);
    // Pan the target off the star past the engage threshold → disengage.
    h.controls.target.x += 1e-3;
    expect(h.focus.isPinEngaged()).toBe(false);
  });

  it('translateFocusFrame rides an in-flight focus-park lerp landing; idle is a no-op', () => {
    const delta = new THREE.Vector3(0.01, -0.02, 0.03);
    const land = (shift: boolean): THREE.Vector3 => {
      const h = makeHarness();
      h.camera.position.set(0, 0, 5);
      h.focus.focusStar(1); // far → focus-park lerp starts
      expect(h.focus.isFocusLerpActive()).toBe(true);
      if (shift) h.focus.translateFocusFrame(delta);
      h.focus.tick(performance.now() + FOCUS_LERP_MS + 1);
      return h.camera.position.clone();
    };
    // Idle no-op: doesn't throw with no lerp running.
    makeHarness().focus.translateFocusFrame(delta);
    // Landing shifts by exactly delta when the frame is translated mid-lerp.
    const noShift = land(false);
    const shifted = land(true);
    expect(shifted.clone().sub(noShift).distanceTo(delta)).toBeLessThan(1e-9);
  });
});

describe('FocusController.unfocus — close-zoom branch', () => {
  it('navigate inside parkDist: starts an unfocus lerp via ObserveTransition', () => {
    const h = makeHarness();
    h.focus.setFocus(1); // worldOffset = (10,0,0); local origin = star
    // Camera VERY close to the focal star (inside parkDist).
    h.camera.position.set(1e-7, 0, 0);
    h.controls.target.set(0, 0, 0);

    h.focus.unfocus();

    expect(h.observe.startUnfocusLerp).toHaveBeenCalledTimes(1);
    expect(h.focus.getFocusedStar()).toBeNull();
  });

  it('navigate beyond parkDist: hard clear, no unfocus lerp', () => {
    const h = makeHarness();
    h.focus.setFocus(1);
    h.camera.position.set(0, 0, 100); // way outside parkDist
    h.controls.target.set(0, 0, 0);
    h.focus.unfocus();
    expect(h.observe.startUnfocusLerp).not.toHaveBeenCalled();
    expect(h.focus.getFocusedStar()).toBeNull();
  });

  it('observe mode: starts an observe-exit then sets focus to null', () => {
    const h = makeHarness({ mode: 'navigate' });
    h.focus.setFocus(1);
    h.setCameraMode('observe'); // mimic post-enter state
    h.busEvents.length = 0;
    h.focus.unfocus();
    expect(h.observe.startExit).toHaveBeenCalledWith({ animate: true, clearFocusOnExit: false });
    expect(h.focus.getFocusedStar()).toBeNull();
  });

  it('unfocus is a no-op when warp is active', () => {
    const h = makeHarness();
    h.focus.setFocus(1);
    h.warp.isActive.mockReturnValue(true);
    h.focus.unfocus();
    expect(h.focus.getFocusedStar()).toBe(1);
  });

  it('unfocus is a no-op when nothing is focused', () => {
    const h = makeHarness();
    h.busEvents.length = 0;
    h.focus.unfocus();
    expect(h.busEvents).toEqual([]);
  });
});

describe('FocusController.makeFocusTarget — star round-trip', () => {
  it('applyFocus mutates focus state, emitFocusEvents fires the bus', () => {
    const h = makeHarness();
    const target = h.focus.makeFocusTarget({ kind: 'star', idx: 2 })!;
    expect(target.kind).toBe('star');
    expect(target.idx).toBe(2);

    target.applyFocus();
    expect(h.focus.getFocusedStar()).toBe(2);

    h.busEvents.length = 0;
    target.emitFocusEvents();
    expect(h.busEvents.map((e) => e.name)).toEqual(['focus', 'state']);
    expect(h.busEvents[0].payload).toEqual({ kind: 'star', idx: 2 });
  });

  it('applyFocus on a star displaces a prior cloud focus; one focus emit carries the transition', () => {
    const h = makeHarness();
    // Seed a cloud focus through the public soft-focus path (the stub
    // provider stands in for the shelved layer).
    h.focus.setOrbitTarget({ kind: 'cloud', idx: 42 });
    expect(h.focus.getFocusedTarget()).toEqual({ kind: 'cloud', idx: 42 });

    const target = h.focus.makeFocusTarget({ kind: 'star', idx: 1 })!;
    target.applyFocus();
    expect(h.focus.getFocusedStar()).toBe(1);
    expect(h.focus.getFocusedTarget()).toEqual({ kind: 'star', idx: 1 });

    h.busEvents.length = 0;
    target.emitFocusEvents();
    expect(h.busEvents.map((e) => e.name)).toEqual(['focus', 'state']);
    expect(h.busEvents[0].payload).toEqual({ kind: 'star', idx: 1 });
  });

  it('parkRadius matches starPhysics.parkDistForStar', () => {
    const h = makeHarness();
    const target = h.focus.makeFocusTarget({ kind: 'star', idx: 2 })!;
    const direct = h.focus.parkDistForStar(2);
    expect(target.parkRadius()).toBe(direct);
  });

  it('anchorInto writes absolute catalog position', () => {
    const h = makeHarness();
    const target = h.focus.makeFocusTarget({ kind: 'star', idx: 2 })!;
    const out = new THREE.Vector3();
    target.anchorInto(out);
    expect(out.x).toBe(50);
    expect(out.y).toBe(0);
    expect(out.z).toBe(0);
  });

  it('physicalRadius applies the MIN_PHYSICAL_RADIUS_R_SUN floor', () => {
    const tinyCat = makeCatalog({ physicalRadius: 0 });
    const h = makeHarness({ catalog: tinyCat });
    const target = h.focus.makeFocusTarget({ kind: 'star', idx: 1 })!;
    const r = target.physicalRadius();
    expect(r).not.toBeNull();
    expect(r!).toBeGreaterThan(0);
  });
});

describe('FocusController — frame anchor delegation', () => {
  it('starLocalPosition reflects current worldOffset', () => {
    const h = makeHarness();
    h.focus.setFocus(1); // worldOffset = (10,0,0)
    const local0 = h.focus.starLocalPosition(0); // star 0 is at (0,0,0) abs
    expect(local0.x).toBeCloseTo(-10, 6);
    const local1 = h.focus.starLocalPosition(1);
    expect(local1.x).toBeCloseTo(0, 6);
  });

  it('recenterOrigin delegates to the FrameAnchor', () => {
    const h = makeHarness();
    h.focus.recenterOrigin(new THREE.Vector3(5, 0, 0));
    expect(h.frame.worldOffset.x).toBe(5);
  });
});

describe('FocusController — vector slot', () => {
  it('setVectorTo stores the destination and emits vector + state', () => {
    const h = makeHarness();
    h.focus.setVectorTo(3);
    expect(h.focus.getVectorTo()).toBe(3);
    expect(h.busEvents).toEqual([
      { name: 'vector', payload: { kind: 'star', idx: 3 } },
      { name: 'state', payload: undefined },
    ]);
  });

  it('setting a cloud vector displaces a star vector in one emit', () => {
    const h = makeHarness();
    h.focus.setVectorTo(3);
    h.busEvents.length = 0;
    h.focus.setVector({ kind: 'cloud', idx: 5 });
    expect(h.focus.getVectorTo()).toBeNull();
    expect(h.focus.getVectorTarget()).toEqual({ kind: 'cloud', idx: 5 });
    expect(h.busEvents.map((e) => e.name)).toEqual(['vector', 'state']);
    expect(h.busEvents[0].payload).toEqual({ kind: 'cloud', idx: 5 });
  });

  it('setVectorTo(null) leaves an other-kind destination untouched', () => {
    const h = makeHarness();
    h.focus.setVector({ kind: 'lg', idx: 9 });
    h.busEvents.length = 0;
    h.focus.setVectorTo(null);
    expect(h.focus.getVectorTarget()).toEqual({ kind: 'lg', idx: 9 });
    expect(h.busEvents).toEqual([]);
  });

  it('setVector(null) clears whichever kind is set', () => {
    const h = makeHarness();
    h.focus.setVector({ kind: 'lg', idx: 9 });
    h.busEvents.length = 0;
    h.focus.setVector(null);
    expect(h.focus.getVectorTarget()).toBeNull();
    expect(h.busEvents.map((e) => e.name)).toEqual(['vector', 'state']);
    expect(h.busEvents[0].payload).toBeNull();
  });

  it('same-value writes are silent no-ops', () => {
    const h = makeHarness();
    h.focus.setVectorTo(3);
    h.busEvents.length = 0;
    h.focus.setVectorTo(3);
    expect(h.busEvents).toEqual([]);
  });

  it('non-null vector writes are dropped in observe mode', () => {
    const h = makeHarness({ mode: 'observe' });
    h.focus.setVectorTo(3);
    expect(h.focus.getVectorTo()).toBeNull();
  });

  it('focusStar clears an in-flight star vector', () => {
    const h = makeHarness();
    h.focus.setVectorTo(2);
    h.focus.focusStar(2);
    expect(h.focus.getVectorTo()).toBeNull();
  });

  it('unfocus with nothing focused wipes a drawn vector (vector-only path)', () => {
    const h = makeHarness();
    h.focus.setVector({ kind: 'cloud', idx: 4 });
    h.busEvents.length = 0;
    h.focus.unfocus();
    expect(h.focus.getVectorTarget()).toBeNull();
    expect(h.busEvents.map((e) => e.name)).toEqual(['vector', 'state']);
  });
});

describe('FocusController — cameraMode ownership', () => {
  it('defaults to navigate; setCameraModeValue writes without emitting', () => {
    const h = makeHarness();
    expect(h.focus.getCameraMode()).toBe('navigate');
    h.busEvents.length = 0;
    h.focus.setCameraModeValue('observe');
    expect(h.focus.getCameraMode()).toBe('observe');
    expect(h.busEvents).toEqual([]);
  });
});

describe('FocusController.dispose', () => {
  it('clears focus state', () => {
    const h = makeHarness();
    h.focus.setFocus(1);
    h.focus.dispose();
    expect(h.focus.getFocusedStar()).toBeNull();
    expect(h.focus.getFocusedTarget()).toBeNull();
    expect(h.focus.isFocusLerpActive()).toBe(false);
  });
});

describe('FocusController — three-way focus exclusivity (single Target slot)', () => {
  it('lg focus clears a star focus: star unfocus settles, then the lg emit', () => {
    const h = makeHarness();
    h.focus.setFocus(3);
    h.busEvents.length = 0;
    h.focus.setOrbitTarget({ kind: 'lg', idx: 7 });
    expect(h.focus.getFocusedStar()).toBeNull();
    expect(h.focus.getFocusedTarget()).toEqual({ kind: 'lg', idx: 7 });
    expect(h.busEvents.map((e) => e.name)).toEqual(['focus', 'state', 'focus', 'state']);
    expect(h.busEvents[0].payload).toBeNull();
    expect(h.busEvents[2].payload).toEqual({ kind: 'lg', idx: 7 });
  });

  it('lg focus displaces a cloud focus in one emit', () => {
    const h = makeHarness();
    h.focus.setOrbitTarget({ kind: 'cloud', idx: 2 });
    h.busEvents.length = 0;
    h.focus.setOrbitTarget({ kind: 'lg', idx: 7 });
    expect(h.focus.getFocusedTarget()).toEqual({ kind: 'lg', idx: 7 });
    expect(h.busEvents.map((e) => e.name)).toEqual(['focus', 'state']);
    expect(h.busEvents[0].payload).toEqual({ kind: 'lg', idx: 7 });
  });

  it('star focus displaces an lg focus in one emit', () => {
    const h = makeHarness();
    h.focus.setOrbitTarget({ kind: 'lg', idx: 7 });
    h.busEvents.length = 0;
    h.focus.setFocus(3);
    expect(h.focus.getFocusedStar()).toBe(3);
    expect(h.busEvents.map((e) => e.name)).toEqual(['focus', 'state']);
    expect(h.busEvents[0].payload).toEqual({ kind: 'star', idx: 3 });
  });

  it('cloud focus displaces an lg focus', () => {
    const h = makeHarness();
    h.focus.setOrbitTarget({ kind: 'lg', idx: 7 });
    h.busEvents.length = 0;
    h.focus.setOrbitTarget({ kind: 'cloud', idx: 2 });
    expect(h.focus.getFocusedTarget()).toEqual({ kind: 'cloud', idx: 2 });
    expect(h.busEvents.map((e) => e.name)).toEqual(['focus', 'state']);
  });
});

// Attach a single-planet host to the harness body field: planet planted
// at +1 AU on the local x axis with the orientation forced to identity
// (renderer-local == plane-frame, so expectations stay hand-checkable).
// Returns the planet's flat instance index.
function attachTestPlanet(h: Harness, hostIdx = 0, radiusKm = 6000): number {
  const ps: PlanetSystem = {
    hostStarIdx: hostIdx,
    planets: [{
      name: 'TestPlanet',
      radiusKm,
      semiMajorAxisAu: 1,
      eccentricity: 0,
      type: 'rocky',
      colour: [1, 1, 1],
      albedo: 0.5,
    }],
    positionsAt: (_t, out) => { out[0] = AU_PC; out[1] = 0; out[2] = 0; },
  };
  const hostAbs = new THREE.Vector3(
    h.catalog.positions[hostIdx * 3],
    h.catalog.positions[hostIdx * 3 + 1],
    h.catalog.positions[hostIdx * 3 + 2],
  );
  h.planetField.attachHost(hostIdx, ps, 4.83, R_SUN_PC, hostAbs, h.catalog.solIndex, 0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hosts = (h.planetField as any).hosts as Map<number, { orientation: THREE.Quaternion }>;
  hosts.get(hostIdx)!.orientation.identity();
  h.planetField.update(new THREE.PerspectiveCamera(), 0, 0);
  return h.planetField.instanceIndexOf(hostIdx, 0)!;
}

describe('FocusController — planet focus (kind "planet")', () => {
  const RADIUS_PC = 6000 * KM_PC;

  it('flyTo({kind:planet}) recentres onto the planet, drops the orbit floor, parks', async () => {
    const h = makeHarness();
    const idx = attachTestPlanet(h);
    h.camera.position.set(0, 0, 30);
    h.busEvents.length = 0;
    h.focus.flyTo({ kind: 'planet', idx }, { animate: false });

    expect(h.focus.getFocusedTarget()).toEqual({ kind: 'planet', idx });
    expect(h.focus.getFocusedStar()).toBeNull();
    // worldOffset recentred onto the planet's absolute position (1 AU
    // from the host at the origin) — planet focus is a hard focus.
    expect(h.frame.worldOffset.x).toBeCloseTo(AU_PC, 10);
    // Target glued to the planet's local position (≈ local origin).
    expect(h.controls.target.length()).toBeLessThan(1e-9);
    // Orbit floor at the planet's 90 %-fill solve.
    const floor = minOrbitDistForPlanet(RADIUS_PC, fovMinorRad(h.camera));
    expect(h.controls.minDistance).toBeCloseTo(floor, 15);
    expect(h.controls.minDistance).toBeLessThan(RADIUS_PC * 3);
    // Snap path (animate: false): camera parked at parkDistForPlanet.
    const park = parkDistForPlanet(RADIUS_PC, fovMinorRad(h.camera));
    expect(h.camera.position.distanceTo(h.controls.target)).toBeCloseTo(park, 12);
    const focusEvents = h.busEvents.filter((e) => e.name === 'focus');
    expect(focusEvents[focusEvents.length - 1].payload).toEqual({ kind: 'planet', idx });
    // The HOST's planet system attaches (async resolve), keeping orbit
    // rings / labels alive exactly as the host's own focus would.
    await Promise.resolve();
    expect(h.focus.getFocusedPlanetSystem()?.hostStarIdx).toBe(0);
  });

  it('focusPlanet preserves the camera absolute pose at lerp start (no teleport)', () => {
    const h = makeHarness();
    const idx = attachTestPlanet(h);
    h.focus.setFocus(0);
    h.camera.position.set(0, 0, 30);
    const absBefore = h.camera.position.clone().add(h.frame.worldOffset);
    h.focus.flyTo({ kind: 'planet', idx });
    const absAfter = h.camera.position.clone().add(h.frame.worldOffset);
    // The camera must not move in absolute space when the focus lerp is
    // scheduled — an unseeded controls.target here teleports the camera
    // by the old-target→planet delta, visually swapping the planet into
    // the former focus's screen position.
    expect(absAfter.distanceTo(absBefore)).toBeLessThan(1e-12);
    expect(h.controls.target.length()).toBeLessThan(1e-9);
  });

  it('unfocus from a planet clamps the floor and detaches the planet system', async () => {
    const h = makeHarness();
    const idx = attachTestPlanet(h);
    h.focus.flyTo({ kind: 'planet', idx }, { animate: false });
    await Promise.resolve();
    h.busEvents.length = 0;
    const eye = h.camera.position.distanceTo(h.controls.target);
    h.focus.unfocus({ animate: false });
    expect(h.focus.getFocusedTarget()).toBeNull();
    // Clamp mirrors star unfocus: min(GLOBAL_MIN_DIST_PC, eye) so the
    // controls don't shove the camera outward from the parked pose.
    expect(h.controls.minDistance).toBeLessThanOrEqual(eye);
    expect(h.controls.minDistance).toBeLessThanOrEqual(GLOBAL_MIN_DIST_PC);
    expect(h.focus.getFocusedPlanetSystem()).toBeNull();
    const focusEvent = h.busEvents.find((e) => e.name === 'focus');
    expect(focusEvent).toBeDefined();
    expect(focusEvent!.payload).toBeNull();
  });

  it('setFocus(host star) from a planet focus swaps to the star focus', () => {
    const h = makeHarness();
    const idx = attachTestPlanet(h);
    h.focus.flyTo({ kind: 'planet', idx }, { animate: false });
    h.busEvents.length = 0;
    h.focus.setFocus(0);
    expect(h.focus.getFocusedStar()).toBe(0);
    expect(h.focus.getFocusedTarget()).toEqual({ kind: 'star', idx: 0 });
    // worldOffset back on the host (origin).
    expect(h.frame.worldOffset.x).toBeCloseTo(0, 8);
    expect(h.busEvents.map((e) => e.name)).toEqual(['focus', 'state']);
  });

  it('a soft-kind focus displaces a planet focus through the full detach path', async () => {
    const h = makeHarness();
    const idx = attachTestPlanet(h);
    h.focus.flyTo({ kind: 'planet', idx }, { animate: false });
    await Promise.resolve();
    h.focus.flyTo({ kind: 'cloud', idx: 0 }, { animate: false });
    expect(h.focus.getFocusedTarget()).toEqual({ kind: 'cloud', idx: 0 });
    expect(h.controls.minDistance).toBeLessThanOrEqual(GLOBAL_MIN_DIST_PC);
    expect(h.focus.getFocusedPlanetSystem()).toBeNull();
  });

  it('currentFocusTarget round-trips the planet kind geometry', () => {
    const h = makeHarness();
    const idx = attachTestPlanet(h);
    h.focus.flyTo({ kind: 'planet', idx }, { animate: false });
    const ft = h.focus.currentFocusTarget()!;
    expect(ft.kind).toBe('planet');
    expect(ft.idx).toBe(idx);
    expect(ft.physicalRadius()).toBeCloseTo(RADIUS_PC, 15);
    // No chart-mode disc for planets — arrival falls back to log-d.
    expect(ft.chartPlateauDistance(-2)).toBeNull();
    const abs = new THREE.Vector3();
    expect(ft.anchorInto(abs)).toBe(true);
    expect(abs.x).toBeCloseTo(AU_PC, 10);
    expect(ft.parkRadius()).toBeGreaterThan(
      minOrbitDistForPlanet(RADIUS_PC, fovMinorRad(h.camera)),
    );
  });

  it('a focused planet is an observe anchor: hard target, focal position, park dist', () => {
    const h = makeHarness();
    const idx = attachTestPlanet(h);
    h.focus.flyTo({ kind: 'planet', idx }, { animate: false });
    expect(h.focus.getFocusedHardTarget()).toEqual({ kind: 'planet', idx });
    const out = new THREE.Vector3(9, 9, 9);
    expect(h.focus.focalLocalPositionInto(out)).toBe(true);
    expect(out.length()).toBeLessThan(1e-9);
    expect(h.focus.hardFocusParkDist()).toBeCloseTo(
      parkDistForPlanet(RADIUS_PC, fovMinorRad(h.camera)), 15,
    );
  });

  it('soft kinds are not observe anchors', () => {
    const h = makeHarness();
    h.focus.flyTo({ kind: 'lg', idx: 0 }, { animate: false });
    expect(h.focus.getFocusedHardTarget()).toBeNull();
    expect(h.focus.hardFocusParkDist()).toBeNull();
  });

  it('unfocus from observe on a planet drives the same animated exit stars get', () => {
    const h = makeHarness();
    const idx = attachTestPlanet(h);
    h.focus.flyTo({ kind: 'planet', idx }, { animate: false });
    h.setCameraMode('observe');
    h.focus.unfocus();
    expect(h.observe.startExit).toHaveBeenCalledWith({ animate: true, clearFocusOnExit: false });
    expect(h.focus.getFocusedTarget()).toBeNull();
  });

  it('flyTo an unattached planet index is a no-op', () => {
    const h = makeHarness();
    h.busEvents.length = 0;
    h.focus.flyTo({ kind: 'planet', idx: 99 }, { animate: false });
    expect(h.focus.getFocusedTarget()).toBeNull();
    expect(h.busEvents).toEqual([]);
  });

  it('soft-kind flyTo flies OUT to park when the camera sits inside it', () => {
    // A camera inside a boundary shell (Sol inside the Local Bubble /
    // heliopause) must be pushed OUT to the framing distance, not left put
    // — otherwise the back-face-culled wall stays invisible. softProvider
    // centres at (1,2,3) and parks at 1 pc; start the camera 0.1 pc inside.
    const h = makeHarness();
    const dest = new THREE.Vector3(1, 2, 3);
    h.camera.position.copy(dest).add(new THREE.Vector3(0.1, 0, 0));
    h.focus.flyTo({ kind: 'cloud', idx: 0 }, { animate: false });
    expect(h.camera.position.distanceTo(dest)).toBeCloseTo(1, 6);
  });

  it('soft applyFocus tightens minDistance to an AU-scale park (warp-arrival snap-out regression)', () => {
    // Warp / mid-fly arrival parks a soft target via FocusTarget.applyFocus,
    // NOT flyTo. A ~200 AU heliopause parks at ~480 AU ≈ 2.3e-3 pc — inside
    // the 5e-3 pc GLOBAL_MIN_DIST_PC floor. If applyFocus doesn't tighten
    // minDistance, controls.update() at finishWarp snaps the camera straight
    // back out to the floor (~1031 AU).
    const h = makeHarness();
    const auShell: ShellInstance = {
      label: 'Heliopause',
      sid: 1,
      card: { typeLine: 't', size: 's', knownFrom: 'k' },
      centerAbsInto: (out) => { out.set(0, 0, 0); return true; },
      extentPc: () => 200 * AU_PC,
      pick: { labelElementId: 'x', visible: () => true, sampleCount: () => 0, sampleLocalInto: () => {} },
    };
    h.shells.register('heliopause', auShell); // SHELL_KEYS idx 1
    const park = h.shells.viewingDistancePc(1);
    expect(park).toBeLessThan(GLOBAL_MIN_DIST_PC);

    const ft = h.focus.makeFocusTarget({ kind: 'shell', idx: 1 })!;
    expect(ft).not.toBeNull();
    ft.applyFocus();
    expect(h.controls.minDistance).toBeCloseTo(park, 12);
  });
});
