import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { setRawChromeColour } from '../hdr/chrome/chrome-colour';
import { makeTslShellMaterials } from '../webgpu/fresnel-shell/tsl-shell-materials';
import { applyRimParams, SHELL_RIM_ALPHA_LIMB, SHELL_RIM_BLUE } from './fresnel-shell';
import { DEPTH_DIM_POWER, rimDistancesForExtent } from './shell-distance-pure';

const OPTS = {
  colourHex: SHELL_RIM_BLUE,
  alphaLimb: SHELL_RIM_ALPHA_LIMB,
  extentPc: 300,
};
const REACH = rimDistancesForExtent(OPTS.extentPc);

const shellSlots = () => makeTslShellMaterials({ registerMrtLayer: () => () => {} })
  .fresnelShell(OPTS).uniforms;

describe('the boundary-shell material seam', () => {
  // The factory derives both reaches from `extentPc` rather than reading a
  // precomputed record, so one passing 0 for the extent would render the
  // shell on a foreign scale with every slot still present.
  it('derives both reaches from the extent', () => {
    const u = shellSlots();
    expect(u.uNearFadePc.value).toBe(REACH.nearFadePc);
    expect(u.uDepthDimRefPc.value).toBe(REACH.depthDimRefPc);
    expect(u.uDepthPower.value).toBe(DEPTH_DIM_POWER);
  });

  it('inverse-maps the authored colour', () => {
    const mapped = setRawChromeColour(new THREE.Color(), SHELL_RIM_BLUE).getHex();
    const colour = shellSlots().uColour.value as THREE.Color;
    expect(colour.getHex()).toBe(mapped);
  });

  // One writer serves the boundary shells and the cloud rims, so a lever
  // that reaches a slot on one surface reaches the same key on the other.
  it('drives every rim slot through the shared writer', () => {
    const u = shellSlots();
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
    const u = shellSlots();
    applyRimParams(u, { depthPower: 3 });
    expect(u.uDepthPower.value).toBe(3);
    expect(u.uNearFadePc.value).toBe(REACH.nearFadePc);
    expect(u.uDepthDimRefPc.value).toBe(REACH.depthDimRefPc);
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
