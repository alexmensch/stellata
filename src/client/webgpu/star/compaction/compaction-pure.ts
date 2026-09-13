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

/** Byte offset of `tier`'s slot — what the geometry's indirectOffset takes. */
export function tierArgsOffsetBytes(tier: StarTier): number {
  return tier * INDIRECT_ARGS_STRIDE * Uint32Array.BYTES_PER_ELEMENT;
}

/** The args buffer as uploaded once: every slot draws the quad's
 *  `indexCount` indices over zero instances until the kernel counts. */
export function initialIndirectArgs(indexCount: number): Uint32Array {
  const args = new Uint32Array(STAR_TIERS.length * INDIRECT_ARGS_STRIDE);
  for (const tier of STAR_TIERS) args[tier * INDIRECT_ARGS_STRIDE] = indexCount;
  return args;
}
