import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ShellRegistry, type ShellInstance } from './shell-registry';
import { SHELL_LABEL_MIN_PX, isShellLabelResolvable } from './fresnel-shell';

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

describe('isShellLabelResolvable', () => {
  it('is true when the shell reads well above the legibility floor (close camera)', () => {
    const shells = new ShellRegistry();
    shells.register('heliopause', makeShell(1));
    const worldOffset = new THREE.Vector3();
    const cameraPos = new THREE.Vector3(0, 0, 2);
    expect(isShellLabelResolvable(shells, 1, worldOffset, cameraPos, VIEWPORT_Y, FOV_Y_RAD)).toBe(true);
  });

  it('is false once the camera pulls out far enough that the shell shrinks sub-floor', () => {
    const shells = new ShellRegistry();
    shells.register('heliopause', makeShell(1));
    const worldOffset = new THREE.Vector3();
    const cameraPos = new THREE.Vector3(0, 0, 1e6);
    expect(isShellLabelResolvable(shells, 1, worldOffset, cameraPos, VIEWPORT_Y, FOV_Y_RAD)).toBe(false);
  });

  it('matches renderedSizePx against SHELL_LABEL_MIN_PX exactly at the boundary', () => {
    const shells = new ShellRegistry();
    const extentPc = 1;
    shells.register('heliopause', makeShell(extentPc));
    const worldOffset = new THREE.Vector3();
    const angularToPxValue = VIEWPORT_Y / FOV_Y_RAD;
    // Solve dCam so renderedSizePx lands exactly on SHELL_LABEL_MIN_PX:
    // px = 2·atan(extentPc / dCam)·angularToPxValue.
    const dCam = extentPc / Math.tan((SHELL_LABEL_MIN_PX / angularToPxValue) / 2);
    const cameraPos = new THREE.Vector3(0, 0, dCam);
    const px = shells.renderedSizePx(1, worldOffset, cameraPos, angularToPxValue);
    expect(px).toBeCloseTo(SHELL_LABEL_MIN_PX, 9);
    expect(isShellLabelResolvable(shells, 1, worldOffset, cameraPos, VIEWPORT_Y, FOV_Y_RAD)).toBe(true);
  });

  it('is false for an unregistered shell slot (renderedSizePx reports 0)', () => {
    const shells = new ShellRegistry();
    const worldOffset = new THREE.Vector3();
    const cameraPos = new THREE.Vector3(0, 0, 2);
    expect(isShellLabelResolvable(shells, 0, worldOffset, cameraPos, VIEWPORT_Y, FOV_Y_RAD)).toBe(false);
  });
});
