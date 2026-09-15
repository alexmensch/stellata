import { describe, expect, it, vi } from 'vitest';
import {
  dropResolvedTimestamps,
  gpuFrameSamplesAreSound,
  onGpuComputeSample,
  onGpuFrameSample,
  publishGpuComputeSample,
  publishGpuFrameSample,
  resolveAndPublishGpuFrame,
  type TimestampPool,
} from './gpu-frame-samples';

describe('whole-frame GPU samples fan out', () => {
  it('delivers to every listener and stops on unsubscribe', () => {
    const a: number[] = [];
    const b: number[] = [];
    const offA = onGpuFrameSample((ms) => a.push(ms));
    const offB = onGpuFrameSample((ms) => b.push(ms));

    publishGpuFrameSample(3);
    offA();
    publishGpuFrameSample(4);
    offB();
    publishGpuFrameSample(5);

    // Two listeners at once is the WebGPU-side point of the channel: the
    // HUD and the pricing harness can both read the same resolve, where a
    // WebGL2 timer query would have to be handed from one to the other.
    expect(a).toEqual([3]);
    expect(b).toEqual([3, 4]);
  });

  it('keeps the compute channel apart from the render one', () => {
    const render: number[] = [];
    const compute: number[] = [];
    const offR = onGpuFrameSample((ms) => render.push(ms));
    const offC = onGpuComputeSample((ms) => compute.push(ms));

    publishGpuFrameSample(20);
    publishGpuComputeSample(1.5);

    // gpu.frame stays the render passes alone — every committed pin row and
    // archived dwell reads that way — so a compute sample must never land in
    // a render subscriber, and the other way round.
    expect(render).toEqual([20]);
    expect(compute).toEqual([1.5]);
    offR();
    offC();
  });

  it('publishing with nobody listening is a no-op, not an error', () => {
    expect(() => publishGpuFrameSample(1)).not.toThrow();
    expect(() => publishGpuComputeSample(1)).not.toThrow();
  });

  it('unsubscribing twice does not disturb the remaining listeners', () => {
    const seen: number[] = [];
    const off = onGpuFrameSample(() => {});
    const keep = onGpuFrameSample((ms) => seen.push(ms));
    off();
    off();
    publishGpuFrameSample(7);
    keep();
    expect(seen).toEqual([7]);
  });
});

/** A resolve the test settles by hand, per pool, so the coalescing window
 *  is explicit rather than dependent on real GPU latency. */
function fakeResolver(): {
  calls: (pool: TimestampPool) => number;
  settle: (pool: TimestampPool, i: number, ms: number | undefined) => void;
  fail: (pool: TimestampPool, i: number) => void;
  resolveTimestampsAsync: (pool: TimestampPool) => Promise<number | undefined>;
} {
  const settles: Record<TimestampPool, Array<(ms: number | undefined) => void>> = { render: [], compute: [] };
  const rejects: Record<TimestampPool, Array<(err: unknown) => void>> = { render: [], compute: [] };
  return {
    calls: (pool) => settles[pool].length,
    settle: (pool, i, ms) => settles[pool][i](ms),
    fail: (pool, i) => rejects[pool][i](new Error('device lost')),
    resolveTimestampsAsync: (pool) =>
      new Promise<number | undefined>((resolve, reject) => {
        settles[pool].push(resolve);
        rejects[pool].push(reject);
      }),
  };
}

/** A macrotask boundary, so every pending then/catch/finally has run. */
const flush = (): Promise<void> =>
  new Promise((resolve) => { setTimeout(resolve, 0); });

/** One cycle's two resolves, settled together. */
function settleCycle(
  renderer: ReturnType<typeof fakeResolver>, i: number, render: number | undefined, compute: number | undefined,
): void {
  renderer.settle('render', i, render);
  renderer.settle('compute', i, compute);
}

