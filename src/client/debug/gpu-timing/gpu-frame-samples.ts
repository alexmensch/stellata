// Whole-frame GPU durations the render loop measures itself, fanned out
// to every consumer that wants them. See README.md § GPU timing.

type Subscriber = (ms: number) => void;

const subscribers = new Set<Subscriber>();

/** The renderer's frame-duration resolve, structurally — keeps this module
 *  off `three/webgpu` (`../../webgpu/README.md` § Import boundary). */
export interface GpuFrameResolver {
  resolveTimestampsAsync(): Promise<number | undefined>;
}

/** The renderer as far as § The resolved-uid trim reaches into it.
 *  `backend` is `unknown` on purpose: @types/three declares no
 *  `timestampQueryPool` on `Backend`, so this is past the typed surface and
 *  every level is narrowed at runtime instead. A three bump that moves any
 *  of it must leave the trim inert, never throwing inside the render loop. */
export interface TimestampPoolHost {
  backend?: unknown;
}

function clearable(v: unknown): { clear(): void } | null {
  return typeof (v as { clear?: unknown } | null)?.clear === 'function'
    ? (v as { clear(): void })
    : null;
}

/**
 * Drop the uids a resolve just recorded.
 *
 * `TimestampQueryPool.timestamps` is a `Map<uid, ms>` three writes on every
 * resolve and never clears, trimmed or deletes. Keys are `<contextUid>:f<frameId>`
 * — unique per frame — so nothing ever overwrites an entry and the Map grows
 * for the tab's life: one entry per render pass per frame, ~216k/hour at 60 fps
 * for a single pass.
 *
 * Clearing it is safe because **nothing reads it**. `resolveQueriesAsync`
 * computes its total from the mapped result buffer and its own offset list,
 * not from this Map; the only readers are `Backend.getTimestamp` /
 * `hasTimestampQuery`, which three itself never calls and stellata never
 * calls either — per-pass `gpu.*` rows have no WebGPU counterpart on purpose
 * (README.md § WebGPU). Verified against three 0.185.1.
 */
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
      // After the resolve settles, every uid it recorded is consumed — we
      // took the number it returned. Trimming here rather than before the
      // resolve is what keeps the Map bounded by one frame's passes instead
      // of the tab's whole history.
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
