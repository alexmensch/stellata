// Whole-frame GPU durations the render loop measures itself — the render
// passes on one channel, the compute passes on another — fanned out to
// every consumer that wants them. See README.md § GPU timing.

type Subscriber = (ms: number) => void;

/** three keeps one timestamp pool per pass type and resolves them
 *  separately; a resolve of one recycles nothing in the other. */
export type TimestampPool = 'render' | 'compute';

/** The HUD row the compute channel lands as (`gpu.compute`), beside the
 *  render passes' `gpu.frame` (`./gpu-timer.ts` GPU_WHOLE_FRAME_SCOPE). */
export const GPU_COMPUTE_SCOPE = 'compute';

const subscribers: Record<TimestampPool, Set<Subscriber>> = {
  render: new Set(),
  compute: new Set(),
};

/** The renderer's frame-duration resolve, structurally — keeps this module
 *  off `three/webgpu` (`../../webgpu/README.md` § Import boundary). */
export interface GpuFrameResolver {
  resolveTimestampsAsync(type: TimestampPool): Promise<number | undefined>;
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

/** Publish one frame's render-pass GPU milliseconds. WebGPU only — a WebGL2
 *  frame is timed by whichever GL timer owns the context's single query
 *  slot, so publishing here too would record `gpu.frame` twice per frame. */
export function publishGpuFrameSample(ms: number): void {
  for (const s of subscribers.render) s(ms);
}

/** Publish one frame's compute-pass GPU milliseconds — the star compaction
 *  every rendered frame, plus the extinction prepass on the frames it
 *  recomputes. Never folded into `gpu.frame`: README.md § WebGPU. */
export function publishGpuComputeSample(ms: number): void {
  for (const s of subscribers.compute) s(ms);
}

/** False once the backend has resolved a duration no frame can have, which
 *  latches for the tab: a granted `timestamp-query` is necessary but not
 *  sufficient (README.md § A granted feature can still resolve garbage). */
export function gpuFrameSamplesAreSound(): boolean {
  return !impossibleSeen;
}

function publishResolved(pool: TimestampPool, ms: number | undefined): void {
  // undefined is the withheld feature, or a pool no pass has allocated yet;
  // 0 is three's own seed, returned from the early-outs that resolve nothing.
  if (ms === undefined || ms === 0) return;
  if (Number.isFinite(ms) && ms > 0) {
    for (const s of subscribers[pool]) s(ms);
    return;
  }
  if (impossibleSeen) return;
  impossibleSeen = true;
  console.warn(
    `[gpu.${pool === 'render' ? 'frame' : 'compute'}] the backend resolved ${ms} ms for one ` +
    'frame. Impossible, so this and every later sample is dropped: the HUD ' +
    'headline falls back to submit and priceFrame to rAF-delta.',
  );
}

/**
 * Resolve one frame's timestamps — both pools, in one cycle — and publish
 * each pool's duration to its own channel, at most one cycle in flight.
 *
 * A concurrent resolve recycles no queries and hands back the SAME promise,
 * so resolving unconditionally every frame publishes one frame's duration
 * once per coalesced caller — which inflates the sample count `noiseMs`
 * divides by (README.md § WebGPU). One guard over both pools rather than one
 * each: three tags every query with the renderer's frame counter, so two
 * pools resolved together answer for the same frame.
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
  void Promise.all([
    renderer.resolveTimestampsAsync('render'),
    renderer.resolveTimestampsAsync('compute'),
  ])
    .then(([render, compute]) => {
      publishResolved('render', render);
      publishResolved('compute', compute);
    })
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

/** Subscribe to the render-pass samples; the return value unsubscribes.
 *  Several consumers may listen at once — unlike a WebGL2 timer query, a
 *  timestamp resolve is not an exclusive resource. */
export function onGpuFrameSample(fn: Subscriber): () => void {
  subscribers.render.add(fn);
  return () => { subscribers.render.delete(fn); };
}

/** Subscribe to the compute-pass samples, published from the same resolve
 *  cycle as the render ones. */
export function onGpuComputeSample(fn: Subscriber): () => void {
  subscribers.compute.add(fn);
  return () => { subscribers.compute.delete(fn); };
}