describe('resolving publishes one sample per resolve', () => {
  it('coalesces the calls a resolve spans instead of publishing k copies', async () => {
    const seen: number[] = [];
    const off = onGpuFrameSample((ms) => seen.push(ms));
    const renderer = fakeResolver();

    // Three rendered frames while one resolve is in flight. three hands a
    // concurrent caller the same promise and the same number, so publishing
    // per call would put one frame's duration in the ring three times —
    // which is what noiseMs divides its sample count by.
    resolveAndPublishGpuFrame(renderer, true);
    resolveAndPublishGpuFrame(renderer, true);
    resolveAndPublishGpuFrame(renderer, true);
    expect(renderer.calls('render')).toBe(1);

    settleCycle(renderer, 0, 7, 1);
    await flush();
    expect(seen).toEqual([7]);

    // Settled means the guard cleared: the next frame measures again.
    resolveAndPublishGpuFrame(renderer, true);
    expect(renderer.calls('render')).toBe(2);
    settleCycle(renderer, 1, 9, 1);
    await flush();
    expect(seen).toEqual([7, 9]);

    off();
  });

  it('resolves both pools in one cycle and publishes each to its own channel', async () => {
    const render: number[] = [];
    const compute: number[] = [];
    const offR = onGpuFrameSample((ms) => render.push(ms));
    const offC = onGpuComputeSample((ms) => compute.push(ms));
    const renderer = fakeResolver();

    // Only a resolve recycles a pool, and three keeps one per pass type: a
    // render-only resolve left the compute pool overrunning its 2048 queries
    // after ~1024 dispatches, one warning per session, and every compute
    // pass unpriced. Both go out on one call, and the cycle is not over
    // until both are back — one frame, two numbers.
    resolveAndPublishGpuFrame(renderer, true);
    expect([renderer.calls('render'), renderer.calls('compute')]).toEqual([1, 1]);

    renderer.settle('render', 0, 18.9);
    await flush();
    expect(render).toEqual([]);
    resolveAndPublishGpuFrame(renderer, true);
    expect(renderer.calls('render')).toBe(1);

    renderer.settle('compute', 0, 1.4);
    await flush();
    expect(render).toEqual([18.9]);
    expect(compute).toEqual([1.4]);

    offR();
    offC();
  });

  it('publishes a render sample where the compute pool does not exist yet', async () => {
    const render: number[] = [];
    const compute: number[] = [];
    const offR = onGpuFrameSample((ms) => render.push(ms));
    const offC = onGpuComputeSample((ms) => compute.push(ms));
    const renderer = fakeResolver();

    // three creates a pool on the first pass of its type, and resolving a
    // type with no pool returns undefined. A boot that has dispatched no
    // compute yet still has a frame to report.
    resolveAndPublishGpuFrame(renderer, true);
    settleCycle(renderer, 0, 12, undefined);
    await flush();
    expect(render).toEqual([12]);
    expect(compute).toEqual([]);
    expect(gpuFrameSamplesAreSound()).toBe(true);

    offR();
    offC();
  });

  it('never calls a backend whose timestamps the probe refused', async () => {
    const seen: number[] = [];
    const off = onGpuFrameSample((ms) => seen.push(ms));
    const renderer = fakeResolver();

    // Safari 26 grants timestamp-query and then rejects the query set, so
    // the boot probe clears trackTimestamp. three then allocates no pool,
    // which leaves nothing to recycle — and resolving anyway logs
    // `WebGPURenderer: Timestamp tracking is disabled.` on the first frame.
    resolveAndPublishGpuFrame(renderer, false);
    resolveAndPublishGpuFrame(renderer, false);
    await flush();

    expect(renderer.calls('render')).toBe(0);
    expect(renderer.calls('compute')).toBe(0);
    expect(seen).toEqual([]);

    // The skip must not latch the in-flight guard: a backend that does have
    // timestamps still measures every frame.
    resolveAndPublishGpuFrame(renderer, true);
    expect(renderer.calls('render')).toBe(1);
    settleCycle(renderer, 0, 4, 1);
    await flush();
    expect(seen).toEqual([4]);

    off();
  });

  it('publishes nothing when the backend reports no timestamps', async () => {
    const seen: number[] = [];
    const off = onGpuFrameSample((ms) => seen.push(ms));
    const renderer = fakeResolver();

    // An adapter without timestamp-query resolves to undefined — three
    // clears trackTimestamp itself, so the resolve is a no-op every frame.
    resolveAndPublishGpuFrame(renderer, true);
    settleCycle(renderer, 0, undefined, undefined);
    await flush();

    expect(seen).toEqual([]);
    off();
  });

  it('drops three\'s zero seed without calling the backend unsound', async () => {
    const render: number[] = [];
    const compute: number[] = [];
    const offR = onGpuFrameSample((ms) => render.push(ms));
    const offC = onGpuComputeSample((ms) => compute.push(ms));
    const renderer = fakeResolver();

    // three seeds lastValue at 0 and returns it from every early-out, so a
    // resolve that measured nothing is routine rather than a fault.
    resolveAndPublishGpuFrame(renderer, true);
    settleCycle(renderer, 0, 0, 0);
    await flush();

    expect(render).toEqual([]);
    expect(compute).toEqual([]);
    expect(gpuFrameSamplesAreSound()).toBe(true);
    offR();
    offC();
  });

  it('clears the guard on a rejected resolve rather than stopping for good', async () => {
    const seen: number[] = [];
    const off = onGpuFrameSample((ms) => seen.push(ms));
    const renderer = fakeResolver();

    resolveAndPublishGpuFrame(renderer, true);
    renderer.fail('render', 0);
    await flush();

    // A one-off rejection must not leave the flag stuck — that would stop
    // timing for the tab's lifetime.
    resolveAndPublishGpuFrame(renderer, true);
    expect(renderer.calls('render')).toBe(2);
    settleCycle(renderer, 1, 5, 1);
    await flush();
    expect(seen).toEqual([5]);

    off();
  });
});

