import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makeHdrEmitterUniforms, pickHdrEmitterUniforms } from '../../hdr/hdr-pipeline';
import { buildSharedUniforms } from '../../frame/shared-uniforms';
import { buildSharedUniformNodes } from '../../webgpu/tsl/shared-uniform-nodes';
import { makeTslLgEmissionMaterials } from '../../webgpu/local-group/tsl-lg-materials';
import { makeGlslLgEmissionMaterials } from './lg-emission-materials';

const hdr = makeHdrEmitterUniforms();
const uWorldOffset = { value: new THREE.Vector3() };

const glsl = makeGlslLgEmissionMaterials({ uWorldOffset, hdr });

function tsl(registerMrtLayer = () => () => {}) {
  const shared = buildSharedUniforms({
    pixelRatio: 1, fovYRad: 0.75, viewportW: 800, viewportH: 600, hdr,
  });
  return makeTslLgEmissionMaterials({
    nodes: buildSharedUniformNodes(shared).nodes,
    registerMrtLayer,
  });
}

describe('the Local Group emission material seam', () => {
  // Not a key-parity test, and deliberately so: every slot these shaders
  // read is in the shared node mirror, so the TSL side has nothing of its
  // own to expose (`../../webgpu/local-group/README.md` § Neither pass
  // owns a uniform). What has to hold is that the WebGL side still binds
  // all of them BY REFERENCE, since that is the channel the mirror syncs
  // from.
  it('binds every shared slot by reference on the WebGL path', () => {
    const u = glsl.emission(false).uniforms;
    expect(u.uWorldOffset).toBe(uWorldOffset);
    for (const [key, slot] of Object.entries(pickHdrEmitterUniforms(hdr))) {
      expect(u[key]).toBe(slot);
    }
  });

  it('exposes no slot record on the TSL path', () => {
    expect(Object.keys(tsl().emission(false).uniforms)).toEqual([]);
    expect(Object.keys(tsl().emission(true).uniforms)).toEqual([]);
  });

  // The family fixes the density profile and the step count for the
  // material's life, so the two passes cannot share a graph.
  it('gives the two families distinct materials on both backends', () => {
    expect(glsl.emission(true).material).not.toBe(glsl.emission(false).material);
    const t = tsl();
    expect(t.emission(true).material).not.toBe(t.emission(false).material);
  });

  it('keeps the additive back-face render contract on both backends', () => {
    for (const m of [glsl.emission(true).material, tsl().emission(true).material]) {
      expect(m.side).toBe(THREE.BackSide);
      expect(m.blending).toBe(THREE.AdditiveBlending);
      expect(m.depthWrite).toBe(false);
      expect(m.transparent).toBe(true);
    }
  });

  it('severs the MRT registration on dispose', () => {
    let live = 0;
    const materials = tsl(() => {
      live++;
      return () => { live--; };
    });
    const a = materials.emission(false);
    const b = materials.emission(true);
    expect(live).toBe(2);
    a.dispose();
    b.dispose();
    expect(live).toBe(0);
  });
});
