// Whole-frame GPU durations the render loop measures itself — the render
// passes on one channel, the compute passes on another — fanned out to
// every consumer that wants them. See README.md § GPU timing.

type Subscriber = (ms: number) => void;

/** README.md § `gpu.frame` is the only row that prices anything. */
export const GPU_WHOLE_FRAME_SCOPE = 'frame';

/** three keeps one timestamp pool per pass type and resolves them
 *  separately; a resolve of one recycles nothing in the other. */
export type TimestampPool = 'render' | 'compute';

export const GPU_COMPUTE_SCOPE = 'compute';

/** Which `gpu.*` row a pool fills. One mapping, so the channel, the HUD and
 *  a dropped-sample warning cannot disagree about a pool's name. */
const POOL_SCOPE: Record<TimestampPool, string> = {
  render: GPU_WHOLE_FRAME_SCOPE,
  compute: GPU_COMPUTE_SCOPE,
};

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

/** Why clearing is safe, and what it is worth: README.md § The resolved-uid
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
const unsound: Record<TimestampPool, boolean> = { render: false, compute: false };

function publish(pool: TimestampPool, ms: number): void {
  for (const s of subscribers[pool]) s(ms);
}

export function publishGpuFrameSample(ms: number): void {
  publish('render', ms);
}

/** Never folded into `gpu.frame`: README.md § `gpu.frame` is the only row that prices anything. */
export function publishGpuComputeSample(ms: number): void {
  publish('compute', ms);
}

/** False once the RENDER pool has resolved a duration no frame can have,
 *  which latches for the tab: a granted `timestamp-query` is necessary but
 *  not sufficient (README.md § A granted feature can still resolve garbage). */
export function gpuFrameSamplesAreSound(): boolean {
  return !unsound.render;
}

/** The same verdict for the compute pool. Latched per pool: `gpu.frame` is
 *  what every committed pin row gates on, so a compute pool resolving
 *  nonsense must not take the frame clock down with it. */
export function gpuComputeSamplesAreSound(): boolean {
  return !unsound.compute;
}

function publishResolved(pool: TimestampPool, ms: number | undefined): void {
  // undefined is the withheld feature, or a pool no pass has allocated yet;
  // 0 is three's own seed, returned from the early-outs that resolve nothing.
  if (ms === undefined || ms === 0) return;
  if (Number.isFinite(ms) && ms > 0) {
    publish(pool, ms);
    return;
  }
  if (unsound[pool]) return;
  unsound[pool] = true;
  console.warn(
    `[gpu.${POOL_SCOPE[pool]}] the backend resolved ${ms} ms for one frame. ` +
    `Impossible, so this and every later ${pool} sample is dropped. ` +
    (pool === 'render'
      ? 'The HUD headline falls back to submit and priceFrame to rAF-delta.'
      : 'The gpu.frame row is unaffected — the pools latch separately.'),
  );
}

/**
 * Resolve one frame's timestamps — both pools, in one cycle — and publish
 * each pool's duration to its own channel.
 *
 * Why at most one cycle is in flight, and why one guard covers both pools
 * rather than one each: README.md § An exact frame total, and no per-pass rows at all.
 *
 * `timestampsLive` is the boot probe's verdict
 * (`../../webgpu/seam.ts` `timestampsAvailable`); false skips the backend
 * call, which has no pool to recycle and would only trip three's `warnOnce`.
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
 *  Several consumers may listen at once — a timestamp resolve is not an
 *  exclusive resource. */
export function onGpuFrameSample(fn: Subscriber): () => void {
  subscribers.render.add(fn);
  return () => { subscribers.render.delete(fn); };
}

export function onGpuComputeSample(fn: Subscriber): () => void {
  subscribers.compute.add(fn);
  return () => { subscribers.compute.delete(fn); };
}
