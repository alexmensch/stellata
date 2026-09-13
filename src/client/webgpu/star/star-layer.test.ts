import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { ComputeNode, WebGPURenderer } from 'three/webgpu';
import { makeHdrEmitterUniforms } from '../../hdr/hdr-pipeline';
import { buildSharedUniforms } from '../../frame/shared-uniforms';
import { makeEmitterGateNodes } from '../hdr/emitter-gates';
import { ExtinctionNodes } from '../extinction/extinction-nodes';
import { STAR_FORWARDED_ATTRIBUTES } from '../star-attribute-roster';
import { buildSharedUniformNodes } from '../tsl/shared-uniform-nodes';
import { STAR_VERTEX_STAGE_STORAGE_BUFFERS, StarLayer } from './star-layer';
import { DEPTH_MASK_RENDER_ORDER } from '../../scene/render-order';
import { makeFakeStarRenderer, makeStarLayerSources } from './star-sources-mock';

export function makeLayer(count = 4) {
  const shared = buildSharedUniforms({
    pixelRatio: 2, fovYRad: 0.75, viewportW: 1600, viewportH: 900,
    hdr: makeHdrEmitterUniforms(),
  });
  const nodes = buildSharedUniformNodes(shared).nodes;
  const scene = new THREE.Scene();
  const { sources } = makeStarLayerSources(count);
  const fake = makeFakeStarRenderer();
  return {
    scene, sources, ...fake,
    layer: new StarLayer(
      fake.renderer as unknown as WebGPURenderer, scene, nodes, sources,
      makeEmitterGateNodes(), new ExtinctionNodes()),
  };
}

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
  it('is three draws, no more', () => {
    const { scene, layer } = makeLayer();
    expect([...scene.children].sort((a, b) => a.renderOrder - b.renderOrder))
      .toEqual([layer.coreMaskMesh, layer.discMesh, layer.glowMesh]);
  });

  it('adds the core mask first, depth-only, gated invisible until the shell opens it', () => {
    const { scene, layer } = makeLayer();
    expect(scene.children).toContain(layer.coreMaskMesh);
    expect(layer.coreMaskMesh.renderOrder).toBe(DEPTH_MASK_RENDER_ORDER);
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

  it('swaps both colour materials to flat ink for chart mode, and back exactly', () => {
    const { layer } = makeLayer();
    const disc = layer.discMesh.material as THREE.Material;
    const glow = layer.glowMesh.material as THREE.Material;
    const mask = layer.coreMaskMesh.material as THREE.Material;

    layer.setMonochrome(true);
    for (const m of [disc, glow]) {
      expect(m.blending).toBe(THREE.MultiplyBlending);
      // three REFUSES MultiplyBlending without premultipliedAlpha, and the
      // refusal leaves the previous material's blend func in place — an
      // order-dependent symptom (../../star-pipeline/star-pipeline.ts).
      expect(m.premultipliedAlpha).toBe(true);
      expect(m.depthWrite).toBe(false);
      expect(m.depthTest).toBe(false);
    }
    // Colour writes are off on the mask, so its blend state is
    // unobservable and it takes no swap.
    expect(mask.blending).toBe(THREE.NormalBlending);

    layer.setMonochrome(false);
    expect(disc.blending).toBe(THREE.CustomBlending);
    expect(disc.blendEquation).toBe(THREE.MaxEquation);
    expect(disc.depthTest).toBe(true);
    // The swap-back drift this pins: losing the override would put the
    // halo's depth write back, and with it the pipeline's early-z
    // (README.md § The disc draw writes no depth).
    expect(disc.depthWrite).toBe(false);
    expect(disc.transparent).toBe(true);
    expect(disc.premultipliedAlpha).toBe(false);
    expect(glow.blending).toBe(THREE.AdditiveBlending);
    expect(glow.depthWrite).toBe(false);
    expect(glow.depthTest).toBe(true);
    expect(glow.premultipliedAlpha).toBe(false);
  });

  // The mirror draws only local-pass members, and membership parks in
  // chart mode — the same split StarPipeline.setMonochromeBlend makes.
  it('leaves the mirror clones alone: they have nothing to draw on paper', () => {
    const { layer } = makeLayer();
    const before = layer.localMirror.group.children
      .map((c) => ((c as THREE.Mesh).material as THREE.Material).blending);
    layer.setMonochrome(true);
    expect(layer.localMirror.group.children
      .map((c) => ((c as THREE.Mesh).material as THREE.Material).blending))
      .toEqual(before);
  });

  // Mask and disc draw the disc-tier list, so they share its geometry and
  // its args slot; glow has its own (compaction/README.md).
  it('mask and disc share the disc-tier geometry; glow draws its own tier', () => {
    const { layer } = makeLayer();
    expect(layer.coreMaskMesh.geometry).toBe(layer.discMesh.geometry);
    expect(layer.glowMesh.geometry).not.toBe(layer.discMesh.geometry);
    const disc = layer.discMesh.geometry as THREE.InstancedBufferGeometry;
    const glow = layer.glowMesh.geometry as THREE.InstancedBufferGeometry;
    expect(disc.indirect).toBe(layer.compaction.args);
    expect(glow.indirect).toBe(layer.compaction.args);
    expect(glow.indirectOffset).toBe(0);
    expect(disc.indirectOffset).toBe(20);
  });

  it('binds seven storage buffers in the vertex stage — the boot floor', () => {
    expect(STAR_VERTEX_STAGE_STORAGE_BUFFERS).toBe(7);
    expect(STAR_VERTEX_STAGE_STORAGE_BUFFERS).toBe(3 + STAR_FORWARDED_ATTRIBUTES.length);
  });

  // The core mask is in the set although its writes are masked off: three's
  // render-pipeline cache is keyed on program ids plus attachment 0's format
  // only, so a material whose fragment program did not change with the
  // target's attachment count is handed the pipeline built for the other
  // count, and every command buffer carrying it is dropped
  // (star-core-mask-tsl.ts).
  it('constructs single-output (inert) and swaps every target material to the MRT struct', () => {
    const { layer } = makeLayer();
    type FragMaterial = THREE.Material & {
      fragmentNode: { isOutputStructNode?: boolean } | null; version: number;
    };
    const target = [layer.coreMaskMesh, layer.discMesh, layer.glowMesh]
      .map((m) => m.material as FragMaterial);
    const singles = target.map((m) => m.fragmentNode);
    for (const single of singles) {
      expect(single?.isOutputStructNode).toBeUndefined();
    }

    const versions = target.map((m) => m.version);
    layer.setMrtOutputs(true);
    target.forEach((m, i) => {
      expect(m.fragmentNode?.isOutputStructNode).toBe(true);
      expect(m.version).toBe(versions[i] + 1);
    });

    // Swapping back restores the SAME single node — no rebuild churn.
    layer.setMrtOutputs(false);
    target.forEach((m, i) => expect(m.fragmentNode).toBe(singles[i]));
    // Idempotent: repeating a state must not invalidate the pipeline.
    const settled = target.map((m) => m.version);
    layer.setMrtOutputs(false);
    target.forEach((m, i) => expect(m.version).toBe(settled[i]));
  });

  // The frame hook: forward this frame's attribute writes, then dispatch —
  // in that order, or the kernel lists survivors off last frame's
  // positions while the draws read this frame's.
  it('update() forwards the sources and dispatches the compaction once', () => {
    const { layer, sources, dispatches } = makeLayer();
    const camera = new THREE.PerspectiveCamera();
    const position = layer.tables.forwardedAttribute('iPosition');
    const before = position.version;
    layer.update(camera);
    expect(position.version).toBe(before + 1);
    expect(dispatches).toHaveLength(1);
    sources.iPositionAttr.addUpdateRange(3, 3);
    sources.iPositionAttr.needsUpdate = true;
    layer.update(camera);
    expect(position.updateRanges).toEqual([{ start: 3, count: 3 }]);
    expect(dispatches).toHaveLength(2);
  });

  it('dispose removes every mesh and releases geometries, materials, LUT, kernels and every storage buffer', () => {
    const { scene, layer, released, dispatches } = makeLayer();
    layer.update(new THREE.PerspectiveCamera());
    const disposed = new Set<string>();
    const watch = (
      o: { addEventListener(type: 'dispose', listener: () => void): void },
      tag: string,
    ) => o.addEventListener('dispose', () => { disposed.add(tag); });
    const meshes = [layer.coreMaskMesh, layer.discMesh, layer.glowMesh];
    watch(layer.glowMesh.geometry, 'geometry:glow');
    watch(layer.discMesh.geometry, 'geometry:disc');
    for (const mesh of meshes) watch(mesh.material as THREE.Material, `material:${mesh.name}`);
    watch(layer.colorLut, 'lut');
    for (const k of dispatches[0] as ComputeNode[]) watch(k, `compute:${k.name}`);
    layer.dispose();
    for (const mesh of meshes) expect(scene.children).not.toContain(mesh);
    expect([...disposed].sort()).toEqual([
      'compute:star-compaction', 'compute:star-compaction-reset',
      'geometry:disc', 'geometry:glow', 'lut',
      'material:star-core-mask-webgpu', 'material:star-disc-webgpu',
      'material:star-glow-webgpu',
    ]);
    // Statics + four forwarded + survivors + args: none sits in a geometry.
    expect(released).toHaveLength(1 + STAR_FORWARDED_ATTRIBUTES.length + 2);
    expect(released).toContain(layer.compaction.survivors);
    expect(released).toContain(layer.compaction.args);
    expect(released).toContain(layer.tables.statics);
  });
});
