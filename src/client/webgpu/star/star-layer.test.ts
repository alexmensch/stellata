import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makeHdrEmitterUniforms } from '../../hdr/hdr-pipeline';
import { buildSharedUniforms } from '../../frame/shared-uniforms';
import { buildSharedUniformNodes } from '../shared-uniform-nodes';
import { StarLayer } from './star-layer';
import { makeStarGeometrySources } from './star-sources-mock';

function makeLayer(count = 4) {
  const shared = buildSharedUniforms({
    pixelRatio: 2, fovYRad: 0.75, viewportW: 1600, viewportH: 900,
    hdr: makeHdrEmitterUniforms(),
  });
  const nodes = buildSharedUniformNodes(shared).nodes;
  const scene = new THREE.Scene();
  const { sources } = makeStarGeometrySources(count);
  return { scene, sources, layer: new StarLayer(scene, nodes, sources) };
}

const version = (layer: StarLayer) =>
  (layer.glowMesh.geometry.getAttribute('iDyn0') as THREE.InstancedBufferAttribute).version;

const sync = (layer: StarLayer) =>
  (layer.glowMesh.onBeforeRender as () => void)();

describe('StarLayer', () => {
  it('adds the glow mesh at the glow renderOrder, uncullable, additive, no depth write', () => {
    const { scene, layer } = makeLayer();
    expect(scene.children).toContain(layer.glowMesh);
    expect(layer.glowMesh.renderOrder).toBe(1);
    expect(layer.glowMesh.frustumCulled).toBe(false);
    const m = layer.glowMesh.material as THREE.Material;
    expect(m.name).toBe('star-glow-tsl');
    expect(m.blending).toBe(THREE.AdditiveBlending);
    expect(m.depthWrite).toBe(false);
    expect(m.depthTest).toBe(true);
    expect(m.transparent).toBe(true);
  });

  it('first rendered frame re-packs unconditionally — the sentinel fails first write', () => {
    const { layer } = makeLayer();
    const before = version(layer);
    sync(layer);
    expect(version(layer)).toBe(before + 1);
    sync(layer);
    expect(version(layer)).toBe(before + 1);
  });

  it('re-packs a dynamic scalar when its WebGL source attribute is flagged', () => {
    const { layer, sources } = makeLayer();
    sync(layer);
    const dyn = layer.glowMesh.geometry.getAttribute('iDyn0') as THREE.InstancedBufferAttribute;
    (sources.iEclipseDimAttr.array as Float32Array)[2] = 0.25;
    sources.iEclipseDimAttr.needsUpdate = true;
    sync(layer);
    expect((dyn.array as Float32Array)[2 * 4 + 1]).toBe(0.25);
  });

  it('leaves the packed buffer alone on frames where nothing was flagged', () => {
    const { layer, sources } = makeLayer();
    sync(layer);
    (sources.iEclipseDimAttr.array as Float32Array)[2] = 0.25;
    // No needsUpdate — the WebGL path would not upload either.
    sync(layer);
    const dyn = layer.glowMesh.geometry.getAttribute('iDyn0') as THREE.InstancedBufferAttribute;
    expect((dyn.array as Float32Array)[2 * 4 + 1]).toBe(1);
  });

  it('re-packs and uploads only the slots a ranged source reports', () => {
    const { layer, sources } = makeLayer(8);
    sync(layer);
    const dyn = layer.glowMesh.geometry.getAttribute('iDyn0') as THREE.InstancedBufferAttribute;
    dyn.clearUpdateRanges();
    const src = sources.iEclipseDimAttr;
    (src.array as Float32Array)[5] = 0.5;
    src.addUpdateRange(5, 1);
    src.needsUpdate = true;
    sync(layer);
    expect((dyn.array as Float32Array)[5 * 4 + 1]).toBe(0.5);
    // iEclipseDim is iDyn0.y, so the range spans instance 5's whole vec4.
    expect(dyn.updateRanges).toEqual([{ start: 20, count: 4 }]);
    // Consumed, or they accumulate to the uploader's cap unnoticed.
    expect(src.updateRanges).toHaveLength(0);
  });

  it('a full pass on the same buffer discards ranges — three honours ranges over the array', () => {
    const { layer, sources } = makeLayer(8);
    sync(layer);
    const dyn = layer.glowMesh.geometry.getAttribute('iDyn0') as THREE.InstancedBufferAttribute;
    dyn.clearUpdateRanges();
    (sources.iEclipseDimAttr.array as Float32Array)[5] = 0.5;
    sources.iEclipseDimAttr.addUpdateRange(5, 1);
    sources.iEclipseDimAttr.needsUpdate = true;
    (sources.iCompositeSuppressAttr.array as Float32Array)[7] = 1;
    sources.iCompositeSuppressAttr.needsUpdate = true; // no ranges → full
    sync(layer);
    expect((dyn.array as Float32Array)[5 * 4 + 1]).toBe(0.5);
    expect((dyn.array as Float32Array)[7 * 4 + 0]).toBe(1);
    expect(dyn.updateRanges).toHaveLength(0);
  });

  it('dispose removes the mesh and releases geometry, material, and the LUT', () => {
    const { scene, layer } = makeLayer();
    const disposed = new Set<string>();
    const watch = (
      o: { addEventListener(type: 'dispose', listener: () => void): void },
      tag: string,
    ) => o.addEventListener('dispose', () => { disposed.add(tag); });
    watch(layer.glowMesh.geometry, 'geometry');
    watch(layer.glowMesh.material as THREE.Material, 'material');
    watch(layer.colorLut, 'lut');
    layer.dispose();
    expect(scene.children).not.toContain(layer.glowMesh);
    expect([...disposed].sort()).toEqual(['geometry', 'lut', 'material']);
  });
});
