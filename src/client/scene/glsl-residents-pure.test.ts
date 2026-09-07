import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { findGlslResidents } from './glsl-residents-pure';

const meshWith = (material: THREE.Material, name: string) => {
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  mesh.name = name;
  return mesh;
};

/** What three's node materials look like to the walk: `isNodeMaterial`
 *  set, `isShaderMaterial` absent. Building a real one would import
 *  three/webgpu across the bundle boundary. */
const nodeMaterialStandIn = () => {
  const m = new THREE.Material();
  (m as unknown as { isNodeMaterial: boolean }).isNodeMaterial = true;
  return m;
};

describe('findGlslResidents', () => {
  it('finds nothing in a scene of built-ins and node materials', () => {
    const scene = new THREE.Scene();
    scene.add(meshWith(new THREE.MeshBasicMaterial(), 'builtin'));
    scene.add(meshWith(new THREE.LineBasicMaterial(), 'line'));
    scene.add(meshWith(nodeMaterialStandIn(), 'tsl'));
    expect(findGlslResidents(scene)).toEqual([]);
  });

  it('names a raw ShaderMaterial and the object holding it', () => {
    const scene = new THREE.Scene();
    scene.add(meshWith(new THREE.RawShaderMaterial(), 'star-disc'));
    expect(findGlslResidents(scene)).toEqual(['star-disc → RawShaderMaterial']);
  });

  it('reaches a material nested under a group', () => {
    const scene = new THREE.Scene();
    const group = new THREE.Group();
    group.add(meshWith(new THREE.ShaderMaterial(), 'buried'));
    scene.add(group);
    expect(findGlslResidents(scene)).toEqual(['buried → ShaderMaterial']);
  });

  it('reports every entry of a multi-material mesh', () => {
    const scene = new THREE.Scene();
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), [
      new THREE.MeshBasicMaterial(),
      new THREE.ShaderMaterial(),
      new THREE.RawShaderMaterial(),
    ]);
    mesh.name = 'multi';
    scene.add(mesh);
    expect(findGlslResidents(scene))
      .toEqual(['multi → ShaderMaterial', 'multi → RawShaderMaterial']);
  });

  it('falls back to the object type when a mesh is unnamed', () => {
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(new THREE.BufferGeometry(), new THREE.ShaderMaterial()));
    expect(findGlslResidents(scene)).toEqual(['Mesh → ShaderMaterial']);
  });

  it('ignores objects that carry no material at all', () => {
    const scene = new THREE.Scene();
    scene.add(new THREE.Group(), new THREE.Object3D());
    expect(findGlslResidents(scene)).toEqual([]);
  });
});
