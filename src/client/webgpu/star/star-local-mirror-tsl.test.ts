import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makeHdrEmitterUniforms } from '../../hdr/hdr-pipeline';
import { buildSharedUniforms } from '../../frame/shared-uniforms';
import {
  MIRROR_CAPACITY, MIRROR_RENDER_ORDER,
} from '../../star-pipeline/local-pass/star-mirror-slots';
import { makeEmitterGateNodes } from '../hdr/emitter-gates';
import { MAX_VERTEX_BUFFERS } from '../star-attribute-roster';
import { ExtinctionTextureNodes } from '../extinction/extinction-texture-nodes';
import { buildSharedUniformNodes } from '../shared-uniform-nodes';
import { StarLayer } from './star-layer';
import { makeStarGeometrySources } from './star-sources-mock';

function makeLayer(count = 4) {
  const shared = buildSharedUniforms({
    pixelRatio: 2, fovYRad: 0.75, viewportW: 1600, viewportH: 900,
    hdr: makeHdrEmitterUniforms(),
  });
  const nodes = buildSharedUniformNodes(shared).nodes;
  const { sources } = makeStarGeometrySources(count);
  return {
    sources,
    layer: new StarLayer(new THREE.Scene(), nodes, sources, makeEmitterGateNodes(), new ExtinctionTextureNodes()),
  };
}

function meshes(layer: StarLayer): [THREE.Mesh, THREE.Mesh, THREE.Mesh] {
  return layer.localMirror.group.children as [THREE.Mesh, THREE.Mesh, THREE.Mesh];
}

function mirrorGeometry(layer: StarLayer): THREE.InstancedBufferGeometry {
  return meshes(layer)[0].geometry as THREE.InstancedBufferGeometry;
}

describe('StarLocalMirrorTsl construction', () => {
  it('mirrors every packed instanced attribute by name, at capacity, plus iSourceIdx', () => {
    const { layer } = makeLayer();
    const geom = mirrorGeometry(layer);
    const source = layer.glowMesh.geometry;
    for (const [name, attr] of Object.entries(source.attributes)) {
      if (!(attr instanceof THREE.InstancedBufferAttribute)) continue;
      const dst = geom.getAttribute(name);
      expect(dst.itemSize).toBe(attr.itemSize);
      expect(dst.array.length).toBe(MIRROR_CAPACITY * attr.itemSize);
    }
    expect(geom.getAttribute('iSourceIdx').itemSize).toBe(1);
    expect(geom.instanceCount).toBe(0);
  });

  it('stays within the guaranteed vertex-buffer budget', () => {
    const { layer } = makeLayer();
    const geom = mirrorGeometry(layer);
    expect(Object.keys(geom.attributes)).toHaveLength(MAX_VERTEX_BUFFERS);
  });

  it('shares the non-instanced aCorner + index buffers with the source by reference', () => {
    const { layer } = makeLayer();
    const geom = mirrorGeometry(layer);
    const source = layer.glowMesh.geometry;
    expect(geom.getAttribute('aCorner')).toBe(source.getAttribute('aCorner'));
    expect(geom.getIndex()).toBe(source.getIndex());
  });

  it('draws in the shared in-pass order, uncullable, over one geometry', () => {
    const { layer } = makeLayer();
    const [mask, disc, glow] = meshes(layer);
    expect(mask.renderOrder).toBe(MIRROR_RENDER_ORDER.mask);
    expect(disc.renderOrder).toBe(MIRROR_RENDER_ORDER.disc);
    expect(glow.renderOrder).toBe(MIRROR_RENDER_ORDER.glow);
    for (const m of [mask, disc, glow]) {
      expect(m.frustumCulled).toBe(false);
      expect(m.geometry).toBe(mask.geometry);
    }
  });

  it('builds the local variants with the shared blend/depth state', () => {
    const { layer } = makeLayer();
    const [mask, disc, glow] = meshes(layer).map((m) => m.material as THREE.Material);
    expect(mask.name).toBe('star-core-mask-local-tsl');
    expect(mask.colorWrite).toBe(false);
    expect(mask.depthWrite).toBe(true);
    expect(mask.depthTest).toBe(true);
    expect(disc.name).toBe('star-disc-local-tsl');
    expect(disc.blending).toBe(THREE.CustomBlending);
    expect(disc.blendEquation).toBe(THREE.MaxEquation);
    // The mirror's own core mask stamps every member core several
    // renderOrders earlier, so the disc mirror writes no depth either —
    // README.md § The disc draw writes no depth carries over in-pass.
    expect(disc.depthWrite).toBe(false);
    expect(glow.name).toBe('star-glow-local-tsl');
    expect(glow.blending).toBe(THREE.AdditiveBlending);
    expect(glow.depthWrite).toBe(false);
    expect(glow.depthTest).toBe(true);
  });

  it('is not in the seam scene — the cluster parents it into the pass scene', () => {
    const scene = new THREE.Scene();
    const shared = buildSharedUniforms({
      pixelRatio: 2, fovYRad: 0.75, viewportW: 1600, viewportH: 900,
      hdr: makeHdrEmitterUniforms(),
    });
    const nodes = buildSharedUniformNodes(shared).nodes;
    const { sources } = makeStarGeometrySources(4);
    const layer = new StarLayer(scene, nodes, sources, makeEmitterGateNodes(), new ExtinctionTextureNodes());
    expect(layer.localMirror.group.parent).toBeNull();
    expect(scene.children).not.toContain(layer.localMirror.group);
  });
});

