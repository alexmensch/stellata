import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FloatingOrigin, type AnchorPolicy } from './floating-origin';

function make() {
  const uWorldOffset = { value: new THREE.Vector3() };
  return { origin: new FloatingOrigin(uWorldOffset), uWorldOffset };
}

describe('FloatingOrigin.recenterTo', () => {
  it('moves worldOffset, mirrors uWorldOffset, and returns the applied delta', () => {
    const { origin, uWorldOffset } = make();
    origin.recenterTo(new THREE.Vector3(10, 0, 0));

    const delta = origin.recenterTo(new THREE.Vector3(4, -2, 8));

    expect(delta?.toArray()).toEqual([-6, -2, 8]);
    expect(origin.worldOffset.toArray()).toEqual([4, -2, 8]);
    expect(uWorldOffset.value.toArray()).toEqual([4, -2, 8]);
  });

  it('computes the delta in float64 — exact at kpc-scale origins', () => {
    const { origin } = make();
    origin.recenterTo(new THREE.Vector3(50_000, 0, 0));

    const delta = origin.recenterTo(new THREE.Vector3(50_000 + 1e-7, 0, 0));

    // A float32 subtraction at 5e4 quantises to ~4e-3 (the 1e-7 step
    // would vanish entirely); float64 keeps it to ~1e-12.
    expect(delta?.x).toBeCloseTo(1e-7, 10);
  });

  it('returns null and fires no listener on the no-op path', () => {
    const { origin } = make();
    origin.recenterTo(new THREE.Vector3(4, 0, 0));
    let fired = 0;
    origin.onRecenter(() => { fired += 1; });

    expect(origin.recenterTo(new THREE.Vector3(4, 0, 0))).toBeNull();
    expect(fired).toBe(0);
  });

  it('fans out to listeners in registration order with origin + delta', () => {
    const { origin } = make();
    const calls: string[] = [];
    origin.onRecenter((o, d) => calls.push(`buffer:${o.x},${d.x}`));
    origin.onRecenter((o, d) => calls.push(`camera:${o.x},${d.x}`));
    origin.onRecenter((o, d) => calls.push(`layers:${o.x},${d.x}`));

    origin.recenterTo(new THREE.Vector3(7, 0, 0));

    expect(calls).toEqual(['buffer:7,7', 'camera:7,7', 'layers:7,7']);
  });

  it('detaches a listener through its unsubscribe', () => {
    const { origin } = make();
    let fired = 0;
    const unsub = origin.onRecenter(() => { fired += 1; });
    origin.recenterTo(new THREE.Vector3(1, 0, 0));
    unsub();
    origin.recenterTo(new THREE.Vector3(2, 0, 0));

    expect(fired).toBe(1);
  });
});

describe('FloatingOrigin.tick', () => {
  it('is a no-op with no policy set', () => {
    const { origin } = make();
    expect(origin.tick()).toBe(false);
  });

  it('leaves the origin alone when the policy declines', () => {
    const { origin } = make();
    origin.recenterTo(new THREE.Vector3(3, 0, 0));
    origin.setPolicy({ desiredOrigin: () => null });

    expect(origin.tick()).toBe(false);
    expect(origin.worldOffset.toArray()).toEqual([3, 0, 0]);
  });

  it('recentres onto the policy origin and reports it', () => {
    const { origin } = make();
    const policy: AnchorPolicy = {
      desiredOrigin: (out) => out.set(5, 6, 7),
    };
    origin.setPolicy(policy);
    let fired = 0;
    origin.onRecenter(() => { fired += 1; });

    expect(origin.tick()).toBe(true);
    expect(origin.worldOffset.toArray()).toEqual([5, 6, 7]);
    expect(fired).toBe(1);
  });

  it('reports false when the policy origin is already current', () => {
    const { origin } = make();
    origin.recenterTo(new THREE.Vector3(5, 6, 7));
    origin.setPolicy({ desiredOrigin: (out) => out.set(5, 6, 7) });

    expect(origin.tick()).toBe(false);
  });
});