describe('a duration no frame can have is dropped, not recorded', () => {
  it('drops it, says so once, and latches the backend unsound', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seen: number[] = [];
    const off = onGpuFrameSample((ms) => seen.push(ms));
    const renderer = fakeResolver();

    // Measured on Chrome/Dawn: one half of a pass's timestamp pair resolves
    // unwritten, so the frame reads as the negation of a raw GPU timestamp.
    // Recorded, it sorts gpu.frame off the bottom of the HUD's top-8 table
    // while the headline still reads `gpu`, and poisons every dwell median.
    resolveAndPublishGpuFrame(renderer, true);
    settleCycle(renderer, 0, -1706603456.88, 1);
    await flush();

    expect(seen).toEqual([]);
    expect(gpuFrameSamplesAreSound()).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);

    // Once per tab, not once per frame — and the compute pool lying reads
    // as the same backend lying, not a second fault.
    resolveAndPublishGpuFrame(renderer, true);
    settleCycle(renderer, 1, Number.NaN, Number.NaN);
    await flush();
    expect(seen).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);

    // A backend that recovers still gets its good frames recorded; only the
    // sweep's clock choice stays demoted.
    resolveAndPublishGpuFrame(renderer, true);
    settleCycle(renderer, 2, 8, 1);
    await flush();
    expect(seen).toEqual([8]);
    expect(gpuFrameSamplesAreSound()).toBe(false);

    off();
    warn.mockRestore();
  });
});

/** three's pools, as far as the trim reaches into them. */
function fakePools(perPool: number) {
  const make = (): Map<string, number> => {
    const m = new Map<string, number>();
    for (let i = 0; i < perPool; i++) m.set(`ctx:f${i}`, i);
    return m;
  };
  return {
    backend: {
      timestampQueryPool: {
        render: { timestamps: make() },
        compute: { timestamps: make() },
      },
    },
  };
}

describe('the resolved-uid trim keeps three\'s timestamp Map bounded', () => {
  // three writes <contextUid>:f<frameId> on every resolve and never clears,
  // and the keys are unique per frame — so without this the Map grows for
  // the tab's whole life, one entry per render pass per frame.
  it('clears every pool the backend carries', () => {
    const host = fakePools(3);
    expect(host.backend.timestampQueryPool.render.timestamps.size).toBe(3);
    dropResolvedTimestamps(host);
    expect(host.backend.timestampQueryPool.render.timestamps.size).toBe(0);
    expect(host.backend.timestampQueryPool.compute.timestamps.size).toBe(0);
  });

  it('stays inert wherever a three bump moves the shape', () => {
    // Reaching past three's public surface, so every level has to be
    // survivable: a throw here would land inside the render loop.
    expect(() => dropResolvedTimestamps({})).not.toThrow();
    expect(() => dropResolvedTimestamps({ backend: null })).not.toThrow();
    expect(() => dropResolvedTimestamps({ backend: {} })).not.toThrow();
    expect(() => dropResolvedTimestamps(
      { backend: { timestampQueryPool: null } })).not.toThrow();
    // The pair three seeds before either pool is allocated.
    expect(() => dropResolvedTimestamps(
      { backend: { timestampQueryPool: { render: null, compute: null } } })).not.toThrow();
    expect(() => dropResolvedTimestamps(
      { backend: { timestampQueryPool: { render: {} } } })).not.toThrow();
  });

  it('runs after the resolve settles, on the success and the failure path', async () => {
    const host = fakePools(2);
    const renderer = { ...fakeResolver(), ...host };

    resolveAndPublishGpuFrame(renderer, true);
    // Still populated while the resolve is in flight: trimming early would
    // race the write three does inside resolveQueriesAsync.
    expect(host.backend.timestampQueryPool.render.timestamps.size).toBe(2);
    settleCycle(renderer, 0, 4, 1);
    await flush();
    expect(host.backend.timestampQueryPool.render.timestamps.size).toBe(0);
    expect(host.backend.timestampQueryPool.compute.timestamps.size).toBe(0);

    host.backend.timestampQueryPool.render.timestamps.set('ctx:f9', 9);
    resolveAndPublishGpuFrame(renderer, true);
    renderer.fail('render', 1);
    await flush();
    expect(host.backend.timestampQueryPool.render.timestamps.size).toBe(0);
  });

  it('does not reach the backend at all while the probe says timestamps are off', () => {
    const host = fakePools(2);
    const renderer = { ...fakeResolver(), ...host };
    resolveAndPublishGpuFrame(renderer, false);
    // No resolve ran, so nothing was consumed and nothing is dropped.
    expect(renderer.calls('render')).toBe(0);
    expect(host.backend.timestampQueryPool.render.timestamps.size).toBe(2);
  });
});
