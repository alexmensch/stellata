import { describe, expect, it } from 'vitest';
import type { IUniform } from 'three';
import type { ShellMaterials } from '../fresnel-shell/fresnel-shell';
import { fakeShellMaterials } from '../fresnel-shell/shell-materials-mock';
import {
  DEPTH_DIM_CLEARANCE_PC, NEAR_FADE_EXTENT_FRAC,
} from '../fresnel-shell/shell-distance-pure';
import { LocalBubbleShell } from './local-bubble';
import type { LocalBubbleMesh } from './local-bubble-loader';

/** The shell's uniform record handed back — private to the shell
 *  otherwise. */
function shellWithSlots(): { shell: LocalBubbleShell; slots: () => Record<string, IUniform> } {
  const fake = fakeShellMaterials();
  let captured: Record<string, IUniform> = {};
  const materials: ShellMaterials = {
    fresnelShell: (opts) => {
      const surface = fake.fresnelShell(opts);
      captured = surface.uniforms;
      return surface;
    },
  };
  return { shell: new LocalBubbleShell(materials), slots: () => captured };
}

function mesh(extentPc: number): LocalBubbleMesh {
  return {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
    centroidAbs: [0, 0, 0],
    extentPc,
  };
}

// The wall distance is measured by the build, so the shell cannot author
// its own reaches: attach is the only place that knows them, and the
// construction values stand only while shellReady() is false. Both slots
// are asserted every time — the pair moving together is the invariant
// rimDistancesForExtent exists to hold, so half of it is no assertion.
describe('the Local Bubble camera-distance reaches', () => {
  it('come off the parsed mesh extent, written by attach', () => {
    const { shell, slots } = shellWithSlots();
    expect(slots().uNearFadePc.value).toBe(0);
    expect(slots().uDepthDimRefPc.value).toBe(DEPTH_DIM_CLEARANCE_PC);
    expect(shell.hasMesh()).toBe(false);

    shell.attach(mesh(300));
    expect(slots().uNearFadePc.value).toBeCloseTo(300 * NEAR_FADE_EXTENT_FRAC, 10);
    expect(slots().uDepthDimRefPc.value).toBe(300 + DEPTH_DIM_CLEARANCE_PC);
    expect(shell.hasMesh()).toBe(true);
  });

  it('follow a re-attach onto a differently-sized wall', () => {
    const { shell, slots } = shellWithSlots();
    shell.attach(mesh(300));
    shell.attach(mesh(120));
    expect(slots().uNearFadePc.value).toBeCloseTo(120 * NEAR_FADE_EXTENT_FRAC, 10);
    expect(slots().uDepthDimRefPc.value).toBe(120 + DEPTH_DIM_CLEARANCE_PC);
  });
});
