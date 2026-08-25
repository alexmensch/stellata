import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { RenderTarget, WebGPURenderer } from 'three/webgpu';
import { buildSharedUniforms } from '../../frame/shared-uniforms';
import { makeHdrEmitterUniforms } from '../../hdr/hdr-pipeline';
import { createVoxelTexture } from '../../loaders/dust-voxel-upload';
import {
  AV_TEX_WIDTH, RECOMPUTE_EPSILON_PC, avTexHeight,
} from '../../star-pipeline/extinction/extinction-prepass-pure';
import { buildSharedUniformNodes } from '../tsl/shared-uniform-nodes';
import { WebGpuExtinctionPrepass } from './extinction-prepass-webgpu';
import { ExtinctionTextureNodes } from './extinction-texture-nodes';

/** A renderer whose readbacks resolve only when the test says so — the
 *  frame-decoupled semantics a cold read has to live with. */
function fakeRenderer() {
  const rendersInto: (RenderTarget | null)[] = [];
  const reads: { x: number; y: number; land: (px: Float32Array) => void }[] = [];
  let current: RenderTarget | null = null;
  const renderer = {
    setRenderTarget: (t: RenderTarget | null) => { current = t; },
    render: () => rendersInto.push(current),
    readRenderTargetPixelsAsync: (_t: RenderTarget, x: number, y: number) =>
      new Promise<Float32Array>((resolve) => { reads.push({ x, y, land: resolve }); }),
  };
  return {
    renderer: renderer as unknown as WebGPURenderer,
    rendersInto,
    reads,
    boundTarget: () => current,
  };
}

const COUNT = 2048;
const flush = () => new Promise<void>((r) => { setTimeout(r, 0); });

function makePrepass(count = COUNT) {
  const shared = buildSharedUniforms({
    pixelRatio: 2, fovYRad: 0.75, viewportW: 1600, viewportH: 900,
    hdr: makeHdrEmitterUniforms(),
  });
  const textures = new ExtinctionTextureNodes();
  const fake = fakeRenderer();
  const prepass = new WebGpuExtinctionPrepass({
    renderer: fake.renderer,
    positions: new Float32Array(count * 3),
    count,
    nodes: buildSharedUniformNodes(shared).nodes,
    textures,
    uniforms: shared,
  });
  const attachDust = () => {
    shared.uDustTexture.value = createVoxelTexture(4, new Uint8Array(64));
    textures.setDustTexture(shared.uDustTexture.value);
  };
  return { ...fake, prepass, shared, textures, attachDust };
}

