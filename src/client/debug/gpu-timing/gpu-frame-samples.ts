// Whole-frame GPU durations the render loop measures itself, fanned out
// to every consumer that wants them. See README.md § GPU timing.

type Subscriber = (ms: number) => void;

const subscribers = new Set<Subscriber>();

/** The renderer's frame-duration resolve, structurally — keeps this module
 *  off `three/webgpu` (`../../webgpu/README.md` § Import boundary). */
export interface GpuFrameResolver {
  resolveTimestampsAsync(): Promise<number | undefined>;
}

/** `backend` is `unknown` because the trim reaches past what @types/three
 *  declares. Narrow every level at runtime: a three bump that moves the
 *  shape must leave the trim inert, never throw inside the render loop. */
export interface TimestampPoolHost {
  backend?: unknown;
}

function clearable(v: unknown): { clear(): void } | null {
  return typeof (v as { clear?: unknown } | null)?.clear === 'function'
    ? (v as { clear(): void })
    : null;
}

/** Drop the uids a resolve just recorded — three's own Map never shrinks.
 *  Why clearing is safe, and what it is worth: README.md § The resolved-uid
 *  trim. */
export function dropResolvedTimestamps(host: TimestampPoolHost): void {
  const pools = (host.backend as { timestampQueryPool?: unknown } | null | undefined)
    ?.timestampQueryPool;
  if (typeof pools !== 'object' || pools === null) return;
  for (const pool of Object.values(pools as Record<string, unknown>)) {
    clearable((pool as { timestamps?: unknown } | null)?.timestamps)?.clear();
  }
}

let resolveInFlight = false;
let impossibleSeen = false;

/** Publish one frame's measured GPU milliseconds. WebGPU only — a WebGL2
 *  frame is timed by whichever GL timer owns the context's single query
 *  slot, so publishing here too would record `gpu.frame` twice per frame. */
export function publishGpuFrameSample(ms: number): void {
  for (const s of subscribers) s(ms);
}

/** False once the backend has resolved a duration no frame can have, which
 *  latches for the tab: a granted `timestamp-query` is necessary but not
 *  sufficient (README.md § A granted feature can still resolve garbage). */
export function gpuFrameSamplesAreSound(): boolean {
  return !impossibleSeen;
}

function publishResolved(ms: number | undefined): void {
  // undefined is the withheld feature; 0 is three's own seed, returned from
  // the early-outs that resolve nothing.
  if (ms === undefined || ms === 0) return;
  if (Number.isFinite(ms) && ms > 0) {
    publishGpuFrameSample(ms);
    return;
  }
  if (impossibleSeen) return;
  impossibleSeen = true;
  console.warn(
    `[gpu.frame] the backend resolved ${ms} ms for one frame. Impossible, so ` +
    'this and every later sample is dropped: the HUD headline falls back to ' +
    'submit and priceFrame to rAF-delta.',
  );
}

/**
 * Resolve one frame's timestamps and publish the duration, at most one
 * resolve in flight.
 *
 * A concurrent resolve recycles no queries and hands back the SAME promise,
 * so resolving unconditionally every frame publishes one frame's duration
 * once per coalesced caller — which inflates the sample count `noiseMs`
 * divides by (README.md § WebGPU).
 *
 * `timestampsLive` is the boot probe's verdict
 * (`../../webgpu/seam.ts` `timestampsAvailable`), and false skips the
 * backend call entirely: three's `initTimestampQuery` allocates no pool
 * once tracking is off, so there is no pool left to recycle and a resolve
 * would only trip its own `warnOnce`.
 */
export function resolveAndPublishGpuFrame(
  renderer: GpuFrameResolver & TimestampPoolHost,
  timestampsLive: boolean,
): void {
  if (!timestampsLive) return;
  if (resolveInFlight) return;
  resolveInFlight = true;
  void renderer
    .resolveTimestampsAsync()
    .then(publishResolved)
    // A lost device rejects, and three has already logged it. The flag must
    // clear regardless, or timing stops for the tab's lifetime.
    .catch(() => {})
    .finally(() => {
      resolveInFlight = false;
      // Only after the resolve settles: trimming earlier would race the
      // write three does inside resolveQueriesAsync.
      dropResolvedTimestamps(renderer);
    });
}

/** Subscribe to those samples; the return value unsubscribes. Several
 *  consumers may listen at once — unlike a WebGL2 timer query, a timestamp
 *  resolve is not an exclusive resource. */
export function onGpuFrameSample(fn: Subscriber): () => void {
  subscribers.add(fn);
  return () => { subscribers.delete(fn); };
}
