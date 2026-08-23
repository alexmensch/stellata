import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { RenderGate } from './render-gate';
import { SETTLE_MS } from './render-gate-pure';

function makeEventTargetStub() {
  const handlers = new Map<string, Set<EventListener>>();
  return {
    registered(): string[] {
      return [...handlers].filter(([, fns]) => fns.size > 0).map(([name]) => name).sort();
    },
    fire(name: string): void {
      for (const fn of handlers.get(name) ?? []) fn(new Event(name));
    },
    addEventListener(name: string, fn: EventListener): void {
      const set = handlers.get(name) ?? new Set();
      set.add(fn);
      handlers.set(name, set);
    },
    removeEventListener(name: string, fn: EventListener): void {
      handlers.get(name)?.delete(fn);
    },
  };
}

function makeGate() {
  const gate = new RenderGate();
  const camera = new THREE.PerspectiveCamera(50, 4 / 3, 1e-12, 1e5);
  const target = new THREE.Vector3();
  const worldOffset = new THREE.Vector3();
  const tick = (nowMs: number, continuous = false, cadenceDue = false) =>
    gate.tick(camera, target, worldOffset, { continuous, cadenceDue, nowMs });
  /** Render the seed frame, then step past the settle tail — the gate is
   *  skipping when this returns, so a later `true` is a genuine wake. */
  const settle = (t0: number) => {
    tick(t0);
    return tick(t0 + SETTLE_MS);
  };
  return { gate, camera, target, tick, settle };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RenderGate holds', () => {
  it('renders while any hold is live, and stops when the last releases', () => {
    const { gate, tick, settle } = makeGate();
    expect(settle(0)).toBe(false);

    const a = gate.hold();
    const b = gate.hold();
    expect(tick(SETTLE_MS)).toBe(true);
    a();
    expect(tick(SETTLE_MS)).toBe(true);
    b();
    expect(tick(SETTLE_MS)).toBe(false);
  });

  it('a release is idempotent — it cannot drop a sibling hold', () => {
    const { gate, tick } = makeGate();
    const a = gate.hold();
    gate.hold();
    a();
    a();
    a();
    expect(tick(SETTLE_MS)).toBe(true);
  });

  it('a release outstanding across dispose cannot poison the next hold', () => {
    const { gate, tick, settle } = makeGate();
    const stale = gate.hold();
    gate.dispose();
    stale();

    expect(settle(0)).toBe(false);
    gate.hold();
    expect(tick(SETTLE_MS)).toBe(true);
  });
});

describe('RenderGate pose snapshot', () => {
  it('the NaN seed renders the first tick, and an unchanged pose then settles', () => {
    const { tick } = makeGate();
    expect(tick(0)).toBe(true);
    expect(tick(SETTLE_MS - 1)).toBe(true);
    expect(tick(SETTLE_MS)).toBe(false);
  });

  it('any camera mutation wakes it, whatever moved', () => {
    for (const mutate of [
      (c: THREE.PerspectiveCamera) => { c.position.x += 1e-9; },
      (c: THREE.PerspectiveCamera) => { c.quaternion.w -= 1e-9; },
      (c: THREE.PerspectiveCamera) => { c.fov += 1e-9; },
    ]) {
      const { camera, tick, settle } = makeGate();
      expect(settle(0)).toBe(false);
      mutate(camera);
      expect(tick(SETTLE_MS)).toBe(true);
    }
  });

  it('continuous renders regardless of a static pose', () => {
    const { tick, settle } = makeGate();
    expect(settle(0)).toBe(false);
    expect(tick(SETTLE_MS, true)).toBe(true);
  });

  it('a cadence frame renders once and idles again the next tick', () => {
    const { tick, settle } = makeGate();
    expect(settle(0)).toBe(false);
    expect(tick(SETTLE_MS, false, true)).toBe(true);
    expect(tick(SETTLE_MS + 16)).toBe(false);
  });
});

describe('RenderGate wake attribution', () => {
  it('records the reason, so a pinned frame rate is attributable', () => {
    const { gate, tick, settle } = makeGate();
    expect(gate.debugState.lastWake).toBeNull();
    expect(settle(0)).toBe(false);
    gate.invalidate('exposure-cut');
    expect(gate.debugState.lastWake?.reason).toBe('exposure-cut');
    expect(tick(SETTLE_MS)).toBe(true);
    // Latest wins — the readout shows what woke it most recently.
    gate.invalidate('epoch-bucket');
    expect(gate.debugState.lastWake?.reason).toBe('epoch-bucket');
  });

  it('the last decision names which input fired, and which pose slot', () => {
    const { gate, camera, tick, settle } = makeGate();
    expect(settle(0)).toBe(false);
    expect(gate.debugState.lastDecision).toEqual({
      continuous: false, poseChanged: false, cadenceDue: false, poseSlot: null,
    });
    camera.fov += 1e-9;
    expect(tick(SETTLE_MS)).toBe(true);
    expect(gate.debugState.lastDecision?.poseChanged).toBe(true);
    expect(gate.debugState.lastDecision?.poseSlot).toBe('fov');
    // A cadence frame is distinguishable from a pose move.
    expect(tick(SETTLE_MS + 16, false, true)).toBe(true);
    expect(gate.debugState.lastDecision).toMatchObject({
      poseChanged: false, cadenceDue: true, poseSlot: null,
    });
  });

  it('dispose clears both, like every other sentinel', () => {
    const { gate, tick } = makeGate();
    tick(0);
    gate.invalidate('resize');
    gate.dispose();
    expect(gate.debugState.lastWake).toBeNull();
    expect(gate.debugState.lastDecision).toBeNull();
  });
});

