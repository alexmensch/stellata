import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  MIRROR_CAPACITY, MIRROR_RENDER_ORDER,
} from '../../star-pipeline/local-pass/star-mirror-slots';
import type { StarLayer } from './star-layer';
import { makeLayer } from './star-layer.test';

function meshes(layer: StarLayer): [THREE.Mesh, THREE.Mesh, THREE.Mesh] {
  return layer.localMirror.group.children as [THREE.Mesh, THREE.Mesh, THREE.Mesh];
}

function mirrorGeometry(layer: StarLayer): THREE.InstancedBufferGeometry {
  return meshes(layer)[0].geometry as THREE.InstancedBufferGeometry;
}

describe('StarLocalMirrorTsl construction', () => {
  // Every star field is read out of the layer's tables by iSourceIdx, so
  // the slots carry nothing else — the source geometry has no per-instance
  // attribute left to mirror.
  it('holds the corner and iSourceIdx alone, at capacity, drawing nothing', () => {
    const { layer } = makeLayer();
    const geom = mirrorGeometry(layer);
    expect(Object.keys(geom.attributes).sort()).toEqual(['aCorner', 'iSourceIdx']);
    const idx = geom.getAttribute('iSourceIdx');
    expect(idx.itemSize).toBe(1);
    expect(idx.array.length).toBe(MIRROR_CAPACITY);
    expect(geom.instanceCount).toBe(0);
    expect(geom.indirect).toBeNull();
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
    const { scene, layer } = makeLayer();
    expect(layer.localMirror.group.parent).toBeNull();
    expect(scene.children).not.toContain(layer.localMirror.group);
  });
});

describe('StarLocalMirrorTsl sync', () => {
  // The slots carry iSourceIdx alone, so the mirror forwards nothing: the
  // table its vertex stage reads at that index is the one
  // StarLayer.update(camera) made current earlier in the same tick.
  it('fills the member slots and leaves the tables to the layer', () => {
    const { layer, sources } = makeLayer();
    (sources.iPositionAttr.array as Float32Array).set([7, 8, 9], 2 * 3);
    sources.iPositionAttr.needsUpdate = true;
    const position = layer.tables.forwardedAttribute('iPosition');
    const before = position.version;
    layer.localMirror.setMembers([2]);
    layer.localMirror.sync();
    const geom = mirrorGeometry(layer);
    expect(geom.instanceCount).toBe(1);
    expect(layer.localMirror.group.visible).toBe(true);
    expect(geom.getAttribute('iSourceIdx').array[0]).toBe(2);
    expect(position.version).toBe(before);
    layer.update(new THREE.PerspectiveCamera());
    expect(position.version).toBe(before + 1);
    expect((position.array as Float32Array).slice(6, 9)).toEqual(new Float32Array([7, 8, 9]));
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
  // The mask flips with the colour pair for the same pipeline-cache reason
  // the main layer's does (star-core-mask-tsl.ts).
  it('rides the layer swap: all three mirror materials flip together', () => {
    const { layer } = makeLayer();
    type FragMaterial = THREE.Material & {
      fragmentNode: { isOutputStructNode?: boolean } | null;
    };
    const all = meshes(layer).map((m) => m.material as FragMaterial);
    layer.setMrtOutputs(true);
    for (const m of all) expect(m.fragmentNode?.isOutputStructNode).toBe(true);
    layer.setMrtOutputs(false);
    for (const m of all) expect(m.fragmentNode?.isOutputStructNode).toBeUndefined();
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
