import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makeTslShellMaterials } from '../webgpu/fresnel-shell/tsl-shell-materials';
import {
  applyRimParams, makeGlslShellMaterials, SHELL_RIM_ALPHA_LIMB, SHELL_RIM_BLUE,
} from './fresnel-shell';
import { DEPTH_DIM_REF_PC, nearFadePcForExtent } from './shell-distance-pure';

const OPTS = {
  colourHex: SHELL_RIM_BLUE,
  alphaLimb: SHELL_RIM_ALPHA_LIMB,
  nearFadePc: nearFadePcForExtent(300),
};

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

  // One writer serves the boundary shells and the cloud rims, so a lever
  // that reaches a slot on one surface reaches the same key on the other.
  it('drives every rim slot through the shared writer', () => {
    const u = makeGlslShellMaterials().fresnelShell(OPTS).uniforms;
    applyRimParams(u, {
      alphaLimb: 0.9, faceOnFloor: 0.5, fresnelPower: 4,
      nearFadePc: 42, depthDimRefPc: 250, depthPower: 2,
    });
    expect(u.uAlphaLimb.value).toBe(0.9);
    expect(u.uFaceOnFloor.value).toBe(0.5);
    expect(u.uFresnelPower.value).toBe(4);
    expect(u.uNearFadePc.value).toBe(42);
    expect(u.uDepthDimRefPc.value).toBe(250);
    expect(u.uDepthPower.value).toBe(2);
  });

  it('leaves unnamed slots alone', () => {
    const u = makeGlslShellMaterials().fresnelShell(OPTS).uniforms;
    applyRimParams(u, { depthPower: 3 });
    expect(u.uDepthPower.value).toBe(3);
    expect(u.uNearFadePc.value).toBe(OPTS.nearFadePc);
    expect(u.uDepthDimRefPc.value).toBe(DEPTH_DIM_REF_PC);
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
