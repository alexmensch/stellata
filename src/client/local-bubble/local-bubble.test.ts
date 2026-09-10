import { describe, expect, it } from 'vitest';
import type { IUniform } from 'three';
import { makeGlslShellMaterials, type ShellMaterials } from '../fresnel-shell/fresnel-shell';
import { NEAR_FADE_EXTENT_FRAC } from '../fresnel-shell/shell-distance-pure';
import { LocalBubbleShell } from './local-bubble';
import type { LocalBubbleMesh } from './local-bubble-loader';

/** A shell over the real WebGL2 surface, with its uniform record handed
 *  back — the slots are private to the shell otherwise. */
function shellWithSlots(): { shell: LocalBubbleShell; slots: () => Record<string, IUniform> } {
  const glsl = makeGlslShellMaterials();
  let captured: Record<string, IUniform> = {};
  const materials: ShellMaterials = {
    fresnelShell: (opts) => {
      const surface = glsl.fresnelShell(opts);
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
// its own fade reach: attach is the only place that knows it, and the
// construction value stands only while shellReady() is false.
describe('the Local Bubble near-fade reach', () => {
  it('comes off the parsed mesh extent, written by attach', () => {
    const { shell, slots } = shellWithSlots();
    expect(slots().uNearFadePc.value).toBe(0);
    expect(shell.hasMesh()).toBe(false);

    shell.attach(mesh(300));
    expect(slots().uNearFadePc.value).toBeCloseTo(300 * NEAR_FADE_EXTENT_FRAC, 10);
    expect(shell.hasMesh()).toBe(true);
  });

  it('follows a re-attach onto a differently-sized wall', () => {
    const { shell, slots } = shellWithSlots();
    shell.attach(mesh(300));
    shell.attach(mesh(120));
    expect(slots().uNearFadePc.value).toBeCloseTo(120 * NEAR_FADE_EXTENT_FRAC, 10);
  });
});
