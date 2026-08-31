import type * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { acquireGpuFrameSource, type GpuFrameSourceHost } from './gpu-frame-source';
import {
  publishGpuFrameSample,
  resolveAndPublishGpuFrame,
} from '../gpu-timing/gpu-frame-samples';
import { FakeGl, asGl } from '../gpu-timing/fake-gl';
import type { GpuFrameMethod } from './frame-cost-pure';
import type * as PerfHud from '../perf-hud';

const perfState = vi.hoisted(() => ({ panelOpen: false }));
vi.mock('../perf-hud', async (importOriginal) => ({
  ...(await importOriginal<typeof PerfHud>()),
  perfInstrumentationInstalled: () => perfState.panelOpen,
}));

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

  it('pins raf-delta on any backend without subscribing to a GPU clock', () => {
    // The caller times frames itself under raf-delta, so a subscription
    // left live would double-count every dwell sample.
    const samples: number[] = [];
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    const source = acquireGpuFrameSource(
      webgpuHost(true), (ms) => samples.push(ms), 'raf-delta');

    expect(source?.method).toBe('raf-delta');
    publishGpuFrameSample(9.5);
    expect(samples).toEqual([]);
    expect(() => source!.release()).not.toThrow();
    expect(info).toHaveBeenCalled();
    info.mockRestore();
  });

  it('honours a pinned method the backend can supply', () => {
    const timestamp = acquireGpuFrameSource(webgpuHost(true), () => {}, 'timestamp');
    expect(timestamp?.method).toBe('timestamp');
    timestamp!.release();

    const timerQuery = acquireGpuFrameSource(glHost(new FakeGl()), () => {}, 'timer-query');
    expect(timerQuery?.method).toBe('timer-query');
    timerQuery!.release();
  });

  it('refuses a pinned method the backend cannot supply, never falls back', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const noExtension = new FakeGl();
    noExtension.hasExtension = false;

    // A silent fallback would rebuild exactly the mixed-method table
    // pinning exists to prevent, so each of these must return null.
    expect(acquireGpuFrameSource(glHost(new FakeGl()), () => {}, 'timestamp')).toBeNull();
    expect(acquireGpuFrameSource(webgpuHost(true), () => {}, 'timer-query')).toBeNull();
    expect(acquireGpuFrameSource(webgpuHost(false), () => {}, 'timestamp')).toBeNull();
    expect(acquireGpuFrameSource(glHost(noExtension), () => {}, 'timer-query')).toBeNull();

    expect(warn).toHaveBeenCalledTimes(4);
    warn.mockRestore();
  });

  it('refuses a method string the union does not name', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // The console is untyped, so a typo arrives here as a plain string.
    // Falling through would run the preference order behind a pin the
    // caller believes was honoured.
    const typo = 'rafdelta' as GpuFrameMethod;
    expect(acquireGpuFrameSource(glHost(new FakeGl()), () => {}, typo)).toBeNull();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("'rafdelta'"));
    warn.mockRestore();
  });

  it('pins raf-delta on a WebGL2 boot without touching the GL context', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const host: GpuFrameSourceHost = {
      rendererGL: {
        getContext: () => {
          throw new Error('the raf-delta pin reached the GL context');
        },
      } as unknown as THREE.WebGLRenderer,
      webgpu: null,
    };

    // Chrome WebGL2 is the cross-backend recipe's own boot, so the pin has
    // to short-circuit ahead of the timer-query slot rather than fall into
    // it — which is also what leaves the closed-panel refusal unreachable.
    const source = acquireGpuFrameSource(host, () => {}, 'raf-delta');

    expect(source?.method).toBe('raf-delta');
    expect(() => source!.release()).not.toThrow();
    info.mockRestore();
  });

  it('warns that an open debug panel contaminates rAF-delta wall time', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Under a GPU clock the panel's per-tick cost sits outside the measured
    // scope; under wall time it lands inside it.
    perfState.panelOpen = true;
    expect(acquireGpuFrameSource(webgpuHost(true), () => {}, 'raf-delta')?.method)
      .toBe('raf-delta');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('debug panel is open'));

    perfState.panelOpen = false;
    warn.mockClear();
    expect(acquireGpuFrameSource(webgpuHost(true), () => {}, 'raf-delta')?.method)
      .toBe('raf-delta');
    expect(warn).not.toHaveBeenCalled();

    info.mockRestore();
    warn.mockRestore();
  });

  it('warns at release when the panel opened mid-sweep', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // The acquire-time check passes with the panel closed; on timer-query a
    // mid-run open dries the samples up and aborts the sweep, but rAF-delta
    // samples keep flowing, so release is the only place left to catch it.
    const source = acquireGpuFrameSource(webgpuHost(true), () => {}, 'raf-delta');
    expect(warn).not.toHaveBeenCalled();

    perfState.panelOpen = true;
    source!.release();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('contaminated'));

    perfState.panelOpen = false;
    info.mockRestore();
    warn.mockRestore();
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

    // Pinning timestamp on the unsound channel refuses too — the grant is
    // there, the samples are not.
    expect(acquireGpuFrameSource(webgpuHost(true), () => {}, 'timestamp')).toBeNull();
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
    info.mockRestore();
  });
});
