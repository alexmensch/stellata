import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';
import { TrackballSettle } from './trackball-settle';
import { TRACKBALL_SETTLE_PX } from './trackball-settle-pure';

const FOV_Y_RAD = (50 * Math.PI) / 180;
const PX_PER_RAD = 1000 / FOV_Y_RAD;

function makeCanvasStub() {
  const handlers = new Map<string, Set<EventListener>>();
  return {
    registered(): string[] {
      return [...handlers].filter(([, fns]) => fns.size > 0).map(([n]) => n).sort();
    },
    fire(name: string): void {
      for (const fn of handlers.get(name) ?? []) fn(new Event(name));
    },
    addEventListener(name: string, fn: EventListener): void {
      handlers.set(name, (handlers.get(name) ?? new Set()).add(fn));
    },
    removeEventListener(name: string, fn: EventListener): void {
      handlers.get(name)?.delete(fn);
    },
  };
}

function makeSettle() {
  const controls = { target: new THREE.Vector3(), staticMoving: false } as TrackballControls;
  const camera = new THREE.PerspectiveCamera(50, 4 / 3, 1e-12, 1e5);
  camera.position.set(0, 0, 5);
  const settle = new TrackballSettle(controls);
  const canvas = makeCanvasStub();
  settle.attachDom(canvas as unknown as HTMLElement);
  const tick = () => settle.tick(camera, PX_PER_RAD, FOV_Y_RAD);
  /** Swing the eye by `px` worth of angle at the tuned viewport. */
  const swing = (px: number) =>
    camera.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), px / PX_PER_RAD);
  return { settle, controls, camera, canvas, tick, swing };
}

describe('TrackballSettle', () => {
  it('the seed frame never freezes — there is no step to measure yet', () => {
    const { controls, tick } = makeSettle();
    tick();
    expect(controls.staticMoving).toBe(false);
  });

  it('freezes the tail once a frame moves less than the floor', () => {
    const { controls, tick, swing } = makeSettle();
    tick();
    swing(TRACKBALL_SETTLE_PX / 2);
    tick();
    expect(controls.staticMoving).toBe(true);
  });

  it('hands damping back as soon as a frame moves more', () => {
    const { controls, tick, swing } = makeSettle();
    tick();
    tick();
    expect(controls.staticMoving).toBe(true);

    swing(TRACKBALL_SETTLE_PX * 10);
    tick();
    expect(controls.staticMoving).toBe(false);
  });

  it('input hands it back before the gesture is measurable', () => {
    for (const event of ['pointerdown', 'wheel']) {
      const { controls, canvas, tick } = makeSettle();
      tick();
      tick();
      expect(controls.staticMoving).toBe(true);

      canvas.fire(event);
      expect(controls.staticMoving).toBe(false);
    }
  });

  it('a still camera stays frozen frame after frame', () => {
    const { controls, tick } = makeSettle();
    for (let frame = 0; frame < 10; frame++) tick();
    expect(controls.staticMoving).toBe(true);
  });

  it('dispose removes the listeners and leaves damping on', () => {
    const { settle, controls, canvas, tick } = makeSettle();
    tick();
    tick();
    expect(canvas.registered()).toEqual(['pointerdown', 'wheel']);

    settle.dispose();
    expect(canvas.registered()).toEqual([]);
    expect(controls.staticMoving).toBe(false);
  });
});
