import type * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { acquireGpuFrameSource, type GpuFrameSourceHost } from './gpu-frame-source';
import {
  publishGpuFrameSample,
  resolveAndPublishGpuFrame,
} from '../gpu-timing/gpu-frame-samples';
import { FakeGl, asGl } from '../gpu-timing/fake-gl';

const glHost = (fake: FakeGl): GpuFrameSourceHost => ({
  rendererGL: { getContext: () => asGl(fake) } as unknown as THREE.WebGLRenderer,
  webgpu: null,
});

const webgpuHost = (timestampsAvailable: boolean): GpuFrameSourceHost => ({
  rendererGL: null,
  webgpu: { timestampsAvailable },
});

describe('the pricing sweep picks its sample source per backend', () => {
  it('subscribes to the renderer resolve on a WebGPU boot', () => {
    const samples: number[] = [];
    const source = acquireGpuFrameSource(webgpuHost(true), (ms) => samples.push(ms));

    expect(source?.method).toBe('timestamp');
    publishGpuFrameSample(9.5);
    source!.release();
    publishGpuFrameSample(9.5);

    // Released means unsubscribed — a sweep that ended must not keep
    // filling its sink from the render loop.
    expect(samples).toEqual([9.5]);
  });

  it('falls back to rAF deltas where the adapter withheld timestamp-query', () => {
    // trackTimestamp: true is a request, not a grant — three clears it when
    // the feature is absent and every resolve then returns undefined.
    // Claiming 'timestamp' here would burn the whole warmup before aborting
    // with no rows, on the one backend Safari can price at all.
    const samples: number[] = [];
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    const source = acquireGpuFrameSource(webgpuHost(false), (ms) => samples.push(ms));

    expect(source?.method).toBe('raf-delta');
    publishGpuFrameSample(9.5);
    expect(samples).toEqual([]);
    expect(() => source!.release()).not.toThrow();
    expect(info).toHaveBeenCalled();
    info.mockRestore();
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
    const first = acquireGpuFrameSource(webgpuHost(true), () => {});
    const second = acquireGpuFrameSource(webgpuHost(true), () => {});
    expect(second?.method).toBe('timestamp');
    first!.release();
    second!.release();
  });

  // Last: latching the channel unsound is a one-way door for the module.
  it('falls back to rAF deltas where a granted feature resolves garbage', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    resolveAndPublishGpuFrame(
      { resolveTimestampsAsync: async () => -1706603456.88 }, true);
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    // The grant is necessary, not sufficient: every sample is being dropped,
    // so claiming 'timestamp' would spend the warmup before aborting.
    const source = acquireGpuFrameSource(webgpuHost(true), () => {});
    expect(source?.method).toBe('raf-delta');
    expect(info).toHaveBeenCalled();

    warn.mockRestore();
    info.mockRestore();
  });
});
