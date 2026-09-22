import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makeHdrEmitterUniforms } from '../../hdr/hdr-emitter-uniforms';
import { buildSharedUniforms } from '../../frame/shared-uniforms';
import { buildSharedUniformNodes } from '../../webgpu/tsl/shared-uniform-nodes';
import { makeTslLgEmissionMaterials } from '../../webgpu/local-group/tsl-lg-materials';

const hdr = makeHdrEmitterUniforms();

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
  // See ../../webgpu/local-group/README.md § Neither pass owns a uniform.
  it('exposes no slot record', () => {
    expect(Object.keys(tsl().emission(false).uniforms)).toEqual([]);
    expect(Object.keys(tsl().emission(true).uniforms)).toEqual([]);
  });

  // The family fixes the density profile and the step count for the
  // material's life, so the two passes cannot share a graph.
  it('gives the two families distinct materials', () => {
    const t = tsl();
    expect(t.emission(true).material).not.toBe(t.emission(false).material);
  });

  it('keeps the additive back-face render contract', () => {
    const m = tsl().emission(true).material;
    expect(m.side).toBe(THREE.BackSide);
    expect(m.blending).toBe(THREE.AdditiveBlending);
    expect(m.depthWrite).toBe(false);
    expect(m.transparent).toBe(true);
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
