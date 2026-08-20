import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FloatType, HalfFloatType, RenderTarget, type Texture, type WebGPURenderer } from 'three/webgpu';
import { WebGpuLuminanceReduction } from './reduction-webgpu';
import { reductionLevelSizes } from '../../hdr/exposure/reduction/reduction-pure';

/** A renderer whose readback promises resolve only when the test says so —
 *  the frame-decoupled semantics the render gate and the park rely on. */
function fakeRenderer() {
  const bound: (RenderTarget | null)[] = [];
  const rendersInto: (RenderTarget | null)[] = [];
  const readbacks: { target: RenderTarget; land: (px: Float32Array) => void }[] = [];
  let current: RenderTarget | null = null;
  const renderer = {
    setRenderTarget: (t: RenderTarget | null) => { current = t; bound.push(t); },
    render: () => rendersInto.push(current),
    readRenderTargetPixelsAsync: (target: RenderTarget) =>
      new Promise<Float32Array>((resolve) => {
        readbacks.push({ target, land: resolve });
      }),
  };
  return { renderer: renderer as unknown as WebGPURenderer, bound, rendersInto, readbacks };
}

const statistic = () => new THREE.Texture() as unknown as Texture;
const flush = () => new Promise<void>((r) => { setTimeout(r, 0); });

describe('the chain', () => {
  it('builds one level per halving, fp16 until the one float32 texel read back', () => {
    const { renderer, rendersInto, readbacks } = fakeRenderer();
    const reduction = new WebGpuLuminanceReduction(renderer);
    reduction.measure(statistic(), 40, 24, 2, false);
    const sizes = reductionLevelSizes(40, 24);
    expect(rendersInto).toHaveLength(sizes.length);
    rendersInto.forEach((target, i) => {
      expect([target!.width, target!.height]).toEqual([...sizes[i]]);
      expect(target!.texture.type)
        .toBe(i === sizes.length - 1 ? FloatType : HalfFloatType);
    });
    expect(readbacks).toHaveLength(1);
    expect(readbacks[0].target).toBe(rendersInto[rendersInto.length - 1]);
  });

  it('leaves the render target at the canvas — the contract every pass keeps', () => {
    const { renderer, bound } = fakeRenderer();
    new WebGpuLuminanceReduction(renderer).measure(statistic(), 8, 8, 1, false);
    expect(bound[bound.length - 1]).toBeNull();
  });
});

describe('one readback in flight', () => {
  it('a frame whose predecessor has not landed does no GPU work at all', () => {
    const { renderer, rendersInto, readbacks } = fakeRenderer();
    const reduction = new WebGpuLuminanceReduction(renderer);
    reduction.measure(statistic(), 8, 8, 1, false);
    const after = rendersInto.length;
    reduction.measure(statistic(), 8, 8, 1, false);
    expect(rendersInto).toHaveLength(after);
    expect(readbacks).toHaveLength(1);
    expect(reduction.readbackPending).toBe(true);
    expect(reduction.readbackRequests).toBe(1);
  });

  it('lands the measurement paired with its RENDER-time exposure', async () => {
    const { renderer, readbacks } = fakeRenderer();
    const reduction = new WebGpuLuminanceReduction(renderer);
    reduction.measure(statistic(), 8, 8, 42, false);
    expect(reduction.current()).toBeNull();
    readbacks[0].land(new Float32Array([0.5, 0.25, 0.125, 1]));
    await flush();
    expect(reduction.readbackPending).toBe(false);
    expect(reduction.current()).toEqual({
      meanL: 0.5, surfaceL: 0.25, coverage: 0.125, renderExposure: 42,
    });
  });
});

describe('the disabled and parked paths', () => {
  it('skips the draws, still issues the readback, and drops what it lands', async () => {
    const { renderer, rendersInto, readbacks } = fakeRenderer();
    const reduction = new WebGpuLuminanceReduction(renderer);
    reduction.measure(statistic(), 8, 8, 1, false);
    readbacks[0].land(new Float32Array([1, 1, 1, 1]));
    await flush();
    const before = reduction.current();
    expect(before).not.toBeNull();

    reduction.enabled = false;
    const draws = rendersInto.length;
    reduction.measure(statistic(), 8, 8, 99, false);
    expect(rendersInto).toHaveLength(draws);
    expect(readbacks).toHaveLength(2);
    // A stale texel paired with a live exposure is a feedback loop, not a
    // one-off error — the landing is dropped and the statistic holds still.
    readbacks[1].land(new Float32Array([9, 9, 9, 1]));
    await flush();
    expect(reduction.current()).toEqual(before);
  });

  it('the adaptation park skips the draws the same way', () => {
    const { renderer, rendersInto, readbacks } = fakeRenderer();
    const reduction = new WebGpuLuminanceReduction(renderer);
    reduction.measure(statistic(), 8, 8, 1, true);
    expect(rendersInto).toHaveLength(0);
    expect(readbacks).toHaveLength(1);
  });

  it('reset drops the last reading — chart re-entry must not adapt to a stale frame', async () => {
    const { renderer, readbacks } = fakeRenderer();
    const reduction = new WebGpuLuminanceReduction(renderer);
    reduction.measure(statistic(), 8, 8, 1, false);
    readbacks[0].land(new Float32Array([1, 1, 1, 1]));
    await flush();
    expect(reduction.current()).not.toBeNull();
    reduction.reset();
    expect(reduction.current()).toBeNull();
  });
});
