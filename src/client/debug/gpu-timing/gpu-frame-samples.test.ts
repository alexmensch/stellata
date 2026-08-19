import { describe, expect, it } from 'vitest';
import {
  onGpuFrameSample,
  publishGpuFrameSample,
  resolveAndPublishGpuFrame,
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

  it('publishing with nobody listening is a no-op, not an error', () => {
    expect(() => publishGpuFrameSample(1)).not.toThrow();
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

/** A resolve the test settles by hand, so the coalescing window is
 *  explicit rather than dependent on real GPU latency. */
function fakeResolver(): {
  calls: () => number;
  settle: (i: number, ms: number | undefined) => void;
  fail: (i: number) => void;
  resolveTimestampsAsync: () => Promise<number | undefined>;
} {
  const settles: Array<(ms: number | undefined) => void> = [];
  const rejects: Array<(err: unknown) => void> = [];
  return {
    calls: () => settles.length,
    settle: (i, ms) => settles[i](ms),
    fail: (i) => rejects[i](new Error('device lost')),
    resolveTimestampsAsync: () =>
      new Promise<number | undefined>((resolve, reject) => {
        settles.push(resolve);
        rejects.push(reject);
      }),
  };
}

/** A macrotask boundary, so every pending then/catch/finally has run. */
const flush = (): Promise<void> =>
  new Promise((resolve) => { setTimeout(resolve, 0); });

describe('resolving publishes one sample per resolve', () => {
  it('coalesces the calls a resolve spans instead of publishing k copies', async () => {
    const seen: number[] = [];
    const off = onGpuFrameSample((ms) => seen.push(ms));
    const renderer = fakeResolver();

    // Three rendered frames while one resolve is in flight. three hands a
    // concurrent caller the same promise and the same number, so publishing
    // per call would put one frame's duration in the ring three times —
    // which is what noiseMs divides its sample count by.
    resolveAndPublishGpuFrame(renderer);
    resolveAndPublishGpuFrame(renderer);
    resolveAndPublishGpuFrame(renderer);
    expect(renderer.calls()).toBe(1);

    renderer.settle(0, 7);
    await flush();
    expect(seen).toEqual([7]);

    // Settled means the guard cleared: the next frame measures again.
    resolveAndPublishGpuFrame(renderer);
    expect(renderer.calls()).toBe(2);
    renderer.settle(1, 9);
    await flush();
    expect(seen).toEqual([7, 9]);

    off();
  });

  it('publishes nothing when the backend reports no timestamps', async () => {
    const seen: number[] = [];
    const off = onGpuFrameSample((ms) => seen.push(ms));
    const renderer = fakeResolver();

    // An adapter without timestamp-query resolves to undefined — three
    // clears trackTimestamp itself, so the resolve is a no-op every frame.
    resolveAndPublishGpuFrame(renderer);
    renderer.settle(0, undefined);
    await flush();

    expect(seen).toEqual([]);
    off();
  });

  it('clears the guard on a rejected resolve rather than stopping for good', async () => {
    const seen: number[] = [];
    const off = onGpuFrameSample((ms) => seen.push(ms));
    const renderer = fakeResolver();

    resolveAndPublishGpuFrame(renderer);
    renderer.fail(0);
    await flush();

    // A one-off rejection must not leave the flag stuck — that would stop
    // timing for the tab's lifetime.
    resolveAndPublishGpuFrame(renderer);
    expect(renderer.calls()).toBe(2);
    renderer.settle(1, 5);
    await flush();
    expect(seen).toEqual([5]);

    off();
  });
});
