import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makeHdrEmitterUniforms } from '../../hdr/hdr-emitter-uniforms';
import { buildSharedUniforms } from '../../frame/shared-uniforms';
import { buildSharedUniformNodes } from '../tsl/shared-uniform-nodes';
import {
  DEFAULT_FACE_ON_FLOOR, DEFAULT_FRESNEL_POWER, SHELL_RIM_ALPHA_LIMB,
} from '../../fresnel-shell/fresnel-shell';
import { DEPTH_DIM_POWER } from '../../fresnel-shell/shell-distance-pure';
import { CLOUD_RIM_DISTANCES } from '../../molecular-clouds/cloud-rim-pure';
import type { CloudAbsorptionSpec } from '../../molecular-clouds/cloud-materials';
import { makeTslCloudMaterials } from './tsl-cloud-materials';

const hdr = makeHdrEmitterUniforms();

function materials(registerMrtLayer = () => () => {}) {
  const shared = buildSharedUniforms({
    pixelRatio: 1, fovYRad: 0.75, viewportW: 800, viewportH: 600, hdr,
  });
  return makeTslCloudMaterials({
    nodes: buildSharedUniformNodes(shared).nodes,
    registerMrtLayer,
  });
}

const absorptionSpec = (field: CloudAbsorptionSpec['field']): CloudAbsorptionSpec => ({
  axes: new THREE.Vector3(10, 8, 6),
  n0Cal: 2,
  rflatPc: 3,
  p: 1.5,
  uEnv: field === null ? 2.5 : 1.05,
  invQuat: new THREE.Matrix3(),
  steps: 16,
  field,
});

function fieldSpec(): NonNullable<CloudAbsorptionSpec['field']> {
  return {
    brick: new THREE.Data3DTexture(new Uint8Array([255, 128]), 2, 1, 1),
    densityMax: 0.05,
    centerFromAabb: new THREE.Vector3(1, 2, 3),
    rotMat: new THREE.Matrix3(),
    uvwScale: new THREE.Vector3(0.1, 0.2, 0.3),
    uvwBias: new THREE.Vector3(0.25, 0.5, 0.5),
  };
}

describe('the cloud absorption surface', () => {
  // See README.md § The absorption writes attachment 2.
  it('is an alpha-only premultiplied-over BackSide draw', () => {
    const m = materials().absorption(absorptionSpec(null)).material;
    expect(m.side).toBe(THREE.BackSide);
    expect(m.transparent).toBe(true);
    expect(m.depthWrite).toBe(false);
    expect(m.blending).toBe(THREE.CustomBlending);
    expect(m.premultipliedAlpha).toBe(false);
    expect(m.blendSrc).toBe(THREE.OneFactor);
    expect(m.blendDst).toBe(THREE.OneMinusSrcAlphaFactor);
    expect(m.blendSrcAlpha).toBe(THREE.OneFactor);
    expect(m.blendDstAlpha).toBe(THREE.OneMinusSrcAlphaFactor);
  });

  // See README.md § The tier is compile-time, so it is two graphs.
  it('seeds the per-cloud slots from the spec', () => {
    const spec = absorptionSpec(null);
    const u = materials().absorption(spec).uniforms;
    expect(u.uUEnv.value).toBe(spec.uEnv);
    expect(u.uN0Cal.value).toBe(spec.n0Cal);
    expect(u.uRflat.value).toBe(spec.rflatPc);
    expect(u.uP.value).toBe(spec.p);
    expect(u.uSteps.value).toBe(spec.steps);
    expect((u.uAxes.value as THREE.Vector3).x).toBe(spec.axes.x);
  });

  // See README.md § The shared pair is not in this record.
  it('withholds the brick slots from the record the layer writes', () => {
    const traced = materials().absorption(absorptionSpec(fieldSpec())).uniforms;
    expect(Object.keys(traced).sort()).toEqual(
      Object.keys(materials().absorption(absorptionSpec(null)).uniforms).sort(),
    );
    expect(Object.keys(traced)).not.toContain('uBrick');
  });

  // See README.md § The tier is compile-time, so it is two graphs.
  it('builds a different material per tier', () => {
    const m = materials();
    expect(m.absorption(absorptionSpec(fieldSpec())).material)
      .not.toBe(m.absorption(absorptionSpec(null)).material);
  });
});

describe('the cloud rim surface', () => {
  it('is an additive FrontSide draw starting in realistic mode', () => {
    const m = materials().rim({ inkHex: 0x101010, inkAlpha: 0.8, opacity: 0.4 });
    expect(m.material.side).toBe(THREE.FrontSide);
    expect(m.material.blending).toBe(THREE.AdditiveBlending);
    expect(m.material.depthWrite).toBe(false);
    expect(m.uniforms.uChart.value).toBe(0);
    expect(m.uniforms.uOpacity.value).toBe(0.4);
  });

  // One annotation vocabulary across the boundary shells and all ~96 cloud
  // rims (`../../fresnel-shell/README.md` § Camera-distance attenuation).
  it('starts at the shared rim params and the cloud reach', () => {
    const u = materials().rim({ inkHex: 0, inkAlpha: 1, opacity: 1 }).uniforms;
    expect(u.uAlphaLimb.value).toBe(SHELL_RIM_ALPHA_LIMB);
    expect(u.uFaceOnFloor.value).toBe(DEFAULT_FACE_ON_FLOOR);
    expect(u.uFresnelPower.value).toBe(DEFAULT_FRESNEL_POWER);
    expect(u.uNearFadePc.value).toBe(CLOUD_RIM_DISTANCES.nearFadePc);
    expect(u.uDepthDimRefPc.value).toBe(CLOUD_RIM_DISTANCES.depthDimRefPc);
    expect(u.uDepthPower.value).toBe(DEPTH_DIM_POWER);
  });
});

it('severs every MRT registration on dispose', () => {
  let live = 0;
  const m = materials(() => {
    live++;
    return () => { live--; };
  });
  const a = m.absorption(absorptionSpec(null));
  const r = m.rim({ inkHex: 0, inkAlpha: 1, opacity: 1 });
  expect(live).toBe(2);
  a.dispose();
  r.dispose();
  expect(live).toBe(0);
});
