import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { makeHdrEmitterUniforms } from '../../hdr/hdr-pipeline';
import { buildSharedUniforms } from '../../frame/shared-uniforms';
import { makeEmitterGateNodes } from '../hdr/emitter-gates';
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
  return {
    scene, sources,
    layer: new StarLayer(scene, nodes, sources, makeEmitterGateNodes()),
  };
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

  it('draws the disc once, MaxEquation, testing depth but never writing it', () => {
    const { scene, layer } = makeLayer();
    expect(scene.children).toContain(layer.discMesh);
    expect(layer.discMesh.frustumCulled).toBe(false);
    expect(layer.discMesh.renderOrder).toBe(0);
    const m = layer.discMesh.material as THREE.Material;
    expect(m.name).toBe('star-disc-tsl');
    expect(m.blending).toBe(THREE.CustomBlending);
    expect(m.blendEquation).toBe(THREE.MaxEquation);
    expect(m.blendSrc).toBe(THREE.OneFactor);
    expect(m.blendDst).toBe(THREE.OneFactor);
    expect(m.depthTest).toBe(true);
    // The core mask is where a core's depth comes from, so this draw must
    // not write any — and a second draw for the halo would double the
    // pass's per-corner cost (README.md § The disc draw writes no depth).
    expect(m.depthWrite).toBe(false);
  });

  // Draw-count parity with the WebGL2 stack is part of the port contract:
  // the migration may not cost more per frame than the renderer it
  // replaces (../README.md § Early-z).
  it('is three draws over one geometry, no more', () => {
    const { scene, layer } = makeLayer();
    expect([...scene.children].sort((a, b) => a.renderOrder - b.renderOrder))
      .toEqual([layer.coreMaskMesh, layer.discMesh, layer.glowMesh]);
  });

  it('adds the core mask first, depth-only, gated invisible until the shell opens it', () => {
    const { scene, layer } = makeLayer();
    expect(scene.children).toContain(layer.coreMaskMesh);
    expect(layer.coreMaskMesh.renderOrder).toBe(-4);
    expect(layer.coreMaskMesh.visible).toBe(false);
    const m = layer.coreMaskMesh.material as THREE.Material;
    expect(m.colorWrite).toBe(false);
    expect(m.depthWrite).toBe(true);
    expect(m.depthTest).toBe(true);
    layer.setCoreMaskVisible(true);
    expect(layer.coreMaskMesh.visible).toBe(true);
    layer.setCoreMaskVisible(false);
    expect(layer.coreMaskMesh.visible).toBe(false);
  });

  it('every mesh shares the one packed geometry by identity', () => {
    const { layer } = makeLayer();
    for (const mesh of [layer.coreMaskMesh, layer.discMesh]) {
      expect(mesh.geometry).toBe(layer.glowMesh.geometry);
    }
  });

  it('constructs single-output (inert) and swaps every colour material to the MRT struct', () => {
    const { layer } = makeLayer();
    type FragMaterial = THREE.Material & {
      fragmentNode: { isOutputStructNode?: boolean } | null; version: number;
    };
    const colour = [layer.discMesh, layer.glowMesh]
      .map((m) => m.material as FragMaterial);
    const coreMask = layer.coreMaskMesh.material as FragMaterial;
    const singles = colour.map((m) => m.fragmentNode);
    for (const single of singles) {
      expect(single?.isOutputStructNode).toBeUndefined();
    }

    const versions = colour.map((m) => m.version);
    layer.setMrtOutputs(true);
    colour.forEach((m, i) => {
      expect(m.fragmentNode?.isOutputStructNode).toBe(true);
      expect(m.version).toBe(versions[i] + 1);
    });
    // The core mask never swaps: colorWrite off, one output is valid
    // under either target (star-layer.ts § setMrtOutputs).
    expect(coreMask.fragmentNode?.isOutputStructNode).toBeUndefined();

    // Swapping back restores the SAME single node — no rebuild churn.
    layer.setMrtOutputs(false);
    colour.forEach((m, i) => expect(m.fragmentNode).toBe(singles[i]));
    // Idempotent: repeating a state must not invalidate the pipeline.
    const settled = colour.map((m) => m.version);
    layer.setMrtOutputs(false);
    colour.forEach((m, i) => expect(m.version).toBe(settled[i]));
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

  it('dispose removes every mesh and releases geometry, all three materials, and the LUT', () => {
    const { scene, layer } = makeLayer();
    const disposed = new Set<string>();
    const watch = (
      o: { addEventListener(type: 'dispose', listener: () => void): void },
      tag: string,
    ) => o.addEventListener('dispose', () => { disposed.add(tag); });
    const meshes = [layer.coreMaskMesh, layer.discMesh, layer.glowMesh];
    watch(layer.glowMesh.geometry, 'geometry');
    for (const mesh of meshes) watch(mesh.material as THREE.Material, `material:${mesh.name}`);
    watch(layer.colorLut, 'lut');
    layer.dispose();
    for (const mesh of meshes) expect(scene.children).not.toContain(mesh);
    expect([...disposed].sort()).toEqual([
      'geometry', 'lut',
      'material:star-core-mask-webgpu', 'material:star-disc-webgpu',
      'material:star-glow-webgpu',
    ]);
  });
});
