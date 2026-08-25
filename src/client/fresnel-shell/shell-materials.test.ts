import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makeTslShellMaterials } from '../webgpu/fresnel-shell/tsl-shell-materials';
import { makeGlslShellMaterials, SHELL_RIM_ALPHA_LIMB, SHELL_RIM_BLUE } from './fresnel-shell';

const OPTS = { colourHex: SHELL_RIM_BLUE, alphaLimb: SHELL_RIM_ALPHA_LIMB };

// The two factories are transcriptions of one uniform block, so the guard
// is the same one the solar-system seam carries: a slot added on one side
// and forgotten on the other fails here rather than rendering a shell with
// a stale value.
describe('the boundary-shell material seam', () => {
  it('gives the shell the same slots on both backends', () => {
    const glslKeys = Object.keys(makeGlslShellMaterials().fresnelShell(OPTS).uniforms);
    const tslKeys = Object.keys(
      makeTslShellMaterials({ registerMrtLayer: () => () => {} })
        .fresnelShell(OPTS).uniforms);
    expect(tslKeys.sort()).toEqual(glslKeys.sort());
  });

  it('inverse-maps the authored colour on both backends', () => {
    const glslColour = makeGlslShellMaterials()
      .fresnelShell(OPTS).uniforms.uColour.value as THREE.Color;
    const tslColour = makeTslShellMaterials({ registerMrtLayer: () => () => {} })
      .fresnelShell(OPTS).uniforms.uColour.value as THREE.Color;
    // Chrome is only correct paired with the operator it inverts, so the
    // mapped value — not the authored hex — is what has to agree.
    expect(tslColour.getHex()).toBe(glslColour.getHex());
  });

  it('severs the MRT registration on dispose', () => {
    let live = 0;
    const surface = makeTslShellMaterials({
      registerMrtLayer: () => {
        live++;
        return () => { live--; };
      },
    }).fresnelShell(OPTS);
    expect(live).toBe(1);
    surface.dispose();
    expect(live).toBe(0);
  });
});
