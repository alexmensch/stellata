// Whole-frame GPU durations the render loop measures itself, fanned out
// to every consumer that wants them. See README.md § GPU timing.

type Subscriber = (ms: number) => void;

const subscribers = new Set<Subscriber>();

/** The renderer's frame-duration resolve, structurally — keeps this module
 *  off `three/webgpu` (`../../webgpu/README.md` § Import boundary). */
export interface GpuFrameResolver {
  resolveTimestampsAsync(): Promise<number | undefined>;
}

let resolveInFlight = false;

/** Publish one frame's measured GPU milliseconds. WebGPU only — a WebGL2
 *  frame is timed by whichever GL timer owns the context's single query
 *  slot, so publishing here too would record `gpu.frame` twice per frame. */
export function publishGpuFrameSample(ms: number): void {
  for (const s of subscribers) s(ms);
}

/**
 * Resolve one frame's timestamps and publish the duration, at most one
 * resolve in flight.
 *
 * A concurrent resolve recycles no queries and hands back the SAME promise,
 * so resolving unconditionally every frame publishes one frame's duration
 * once per coalesced caller — which inflates the sample count `noiseMs`
 * divides by (README.md § WebGPU).
 */
export function resolveAndPublishGpuFrame(renderer: GpuFrameResolver): void {
  if (resolveInFlight) return;
  resolveInFlight = true;
  void renderer
    .resolveTimestampsAsync()
    .then((ms) => { if (ms !== undefined) publishGpuFrameSample(ms); })
    // A lost device rejects, and three has already logged it. The flag must
    // clear regardless, or timing stops for the tab's lifetime.
    .catch(() => {})
    .finally(() => { resolveInFlight = false; });
}

/** Subscribe to those samples; the return value unsubscribes. Several
 *  consumers may listen at once — unlike a WebGL2 timer query, a timestamp
 *  resolve is not an exclusive resource. */
export function onGpuFrameSample(fn: Subscriber): () => void {
  subscribers.add(fn);
  return () => { subscribers.delete(fn); };
}
