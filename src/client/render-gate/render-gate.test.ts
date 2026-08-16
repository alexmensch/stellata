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
  const tick = (nowMs: number, continuous = false) =>
    gate.tick(camera, target, worldOffset, continuous, nowMs);
  /** Render the seed frame, then step past the settle tail — the gate is
   *  skipping when this returns, so a later `true` is a genuine wake. */
  const settle = (t0: number) => {
    tick(t0);
    return tick(t0 + SETTLE_MS);
  };
  return { gate, camera, tick, settle };
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