describe('RenderGate ride rebase', () => {
  /** One focal-ride step: camera and target translate together, exactly
   *  as `Stellata.applyRideDelta` applies it. */
  const ride = (
    camera: THREE.PerspectiveCamera, target: THREE.Vector3, d: number,
  ) => {
    camera.position.x += d;
    target.x += d;
  };

  it('an absorbed ride step is not camera activity', () => {
    const { gate, camera, target, tick, settle } = makeGate();
    expect(settle(0)).toBe(false);
    ride(camera, target, 1e-11);
    gate.rebasePose({ x: 1e-11, y: 0, z: 0 });
    expect(tick(SETTLE_MS)).toBe(false);
    // And it stays quiet across further absorbed steps — the failure this
    // guards is self-sustaining, not one frame.
    for (let i = 1; i <= 5; i++) {
      ride(camera, target, 1e-11);
      gate.rebasePose({ x: 1e-11, y: 0, z: 0 });
      expect(tick(SETTLE_MS + i * 16)).toBe(false);
    }
  });

  it('the SAME step unabsorbed pins the gate open forever', () => {
    // The regression: the ride runs below the gate, so the next tick reads
    // its write as a fresh camera move, renders, and rides again.
    const { camera, target, tick, settle } = makeGate();
    expect(settle(0)).toBe(false);
    for (let i = 1; i <= 5; i++) {
      ride(camera, target, 1e-11);
      expect(tick(SETTLE_MS + i * 16)).toBe(true);
    }
  });

  it('a real camera move on top of an absorbed ride still wakes it', () => {
    const { gate, camera, target, tick, settle } = makeGate();
    expect(settle(0)).toBe(false);
    ride(camera, target, 1e-11);
    gate.rebasePose({ x: 1e-11, y: 0, z: 0 });
    camera.position.y += 1e-9;
    expect(tick(SETTLE_MS)).toBe(true);
  });

  it('rebasing the camera alone leaves the target slot stale', () => {
    // Pins that rebasePose covers BOTH translated slots: absorbing only
    // the camera would leave target differing every tick.
    const { gate, camera, target, tick, settle } = makeGate();
    expect(settle(0)).toBe(false);
    ride(camera, target, 1e-11);
    gate.rebasePose({ x: 1e-11, y: 0, z: 0 });
    expect(tick(SETTLE_MS)).toBe(false);
    target.x += 1e-11;
    expect(tick(SETTLE_MS + 16)).toBe(true);
  });
});

describe('RenderGate DOM wake', () => {
  const CANVAS_EVENTS = ['pointercancel', 'pointerdown', 'pointermove', 'pointerup', 'wheel'];

  it('wakes on every canvas input event and on window keydown', () => {
    const canvas = makeEventTargetStub();
    const win = makeEventTargetStub();
    vi.stubGlobal('window', win);

    for (const name of [...CANVAS_EVENTS, 'keydown']) {
      const { gate, tick, settle } = makeGate();
      gate.attachDom(canvas as unknown as HTMLElement);
      expect(settle(0)).toBe(false);

      (name === 'keydown' ? win : canvas).fire(name);
      expect(tick(performance.now())).toBe(true);
      gate.dispose();
    }
  });

  it('attaches exactly the documented roster, and dispose removes all of it', () => {
    const canvas = makeEventTargetStub();
    const win = makeEventTargetStub();
    vi.stubGlobal('window', win);
    const { gate } = makeGate();

    gate.attachDom(canvas as unknown as HTMLElement);
    expect(canvas.registered()).toEqual(CANVAS_EVENTS);
    expect(win.registered()).toEqual(['keydown']);

    gate.dispose();
    expect(canvas.registered()).toEqual([]);
    expect(win.registered()).toEqual([]);
  });
});

describe('RenderGate dispose', () => {
  it('re-seeds the pose so a reused gate renders again', () => {
    const { gate, tick, settle } = makeGate();
    expect(settle(0)).toBe(false);
    gate.dispose();
    expect(tick(SETTLE_MS)).toBe(true);
  });
});
