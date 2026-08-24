import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MIRROR_RENDER_ORDER, MirrorSlots } from './star-mirror-slots';

function makeSource(): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('aCorner', new THREE.BufferAttribute(new Float32Array(8), 2));
  g.setIndex([0, 1, 2, 1, 3, 2]);
  g.setAttribute(
    'iPack0',
    new THREE.InstancedBufferAttribute(
      new Float32Array([0, 1, 2, 3, 10, 11, 12, 13, 20, 21, 22, 23]), 4),
  );
  g.instanceCount = 3;
  return g;
}

function materials(): { mask: THREE.Material; disc: THREE.Material; glow: THREE.Material } {
  return {
    mask: new THREE.MeshBasicMaterial(),
    disc: new THREE.MeshBasicMaterial(),
    glow: new THREE.MeshBasicMaterial(),
  };
}

describe('the in-pass draw order', () => {
  // Both backends read these; the argument for each value is the
  // constant's own docstring.
  it('is mask −1 → disc 0 → glow 3.5', () => {
    expect(MIRROR_RENDER_ORDER.mask).toBe(-1);
    expect(MIRROR_RENDER_ORDER.disc).toBe(0);
    expect(MIRROR_RENDER_ORDER.glow).toBe(3.5);
  });

  it('is what buildGroup stamps, over one shared geometry', () => {
    const slots = new MirrorSlots(makeSource());
    const { group, maskMesh, discMesh, glowMesh } = slots.buildGroup(materials(), 'webgl');
    expect(group.children).toEqual([maskMesh, discMesh, glowMesh]);
    expect(maskMesh.renderOrder).toBe(MIRROR_RENDER_ORDER.mask);
    expect(discMesh.renderOrder).toBe(MIRROR_RENDER_ORDER.disc);
    expect(glowMesh.renderOrder).toBe(MIRROR_RENDER_ORDER.glow);
    for (const m of [maskMesh, discMesh, glowMesh]) {
      expect(m.geometry).toBe(slots.geometry);
      expect(m.frustumCulled).toBe(false);
    }
  });
});

describe('MirrorSlots.sync', () => {
  it('runs beforeCopy ahead of the first source read', () => {
    // The TSL mirror copies PACKED values, so its re-pack has to land
    // before the copy reads them — a hook that ran after would carry an
    // eclipse dim to the mirror one frame late.
    const source = makeSource();
    const slots = new MirrorSlots(source);
    slots.setMembers([1]);
    slots.sync(() => {
      (source.getAttribute('iPack0').array as Float32Array)[4] = 99;
    });
    expect(slots.geometry.getAttribute('iPack0').array[0]).toBe(99);
  });

  it('skips the copy and reports invisible with no members', () => {
    const slots = new MirrorSlots(makeSource());
    let hookRuns = 0;
    expect(slots.sync(() => { hookRuns += 1; })).toBe(false);
    expect(hookRuns).toBe(0);
    expect(slots.geometry.instanceCount).toBe(0);
  });
});
