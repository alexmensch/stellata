import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makeHdrEmitterUniforms } from '../hdr/hdr-pipeline';
import { buildSharedUniforms } from '../frame/shared-uniforms';
import { buildSharedUniformNodes } from '../webgpu/tsl/shared-uniform-nodes';
import { makeTslCloudMaterials } from '../webgpu/molecular-clouds/tsl-cloud-materials';
import {
  makeGlslCloudMaterials,
  type CloudMaterials,
  type CloudSharedUniforms,
} from './cloud-materials';
import { MOCK_RIM_SPEC as RIM_SPEC, makeMockAbsorptionSpec as spec } from './cloud-mock';

const hdr = makeHdrEmitterUniforms();

const shared: CloudSharedUniforms = {
  uFovYRad: { value: 0.75 },
  uViewport: { value: new THREE.Vector2(800, 600) },
};

/** The pair held by reference on the WebGL path and taken off the
 *  uniform-node mirror on the TSL one, so it is in one record and not the
 *  other by design (`../webgpu/molecular-clouds/README.md`). */
const SHARED_BY_REFERENCE = ['uFovYRad', 'uViewport'];

/** The traced tier's extra slots, which the TSL side keeps out of the
 *  written record — nothing drives them after construction. */
const FIELD_SLOTS = [
  'uBrick', 'uDensityMax', 'uCenterFromAabb', 'uRotMat', 'uUvwScale', 'uUvwBias',
];


function tsl(registerMrtLayer = () => () => {}): CloudMaterials {
  const s = buildSharedUniforms({
    pixelRatio: 1, fovYRad: 0.75, viewportW: 800, viewportH: 600, hdr,
  });
  return makeTslCloudMaterials({
    nodes: buildSharedUniformNodes(s).nodes,
    registerMrtLayer,
  });
}

const glsl = makeGlslCloudMaterials(shared);

describe('the cloud material seam', () => {
  // The two factories are transcriptions of one uniform block, so a slot
  // added on one side and forgotten on the other has to fail here rather
  // than render a cloud with a stale value.
  for (const withField of [false, true]) {
    const tier = withField ? 'traced' : 'analytic';
    it(`gives the ${tier} absorption the same driven slots on both backends`, () => {
      const glslKeys = Object.keys(glsl.absorption(spec(withField)).uniforms)
        .filter((k) => !SHARED_BY_REFERENCE.includes(k) && !FIELD_SLOTS.includes(k));
      const tslKeys = Object.keys(tsl().absorption(spec(withField)).uniforms);
      expect(tslKeys.sort()).toEqual(glslKeys.sort());
    });
  }

  it('binds the shared pair by reference on the WebGL path', () => {
    const u = glsl.absorption(spec(false)).uniforms;
    // A resize or FOV change has to reach the march with no per-frame copy.
    expect(u.uFovYRad).toBe(shared.uFovYRad);
    expect(u.uViewport).toBe(shared.uViewport);
  });

  it('gives the rim the same slots on both backends', () => {
    const glslKeys = Object.keys(glsl.rim(RIM_SPEC).uniforms);
    const tslKeys = Object.keys(tsl().rim(RIM_SPEC).uniforms);
    expect(tslKeys.sort()).toEqual(glslKeys.sort());
  });

  it('inverse-maps the rim colour identically on both backends', () => {
    const g = glsl.rim(RIM_SPEC).uniforms.uColour.value as THREE.Color;
    const t = tsl().rim(RIM_SPEC).uniforms.uColour.value as THREE.Color;
    expect(t.getHex()).toBe(g.getHex());
  });

  // The tier decides the envelope the march clips to, and there is no
  // later write that would correct a material built for the wrong one.
  it('seeds uUEnv from the spec on both backends', () => {
    expect(glsl.absorption(spec(false)).uniforms.uUEnv.value).toBe(0.85);
    expect(tsl().absorption(spec(false)).uniforms.uUEnv.value).toBe(0.85);
  });

  it('severs every MRT registration on dispose', () => {
    let live = 0;
    const materials = tsl(() => {
      live++;
      return () => { live--; };
    });
    const a = materials.absorption(spec(true));
    const r = materials.rim(RIM_SPEC);
    expect(live).toBe(2);
    a.dispose();
    r.dispose();
    expect(live).toBe(0);
  });

  // The tier is a builder branch, not a shader uniform, so the two tiers
  // must come out as two graphs. The material name is the only handle on
  // which branch ran that does not read generated code.
  it('builds a different graph per tier', () => {
    const materials = tsl();
    const traced = materials.absorption(spec(true)).material;
    const analytic = materials.absorption(spec(false)).material;
    expect(traced).not.toBe(analytic);
    expect(traced.name).toBe('cloud-absorption-field-tsl');
    expect(analytic.name).toBe('cloud-absorption-tsl');
  });
});
