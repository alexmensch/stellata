import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ShellRegistry, type ShellInstance } from './shell-registry';
import { isShellLabelResolvable } from './fresnel-shell';
import { FEATURE_LEGIBILITY_MIN_PX, angularRadiusPx } from '../util/orbit-line';

function makeShell(extentPc: number): ShellInstance {
  return {
    label: 'Test Shell',
    sid: 1,
    card: { typeLine: 't', size: 's', knownFrom: 'k' },
    centerAbsInto: (out) => {
      out.set(0, 0, 0);
      return true;
    },
    extentPc: () => extentPc,
    pick: { labelElementId: 'x', visible: () => true, sampleCount: () => 0, sampleLocalInto: () => {} },
  };
}

const VIEWPORT_Y = 900;
const FOV_Y_RAD = 60 * Math.PI / 180;
const PX_PER_RAD = VIEWPORT_Y / FOV_Y_RAD;
const AU_PC = 1 / 206264.806;

function resolvableAt(extentPc: number, distPc: number): boolean {
  const shells = new ShellRegistry();
  shells.register('heliopause', makeShell(extentPc));
  return isShellLabelResolvable(
    shells, 1, new THREE.Vector3(), new THREE.Vector3(0, 0, distPc), VIEWPORT_Y, FOV_Y_RAD,
  );
}

describe('isShellLabelResolvable', () => {
  it('is true when the shell reads well above the legibility floor (close camera)', () => {
    expect(resolvableAt(1, 2)).toBe(true);
  });

  it('is false once the camera pulls out far enough that the shell shrinks sub-floor', () => {
    expect(resolvableAt(1, 1e6)).toBe(false);
  });

  // Regression: an AU-scale shell (the heliopause, extent ~200 AU) must
  // resolve from AU-scale range. A distance clamp measured in pc — as the
  // chevron-sizing path carries — would floor the projected size below the
  // legibility threshold and the label would never show.
  it('resolves an AU-scale shell viewed from AU-scale range', () => {
    const extentPc = 200 * AU_PC;
    expect(resolvableAt(extentPc, 250 * AU_PC)).toBe(true);
    expect(resolvableAt(extentPc, 1)).toBe(false);
  });

  it('gates on angular RADIUS against the shared legibility floor, at the boundary', () => {
    const extentPc = 1;
    // Solve dist so the projected radius lands exactly on the floor:
    // FEATURE_LEGIBILITY_MIN_PX = atan(extentPc / dist) · pxPerRad.
    const dist = extentPc / Math.tan(FEATURE_LEGIBILITY_MIN_PX / PX_PER_RAD);
    expect(angularRadiusPx(extentPc, dist, PX_PER_RAD)).toBeCloseTo(FEATURE_LEGIBILITY_MIN_PX, 9);
    expect(resolvableAt(extentPc, dist * 0.999)).toBe(true);
    expect(resolvableAt(extentPc, dist * 1.001)).toBe(false);
  });

  it('is false for an unregistered shell slot (no distance to report)', () => {
    const shells = new ShellRegistry();
    expect(isShellLabelResolvable(
      shells, 0, new THREE.Vector3(), new THREE.Vector3(0, 0, 2), VIEWPORT_Y, FOV_Y_RAD,
    )).toBe(false);
  });
});
