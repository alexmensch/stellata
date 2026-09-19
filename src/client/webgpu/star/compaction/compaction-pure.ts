// Layout of the compaction kernel's outputs: two survivor lists in one
// buffer, and one drawIndexedIndirect argument slot per list.

/** The two survivor lists, in list order. Mask and disc draw the disc
 *  list; glow draws its own. */
export const STAR_TIER_GLOW = 0;
export const STAR_TIER_DISC = 1;
export type StarTier = typeof STAR_TIER_GLOW | typeof STAR_TIER_DISC;
export const STAR_TIERS: readonly StarTier[] = [STAR_TIER_GLOW, STAR_TIER_DISC];

/** u32 per drawIndexedIndirect slot: indexCount, instanceCount,
 *  firstIndex, baseVertex, firstInstance. */
export const INDIRECT_ARGS_STRIDE = 5;
export const INDIRECT_INSTANCE_COUNT_SLOT = 1;

/** First element of `tier`'s list inside the shared survivor buffer, which
 *  holds `count` slots per tier. */
export function tierListBase(tier: StarTier, count: number): number {
  return tier * count;
}

export function tierArgsInstanceCountElement(tier: StarTier): number {
  return tier * INDIRECT_ARGS_STRIDE + INDIRECT_INSTANCE_COUNT_SLOT;
}

/** README.md § Reading the counts back. */
export const PREFILTER_COUNT_ELEMENT = STAR_TIERS.length * INDIRECT_ARGS_STRIDE;
export const ARGS_ELEMENTS = PREFILTER_COUNT_ELEMENT + 1;

/** What the kernel's atomics left in each tier's `instanceCount`, off a
 *  copy of the args buffer — the very numbers the three draws take their
 *  instance count from — and the prefilter count beside them. */
export interface SurvivorCounts {
  glow: number;
  disc: number;
  prefilter: number;
}

export function survivorCountsFromArgs(args: Uint32Array): SurvivorCounts {
  return {
    glow: args[tierArgsInstanceCountElement(STAR_TIER_GLOW)] ?? 0,
    disc: args[tierArgsInstanceCountElement(STAR_TIER_DISC)] ?? 0,
    prefilter: args[PREFILTER_COUNT_ELEMENT] ?? 0,
  };
}

/** The extinction refill's indirect dispatch, `[workgroups, 1, 1]`: the
 *  finish kernel writes element 0 every frame from the lists it just
 *  counted (README.md § The refill dispatch). */
export const REFILL_DISPATCH_ELEMENTS = 3;
/** Threads per workgroup of the kernel dispatched at that count — the
 *  divisor the finish kernel rounds up by, so both read one constant. */
export const REFILL_WORKGROUP_SIZE = 64;

export function initialRefillDispatch(): Uint32Array {
  return Uint32Array.from([0, 1, 1]);
}

/** Byte offset of `tier`'s slot — what the geometry's indirectOffset takes. */
export function tierArgsOffsetBytes(tier: StarTier): number {
  return tier * INDIRECT_ARGS_STRIDE * Uint32Array.BYTES_PER_ELEMENT;
}

/** Extra NDC the clip test allows before culling, past the quad's own
 *  half-extent. The vertex stage forms its clip position as P·(V·p) in
 *  float32 and the kernel as (P·V)·p, so a quad whose edge sits within a
 *  few ulp of the screen edge could otherwise be listed by one and not
 *  the other; the slack is far below a pixel at any viewport. */
export const CULL_SLACK_NDC = 1e-4;

/**
 * CPU mirror of the kernel's frustum test: true when the star's quad cannot
 * touch the viewport. `clip*` is the star centre through the camera's
 * view-projection; the quad extends `pxSize / viewport` either side of it
 * in NDC (the vertex stage's `corner · pxSize / uViewport · 2` at
 * corner ±0.5), so the test is on `|clip| > w · (1 + half-extent)` with the
 * divide folded away. Behind the camera (w ≤ 0) nothing can draw.
 */
export function starQuadOffscreen(
  clipX: number,
  clipY: number,
  clipW: number,
  pxSize: number,
  viewportW: number,
  viewportH: number,
): boolean {
  if (clipW <= 0) return true;
  const boundX = clipW * (1 + pxSize / viewportW + CULL_SLACK_NDC);
  const boundY = clipW * (1 + pxSize / viewportH + CULL_SLACK_NDC);
  return Math.abs(clipX) > boundX || Math.abs(clipY) > boundY;
}

/** The args buffer as uploaded once: every slot draws the quad's
 *  `indexCount` indices over zero instances until the kernel counts. */
export function initialIndirectArgs(indexCount: number): Uint32Array {
  const args = new Uint32Array(ARGS_ELEMENTS);
  for (const tier of STAR_TIERS) args[tier * INDIRECT_ARGS_STRIDE] = indexCount;
  return args;
}
