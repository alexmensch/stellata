import { describe, expect, it } from 'vitest';
import { onGpuFrameSample, publishGpuFrameSample } from './gpu-frame-samples';

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
