import type * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { acquireGpuFrameSource } from './gpu-frame-source';
import { publishGpuFrameSample } from '../gpu-timing/gpu-frame-samples';
import { FakeGl, asGl } from '../gpu-timing/fake-gl';

const glHost = (fake: FakeGl) => ({
  rendererGL: { getContext: () => asGl(fake) } as unknown as THREE.WebGLRenderer,
});

describe('the pricing sweep picks its sample source per backend', () => {
  it('subscribes to the renderer resolve on a WebGPU boot', () => {
    const samples: number[] = [];
    const source = acquireGpuFrameSource({ rendererGL: null }, (ms) => samples.push(ms));

    expect(source?.method).toBe('timestamp');
    publishGpuFrameSample(9.5);
    source!.release();
    publishGpuFrameSample(9.5);

    // Released means unsubscribed — a sweep that ended must not keep
    // filling its sink from the render loop.
    expect(samples).toEqual([9.5]);
  });

  it('takes the WebGL2 timer query where the extension exists', () => {
    const source = acquireGpuFrameSource(glHost(new FakeGl()), () => {});
    expect(source?.method).toBe('timer-query');
    source!.release();
  });

  it('falls back to rAF deltas where WebGL2 exposes no timer query', () => {
    const fake = new FakeGl();
    fake.hasExtension = false;
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    const source = acquireGpuFrameSource(glHost(fake), () => {});

    expect(source?.method).toBe('raf-delta');
    // The caller times frames itself in this mode, so there is nothing to
    // release — but it must still be safe to call in the sweep's finally.
    expect(() => source!.release()).not.toThrow();
    expect(info).toHaveBeenCalled();
    info.mockRestore();
  });

  it('leaves the WebGPU path unconstrained by the WebGL2 query slot', () => {
    // No exclusivity on the timestamp path: two live subscriptions are
    // fine, which is why the closed-panel precondition is WebGL2-only.
    const first = acquireGpuFrameSource({ rendererGL: null }, () => {});
    const second = acquireGpuFrameSource({ rendererGL: null }, () => {});
    expect(second?.method).toBe('timestamp');
    first!.release();
    second!.release();
  });
});