describe('construction', () => {
  it('needs no float-target extension — that verdict has no WebGPU analogue', () => {
    expect(makePrepass().prepass.supported).toBe(true);
  });

  it('points the consumer texture slot at its own target immediately', () => {
    const { prepass, textures } = makePrepass();
    // uAvPrepassEnabled is the gate, not the binding, so an uncomputed
    // target is bound and simply never fetched.
    expect(prepass.isActive()).toBe(false);
    expect(textures.avPrepass.value).not.toBeNull();
    prepass.dispose();
  });

  it('keeps the star-indexed layout the consumer indexes through', () => {
    const { prepass, textures, shared, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    const target = textures.avPrepass.value as unknown as THREE.Texture & {
      image: { width: number; height: number };
    };
    expect(target.image.width).toBe(AV_TEX_WIDTH);
    expect(target.image.height).toBe(avTexHeight(COUNT));
    expect(shared.uAvPrepassEnabled.value).toBe(1);
  });
});

describe('the displacement gate', () => {
  it('costs nothing without dust, then computes once on the first frame', () => {
    const { prepass, rendersInto, attachDust } = makePrepass();
    prepass.update(0, 0, 0);
    expect(rendersInto).toHaveLength(0);
    attachDust();
    prepass.update(0, 0, 0);
    expect(rendersInto).toHaveLength(1);
  });

  it('an idle camera is free; a move past epsilon recomputes', () => {
    const { prepass, rendersInto, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    prepass.update(RECOMPUTE_EPSILON_PC * 0.5, 0, 0);
    expect(rendersInto).toHaveLength(1);
    prepass.update(RECOMPUTE_EPSILON_PC * 2, 0, 0);
    expect(rendersInto).toHaveLength(2);
  });

  // The same contract ../hdr/reduction-webgpu.ts keeps and pins: a pass
  // ends at the canvas rather than restoring what was bound on entry, so
  // none may run inside another's binding. The WebGL2 twin save/restores,
  // which is why this needs pinning on both sides.
  it('leaves the render target at the canvas — the contract every pass keeps', () => {
    const { prepass, boundTarget, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    expect(boundTarget()).toBeNull();
  });

  it('markDirty recomputes without any camera motion — a voxel chunk landed', () => {
    const { prepass, rendersInto, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    prepass.markDirty();
    prepass.update(0, 0, 0);
    expect(rendersInto).toHaveLength(2);
  });

  it('the A/B switch pauses maintenance, so the fallback side pays no fill', () => {
    const { prepass, rendersInto, shared, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    prepass.setEnabled(false);
    expect(shared.uAvPrepassEnabled.value).toBe(0);
    prepass.update(1e6, 0, 0);
    expect(rendersInto).toHaveLength(1);
    prepass.setEnabled(true);
    expect(shared.uAvPrepassEnabled.value).toBe(1);
  });
});

describe('cold reads', () => {
  it('answers null while inert — no cache, which is not no dust', () => {
    const { prepass, reads } = makePrepass();
    expect(prepass.readAvMag(7)).toBeNull();
    expect(reads).toHaveLength(0);
  });

  it('warms the memo off the star index arithmetic, then answers exactly', async () => {
    const { prepass, reads, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    const idx = AV_TEX_WIDTH + 5;
    expect(prepass.readAvMag(idx)).toBeNull();
    expect(reads).toEqual([{ x: 5, y: 1, land: expect.any(Function) }]);
    reads[0].land(new Float32Array([0.375, 0, 0, 1]));
    await flush();
    expect(prepass.readAvMag(idx)).toBe(0.375);
    expect(reads).toHaveLength(1);
  });

  it('issues one copy per index in flight, not one per asking frame', () => {
    const { prepass, reads, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    for (let i = 0; i < 5; i++) expect(prepass.readAvMag(3)).toBeNull();
    expect(reads).toHaveLength(1);
  });

  // The WebGL twin clears its memo inside the recompute; here the read can
  // outlive the target's contents, so the generation counter is that same
  // invalidation rule expressed for a promise (README.md § Cold reads).
  it('drops a read that resolves against a superseded target', async () => {
    const { prepass, reads, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    expect(prepass.readAvMag(3)).toBeNull();
    prepass.update(RECOMPUTE_EPSILON_PC * 2, 0, 0);
    reads[0].land(new Float32Array([9, 0, 0, 1]));
    await flush();
    expect(prepass.readAvMag(3)).toBeNull();
    expect(reads).toHaveLength(2);
  });

  it('a recompute re-asks rather than serving the previous frame\'s value', async () => {
    const { prepass, reads, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    prepass.readAvMag(3);
    reads[0].land(new Float32Array([0.5, 0, 0, 1]));
    await flush();
    expect(prepass.readAvMag(3)).toBe(0.5);
    prepass.update(RECOMPUTE_EPSILON_PC * 2, 0, 0);
    expect(prepass.readAvMag(3)).toBeNull();
    expect(reads).toHaveLength(2);
  });
});

describe('dispose', () => {
  it('releases the consumer slot and the gate', () => {
    const { prepass, textures, shared, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    const target = textures.avPrepass.value;
    prepass.dispose();
    expect(shared.uAvPrepassEnabled.value).toBe(0);
    expect(textures.avPrepass.value).not.toBe(target);
    expect(prepass.isActive()).toBe(false);
  });

  it('a read in flight at dispose cannot land on a released cache', async () => {
    const { prepass, reads, attachDust } = makePrepass();
    attachDust();
    prepass.update(0, 0, 0);
    prepass.readAvMag(3);
    prepass.dispose();
    reads[0].land(new Float32Array([1, 0, 0, 1]));
    await flush();
    expect(prepass.readAvMag(3)).toBeNull();
  });
});
