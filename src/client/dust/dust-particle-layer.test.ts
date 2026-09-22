import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { DustParticleLayer } from './dust-particle-layer';
import type { DustParticleData } from '../loaders/dust-loader';
import { fakeDustParticleMaterials } from './dust-materials-mock';
import { expectSlotsServedBy } from '../scene/emitter-material-mock';
import { makeHdrEmitterUniforms } from '../hdr/hdr-emitter-uniforms';
import { buildSharedUniforms } from '../frame/shared-uniforms';
import { buildSharedUniformNodes } from '../webgpu/tsl/shared-uniform-nodes';
import { makeTslDustParticleMaterials } from '../webgpu/dust/tsl-dust-materials';

function makeData(count: number): DustParticleData {
  return {
    count,
    positions: new Float32Array(count * 3),
    densities: new Float32Array(count),
  };
}

function makeLayer() {
  const scene = new THREE.Scene();
  const materials = fakeDustParticleMaterials();
  const layer = new DustParticleLayer(scene, materials);
  return { scene, layer, materials, slots: () => materials.surfaces.at(-1)!.uniforms };
}

describe('DustParticleLayer', () => {
  it('attach() adds a hidden mesh with renderOrder 2 to the scene', () => {
    const { scene, layer } = makeLayer();
    layer.attach(makeData(3));

    const mesh = scene.children.find(
      (c): c is THREE.Mesh => (c as THREE.Mesh).isMesh,
    );
    expect(mesh).toBeDefined();
    expect(mesh!.visible).toBe(false);
    expect(mesh!.renderOrder).toBe(2);
    expect(mesh!.frustumCulled).toBe(false);
  });

  it('writes only slots the shipped factory serves', () => {
    const { layer, materials } = makeLayer();
    layer.attach(makeData(1));
    layer.setStrength(0.5);

    const nodes = buildSharedUniformNodes(buildSharedUniforms({
      pixelRatio: 1, fovYRad: 0.75, viewportW: 800, viewportH: 600,
      hdr: makeHdrEmitterUniforms(),
    })).nodes;
    const real = makeTslDustParticleMaterials({
      nodes, registerMrtLayer: () => () => {},
    }).dustParticles();

    expectSlotsServedBy(materials.surfaces.at(-1)!.touchedSlots, real);
  });

  it('setStrength updates uniform and toggles mesh visibility', () => {
    const { scene, layer, slots } = makeLayer();
    layer.attach(makeData(1));
    const mesh = scene.children[0] as THREE.Mesh;

    layer.setStrength(0.5);
    expect(slots().uParticleStrength.value).toBe(0.5);
    expect(mesh.visible).toBe(true);

    layer.setStrength(0);
    expect(slots().uParticleStrength.value).toBe(0);
    expect(mesh.visible).toBe(false);
  });

  it('setStrength clamps negative inputs to 0', () => {
    const { layer, slots } = makeLayer();
    layer.attach(makeData(1));

    layer.setStrength(-1);
    expect(slots().uParticleStrength.value).toBe(0);
  });

  it('setStrength before attach is a no-op', () => {
    const { layer } = makeLayer();
    expect(() => layer.setStrength(1)).not.toThrow();
  });

  it('attach() replaces an existing mesh and disposes the old resources', () => {
    const { scene, layer } = makeLayer();
    layer.attach(makeData(2));
    const oldMesh = scene.children[0] as THREE.Mesh;
    const oldGeom = oldMesh.geometry;
    const oldMat = oldMesh.material as THREE.ShaderMaterial;
    const geomSpy = vi.spyOn(oldGeom, 'dispose');
    const matSpy = vi.spyOn(oldMat, 'dispose');

    layer.attach(makeData(5));

    expect(geomSpy).toHaveBeenCalledOnce();
    expect(matSpy).toHaveBeenCalledOnce();
    expect(scene.children.length).toBe(1);
    expect(scene.children[0]).not.toBe(oldMesh);
  });

  it('dispose() releases geometry + material and clears refs', () => {
    const { scene, layer } = makeLayer();
    layer.attach(makeData(1));
    const mesh = scene.children[0] as THREE.Mesh;
    const geomSpy = vi.spyOn(mesh.geometry, 'dispose');
    const matSpy = vi.spyOn(mesh.material as THREE.ShaderMaterial, 'dispose');

    layer.dispose();

    expect(geomSpy).toHaveBeenCalledOnce();
    expect(matSpy).toHaveBeenCalledOnce();
  });

  it('dispose({ removeFromScene: true }) pulls the mesh out of the scene', () => {
    const { scene, layer } = makeLayer();
    layer.attach(makeData(1));
    expect(scene.children.length).toBe(1);

    layer.dispose({ removeFromScene: true });
    expect(scene.children.length).toBe(0);
  });

  it('dispose() (default removeFromScene: false) leaves the mesh in the scene', () => {
    const { scene, layer } = makeLayer();
    layer.attach(makeData(1));

    layer.dispose();
    expect(scene.children.length).toBe(1);
  });

  it('dispose() before attach is a no-op', () => {
    const { layer } = makeLayer();
    expect(() => layer.dispose()).not.toThrow();
  });

  it('dispose() then attach() rebuilds cleanly', () => {
    const { scene, layer } = makeLayer();
    layer.attach(makeData(2));
    layer.dispose({ removeFromScene: true });
    layer.attach(makeData(3));

    expect(scene.children.length).toBe(1);
    const mesh = scene.children[0] as THREE.Mesh;
    expect(mesh.visible).toBe(false);
  });
});
