import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makeHdrEmitterUniforms } from '../../hdr/hdr-pipeline';
import { buildSharedUniforms } from '../../frame/shared-uniforms';
import { makeEmitterGateNodes } from '../hdr/emitter-gates';
import { buildSharedUniformNodes } from '../shared-uniform-nodes';
import type {
  PlanetGlareBuffers, PlanetGlareSources,
} from '../../solar-system/planets/planet-body-field';
import { PlanetGlareLayer } from './planet-glare-layer';

/** WebGPU's guaranteed `maxVertexBuffers`. The billboard sits exactly on
 *  it — README.md § The glare packs. */
const MAX_VERTEX_BUFFERS = 8;

function makeBuffers(capacity: number): PlanetGlareBuffers {
  const per = (dims: number) => new Float32Array(capacity * dims);
  return {
    localRel: per(3),
    hostLocalPos: per(3),
    radius: per(1),
    colour: per(3),
    solidity: per(1),
    albedo: per(1),
    hostAbsmag: per(1),
    phaseA: per(4),
    phaseB: per(4),
    phaseC: per(4),
    eclipseDim: per(1),
    ringFlux: per(1),
  };
}

function makeSources(capacity = 4, count = 2) {
  const state = {
    bufs: makeBuffers(capacity),
    layout: 0,
    count,
    hideIdx: -1,
    range: new Int32Array([-1, 0]),
  };
  const sources: PlanetGlareSources = {
    buffers: () => state.bufs,
    layoutVersion: () => state.layout,
    instanceCount: () => state.count,
    hideIdx: () => state.hideIdx,
    localPassRange: () => state.range,
  };
  return { state, sources };
}

function makeLayer(capacity = 4, count = 2) {
  const { state, sources } = makeSources(capacity, count);
  const shared = buildSharedUniforms({
    pixelRatio: 1, fovYRad: 0.75, viewportW: 800, viewportH: 600,
    hdr: makeHdrEmitterUniforms(),
  });
  const scene = new THREE.Scene();
  const layer = new PlanetGlareLayer(
    scene, buildSharedUniformNodes(shared).nodes, sources, makeEmitterGateNodes());
  return { layer, scene, state };
}

/** The layer re-packs from its meshes' onBeforeRender hook. */
const draw = (layer: PlanetGlareLayer) =>
  layer.mesh.onBeforeRender(
    null as never, null as never, null as never,
    layer.mesh.geometry, layer.mesh.material as THREE.Material, null as never);

describe('the WebGPU reflected-glare layer', () => {
  it('fits the billboard into the 8 guaranteed vertex buffers', () => {
    // Exactly at the bound, not under it: the packing is what makes the
    // billboard portable at all, and a 14th attribute has nowhere to go.
    const { layer } = makeLayer();
    const names = Object.keys(layer.mesh.geometry.attributes);
    expect(names.length).toBe(MAX_VERTEX_BUFFERS);
    expect(names.sort()).toEqual([
      'aCorner', 'iBody', 'iColourSolidity', 'iDyn', 'iHostLocalPos',
      'iLocalRel', 'iPhaseCoefsA', 'iPhaseCoefsB',
    ]);
    expect(names).not.toContain('iPhaseCoefsC');
  });

  it('shares the four matching arrays by identity rather than copying', () => {
    const { layer, state } = makeLayer();
    const attr = (n: string) => layer.mesh.geometry.getAttribute(n).array;
    expect(attr('iHostLocalPos')).toBe(state.bufs.hostLocalPos);
    expect(attr('iLocalRel')).toBe(state.bufs.localRel);
    expect(attr('iPhaseCoefsA')).toBe(state.bufs.phaseA);
    expect(attr('iPhaseCoefsB')).toBe(state.bufs.phaseB);
  });

  it('interleaves the scalars, degree-7 coefficient included', () => {
    const { layer, state } = makeLayer();
    const b = state.bufs;
    b.colour.set([0.1, 0.2, 0.3], 3);
    b.solidity[1] = 0.4;
    b.radius[1] = 5;
    b.albedo[1] = 6;
    b.hostAbsmag[1] = 7;
    b.phaseC[4] = 8;
    b.ringFlux[1] = 9;
    b.eclipseDim[1] = 0.5;
    draw(layer);
    const at = (n: string) => layer.mesh.geometry.getAttribute(n).array as Float32Array;
    expect([...at('iColourSolidity').slice(4, 8)]).toEqual([
      expect.closeTo(0.1), expect.closeTo(0.2), expect.closeTo(0.3), expect.closeTo(0.4),
    ]);
    expect([...at('iBody').slice(4, 8)]).toEqual([5, 6, 7, 8]);
    expect([...at('iDyn').slice(2, 4)]).toEqual([9, 0.5]);
  });

  it('tracks the live count and the two slot uniforms every frame', () => {
    const { layer, state } = makeLayer(8, 2);
    draw(layer);
    expect((layer.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(2);
    state.count = 5;
    state.hideIdx = 3;
    state.range.set([2, 4]);
    draw(layer);
    expect((layer.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(5);
    const mat = layer.mesh.material as THREE.Material & { vertexNode: unknown };
    expect(mat.vertexNode).toBeTruthy();
  });

  it('rebuilds over the new arrays when a grow reallocates them', () => {
    // A grow is the one event the layout sentinel exists for: every source
    // array is replaced, so an attribute still pointing at the old one
    // would render the pre-grow roster forever.
    const { layer, state } = makeLayer(4, 2);
    const before = layer.mesh.geometry;
    state.bufs = makeBuffers(8);
    state.layout++;
    state.count = 6;
    draw(layer);
    expect(layer.mesh.geometry).not.toBe(before);
    expect(layer.mesh.geometry.getAttribute('iLocalRel').array)
      .toBe(state.bufs.localRel);
    expect(layer.mirrorMesh.geometry).toBe(layer.mesh.geometry);
    expect((layer.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(6);
  });

  it('keeps the geometry when only the roster changed within capacity', () => {
    const { layer, state } = makeLayer(8, 2);
    draw(layer);
    const geometry = layer.mesh.geometry;
    state.layout++;
    state.count = 3;
    draw(layer);
    expect(layer.mesh.geometry).toBe(geometry);
  });

  it('parks the mirror until the local depth pass ports', () => {
    // With no bracketed pass to draw it, a visible mirror would double
    // every body's glare in the main pass.
    const { layer } = makeLayer();
    expect(layer.mirrorMesh.visible).toBe(false);
    expect(layer.mesh.visible).toBe(true);
  });

  it('swaps both materials into chart ink and back', () => {
    const { layer } = makeLayer();
    const blends = () => [layer.mesh, layer.mirrorMesh]
      .map((m) => (m.material as THREE.Material).blending);
    expect(blends()).toEqual([THREE.AdditiveBlending, THREE.AdditiveBlending]);
    layer.setMonochrome(true);
    expect(blends()).toEqual([THREE.MultiplyBlending, THREE.MultiplyBlending]);
    layer.setMonochrome(false);
    expect(blends()).toEqual([THREE.AdditiveBlending, THREE.AdditiveBlending]);
  });

  it('takes both meshes back out of the scene on dispose', () => {
    const { layer, scene } = makeLayer();
    expect(scene.children.length).toBe(2);
    layer.dispose();
    expect(scene.children.length).toBe(0);
  });
});
