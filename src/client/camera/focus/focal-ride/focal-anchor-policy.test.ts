import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FOCAL_ORIGIN_DRIFT_RATIO } from './focal-ride-pure';
import { makeFocalAnchorPolicy, type FocalAnchorDeps } from './focal-anchor-policy';

const EYE = 2;
const DRIFTED = EYE * FOCAL_ORIGIN_DRIFT_RATIO * 2;

function harness(overrides: Partial<FocalAnchorDeps> = {}) {
  const deps: FocalAnchorDeps = {
    hasHardFocus: () => true,
    isCameraBusy: () => false,
    cameraPosition: new THREE.Vector3(DRIFTED, 0, 0),
    orbitTarget: new THREE.Vector3(DRIFTED - EYE, 0, 0),
    worldOffset: new THREE.Vector3(1000, 0, 0),
    ...overrides,
  };
  return { deps, policy: makeFocalAnchorPolicy(deps), out: new THREE.Vector3() };
}

describe('makeFocalAnchorPolicy', () => {
  it('names the orbit target in absolute space once the camera has drifted', () => {
    const { policy, out } = harness();

    expect(policy(out)).toBe(out);
    expect(out.toArray()).toEqual([1000 + DRIFTED - EYE, 0, 0]);
  });

  it('declines with nothing hard-focused', () => {
    const { policy, out } = harness({ hasHardFocus: () => false });
    expect(policy(out)).toBeNull();
  });

  it('declines while a camera-owning animation runs', () => {
    const { policy, out } = harness({ isCameraBusy: () => true });
    expect(policy(out)).toBeNull();
  });

  it('declines below the drift ratio', () => {
    const { policy, out } = harness({
      cameraPosition: new THREE.Vector3(EYE * FOCAL_ORIGIN_DRIFT_RATIO, 0, 0),
      orbitTarget: new THREE.Vector3(EYE * FOCAL_ORIGIN_DRIFT_RATIO - EYE, 0, 0),
    });
    expect(policy(out)).toBeNull();
  });

  it('reads the live references, so one policy serves every frame', () => {
    const { deps, policy, out } = harness();

    deps.orbitTarget.set(0, 0, 0);
    deps.cameraPosition.set(0, 0, 0);
    expect(policy(out)).toBeNull();

    deps.cameraPosition.set(0, DRIFTED, 0);
    deps.orbitTarget.set(0, DRIFTED - EYE, 0);
    expect(policy(out)?.toArray()).toEqual([1000, DRIFTED - EYE, 0]);
  });
});
