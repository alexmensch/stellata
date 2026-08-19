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

  it('dispose removes the mesh and releases geometry + material', () => {
    const { scene, layer } = makeLayer();
    const geometry = layer.glowMesh.geometry;
    const material = layer.glowMesh.material as THREE.Material;
    let geomDisposed = false;
    geometry.addEventListener('dispose', () => { geomDisposed = true; });
    layer.dispose();
    expect(scene.children).not.toContain(layer.glowMesh);
    expect(geomDisposed).toBe(true);
    expect(material.name).toBe('star-glow-tsl');
  });
});
