import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MIRROR_CAPACITY, StarLocalMirror } from './star-local-mirror';

const DUMMY_SHADER = 'void main(){}';

function makeSource(): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute(
    'aCorner',
    new THREE.BufferAttribute(
      new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]),
      2,
    ),
  );
  g.setIndex([0, 1, 2, 1, 3, 2]);
  g.setAttribute(
    'iPosition',
    new THREE.InstancedBufferAttribute(
      new Float32Array([0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3]),
      3,
    ),
  );
  g.setAttribute(
    'iAbsmag',
    new THREE.InstancedBufferAttribute(new Float32Array([10, 20, 30, 40]), 1),
  );
  g.instanceCount = 4;
  return g;
}

function makeMirror(source: THREE.InstancedBufferGeometry): StarLocalMirror {
  return new StarLocalMirror(source, DUMMY_SHADER, DUMMY_SHADER, {});
}

function meshes(mirror: StarLocalMirror): [THREE.Mesh, THREE.Mesh, THREE.Mesh] {
  return mirror.group.children as [THREE.Mesh, THREE.Mesh, THREE.Mesh];
}

function mirrorGeometry(mirror: StarLocalMirror): THREE.InstancedBufferGeometry {
  return meshes(mirror)[0].geometry as THREE.InstancedBufferGeometry;
}

describe('StarLocalMirror construction', () => {
  it('mirrors every instanced source attribute by name, at capacity, plus iSourceIdx', () => {
    const geom = mirrorGeometry(makeMirror(makeSource()));
    const absmag = geom.getAttribute('iAbsmag');
    const position = geom.getAttribute('iPosition');
    expect(absmag.itemSize).toBe(1);
    expect(absmag.array.length).toBe(MIRROR_CAPACITY * 1);
    expect(position.itemSize).toBe(3);
    expect(position.array.length).toBe(MIRROR_CAPACITY * 3);
    expect(geom.getAttribute('iSourceIdx').itemSize).toBe(1);
    expect(geom.instanceCount).toBe(0);
  });

  it('shares the non-instanced aCorner + index buffers with the source by reference', () => {
    const source = makeSource();
    const geom = mirrorGeometry(makeMirror(source));
    expect(geom.getAttribute('aCorner')).toBe(source.getAttribute('aCorner'));
    expect(geom.getIndex()).toBe(source.getIndex());
  });

  it('sets renderOrder mask −1 / disc 0 / glow 3.5 with frustum culling off', () => {
    const [mask, disc, glow] = meshes(makeMirror(makeSource()));
    expect(mask.renderOrder).toBe(-1);
    expect(disc.renderOrder).toBe(0);
    expect(glow.renderOrder).toBe(3.5);
    expect(mask.frustumCulled).toBe(false);
    expect(disc.frustumCulled).toBe(false);
    expect(glow.frustumCulled).toBe(false);
  });

  it('compiles all three materials in the local-depth variant with the shared blend defaults', () => {
    const [mask, disc, glow] = meshes(makeMirror(makeSource()));
    const maskMat = mask.material as THREE.RawShaderMaterial;
    const discMat = disc.material as THREE.RawShaderMaterial;
    const glowMat = glow.material as THREE.RawShaderMaterial;
    expect(maskMat.defines?.LOCAL_DEPTH_PASS).toBe('');
    expect(discMat.defines?.LOCAL_DEPTH_PASS).toBe('');
    expect(glowMat.defines?.LOCAL_DEPTH_PASS).toBe('');
    // Mask: depth-only core prepass — an occluded core must depth-fail
    // before the disc pass blends (MaxEquation cannot paint over it).
    expect(maskMat.uniforms.uRenderMode.value).toBe(2);
    expect(maskMat.colorWrite).toBe(false);
    expect(maskMat.depthWrite).toBe(true);
    expect(maskMat.depthTest).toBe(true);
    // Disc: applyDiscBlendDefaults (opaque max-blend, writes depth).
    expect(discMat.uniforms.uRenderMode.value).toBe(1);
    expect(discMat.blending).toBe(THREE.CustomBlending);
    expect(discMat.depthWrite).toBe(true);
    // Glow: applyGlowBlendDefaults (additive, no depth write, depth test on).
    expect(glowMat.uniforms.uRenderMode.value).toBe(0);
    expect(glowMat.blending).toBe(THREE.AdditiveBlending);
    expect(glowMat.depthWrite).toBe(false);
    expect(glowMat.depthTest).toBe(true);
    expect(glowMat.transparent).toBe(true);
  });
});

describe('StarLocalMirror sync', () => {
  it('copies each member slot from its source catalog index', () => {
    const mirror = makeMirror(makeSource());
    mirror.setMembers([2]);
    mirror.sync();
    const geom = mirrorGeometry(mirror);
    expect(geom.instanceCount).toBe(1);
    expect(mirror.group.visible).toBe(true);
    expect(geom.getAttribute('iAbsmag').array[0]).toBe(30);
    expect(Array.from(geom.getAttribute('iPosition').array.slice(0, 3))).toEqual([2, 2, 2]);
    expect(geom.getAttribute('iSourceIdx').array[0]).toBe(2);
  });

  it('hides the group and draws nothing with no members', () => {
    const mirror = makeMirror(makeSource());
    mirror.setMembers([2]);
    mirror.sync();
    mirror.setMembers([]);
    mirror.sync();
    expect(mirrorGeometry(mirror).instanceCount).toBe(0);
    expect(mirror.group.visible).toBe(false);
  });

  it('clamps the member count to MIRROR_CAPACITY', () => {
    const mirror = makeMirror(makeSource());
    mirror.setMembers(Array.from({ length: 20 }, (_, i) => i % 4));
    mirror.sync();
    expect(mirrorGeometry(mirror).instanceCount).toBe(MIRROR_CAPACITY);
  });

  it('disposes without throwing', () => {
    expect(() => makeMirror(makeSource()).dispose()).not.toThrow();
  });
});