describe('StarLocalMirrorTsl sync', () => {
  it('re-packs the dynamic sources, then copies each member slot', () => {
    const { layer, sources } = makeLayer();
    // Written to the raw WebGL source attribute — the mirror must see it
    // through the packed iDyn0 copy even though no main mesh rendered.
    (sources.iEclipseDimAttr.array as Float32Array)[2] = 0.25;
    sources.iEclipseDimAttr.needsUpdate = true;
    (sources.iPositionAttr.array as Float32Array).set([7, 8, 9], 2 * 3);
    layer.localMirror.setMembers([2]);
    layer.localMirror.sync();
    const geom = mirrorGeometry(layer);
    expect(geom.instanceCount).toBe(1);
    expect(layer.localMirror.group.visible).toBe(true);
    expect(geom.getAttribute('iSourceIdx').array[0]).toBe(2);
    expect(Array.from(geom.getAttribute('iPosition').array.slice(0, 3))).toEqual([7, 8, 9]);
    // iEclipseDim is iDyn0.y (roster order).
    expect(geom.getAttribute('iDyn0').array[1]).toBe(0.25);
  });

  it('hides the group and draws nothing with no members', () => {
    const { layer } = makeLayer();
    layer.localMirror.setMembers([2]);
    layer.localMirror.sync();
    layer.localMirror.setMembers([]);
    layer.localMirror.sync();
    expect(mirrorGeometry(layer).instanceCount).toBe(0);
    expect(layer.localMirror.group.visible).toBe(false);
  });

  it('clamps the member count to MIRROR_CAPACITY', () => {
    const { layer } = makeLayer();
    layer.localMirror.setMembers(Array.from({ length: 20 }, (_, i) => i % 4));
    layer.localMirror.sync();
    expect(mirrorGeometry(layer).instanceCount).toBe(MIRROR_CAPACITY);
  });
});

describe('StarLocalMirrorTsl MRT swap', () => {
  it('rides the layer swap: mirror colour materials flip, its mask never does', () => {
    const { layer } = makeLayer();
    type FragMaterial = THREE.Material & {
      fragmentNode: { isOutputStructNode?: boolean } | null;
    };
    const [mask, disc, glow] = meshes(layer).map((m) => m.material as FragMaterial);
    layer.setMrtOutputs(true);
    expect(disc.fragmentNode?.isOutputStructNode).toBe(true);
    expect(glow.fragmentNode?.isOutputStructNode).toBe(true);
    expect(mask.fragmentNode?.isOutputStructNode).toBeUndefined();
    layer.setMrtOutputs(false);
    expect(disc.fragmentNode?.isOutputStructNode).toBeUndefined();
    expect(glow.fragmentNode?.isOutputStructNode).toBeUndefined();
  });

  it('disposes its geometry and all three materials', () => {
    const { layer } = makeLayer();
    const disposed = new Set<string>();
    const geom = mirrorGeometry(layer);
    geom.addEventListener('dispose', () => disposed.add('geometry'));
    for (const m of meshes(layer)) {
      (m.material as THREE.Material).addEventListener(
        'dispose', () => disposed.add((m.material as THREE.Material).name));
    }
    layer.localMirror.dispose();
    expect([...disposed].sort()).toEqual([
      'geometry', 'star-core-mask-local-tsl', 'star-disc-local-tsl',
      'star-glow-local-tsl',
    ]);
  });
});
