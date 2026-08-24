// Resident-texture accounting and the eviction choice over it. Why a budget
// exists at all, and what the numbers are: README.md § Staying inside VRAM.

import { MIP_CHAIN_FACTOR } from '../../../util/texture-bytes-pure';

/**
 * Ceiling on resident planet-map VRAM before least-recently-drawn maps are
 * released.
 *
 * Sized on the worst LEGITIMATE working set rather than a round number: one
 * body parked at the camera floor on a high-DPI display, which is Earth at
 * its 8192 colour rung (179 MB) plus its own 8192 normal map and 4096 horizon
 * pair (179 MB together) — 358 MB for the one body the camera is actually
 * looking at. The rest is headroom for the handful of distant bodies holding
 * 1024s at 2.8 MB each.
 *
 * A device that cannot afford this does not break, it just evicts more often,
 * and a re-fetch comes off the HTTP cache. What the budget prevents is the
 * unbounded case: before it existed nothing was ever released, so a session
 * that visited the Moon, Earth and Mars held ~980 MB until the layer was
 * torn down.
 */
export const TEXTURE_VRAM_BUDGET_BYTES = 512 * 1024 * 1024;

/**
 * `TEXTURE_VRAM_BUDGET_BYTES` for a device whose widest accepted texture is
 * `maxTextureSize`, which is the only capability WebGL exposes that tracks how
 * much texture memory a GPU is likely to have.
 *
 * A fixed 512 MB is a desktop number, and on a weaker device it does not merely
 * over-allocate — it is INERT, because eviction fires only above the budget. A
 * cap of 4096 both bounds what the ladder can reach and stands in for the
 * device tier, so the budget follows it. Each rung holds the same property the
 * 512 MB figure does: the worst legitimate working set — one body parked at the
 * camera floor — fits, with the rest as headroom for distant bodies.
 *
 * - `>= 8192`: 358 MB for Earth's 8192 colour + 8192 normal + 4096 horizon pair.
 * - `>= 4096`: 134 MB, that body's 4096 colour plus a 4096 horizon pair — its
 *   8192 normal map is refused outright at this cap, so relief drops out.
 * - below: 34 MB, a 2048 colour map plus a 2048 horizon pair.
 */
export function textureVramBudgetBytes(maxTextureSize: number): number {
  if (maxTextureSize >= 8192) return TEXTURE_VRAM_BUDGET_BYTES;
  if (maxTextureSize >= 4096) return 192 * 1024 * 1024;
  return 48 * 1024 * 1024;
}

/** Bytes a decoded planet map occupies once uploaded, mip chain included.
 *  `bytesPerTexel` comes from `util/texture-bytes-pure.ts`, the shared
 *  format table.
 *
 *  The chain is charged UNCONDITIONALLY here, which is deliberately not
 *  what `mipmapFactor` does for an arbitrary texture: a planet map is
 *  minified almost everywhere on the disc, so it always ships a chain and
 *  the budget must reserve for one. Don't route this through the
 *  filter-sensitive form to "DRY them up" — the two answer different
 *  questions, what a map will cost against what a texture holds.
 */
export function textureBytes(
  width: number,
  height: number,
  bytesPerTexel: number,
): number {
  return Math.round(width * height * bytesPerTexel * MIP_CHAIN_FACTOR);
}

/** What one resident map costs and when it was last drawn. */
export interface ResidentTexture {
  readonly key: string;
  readonly bytes: number;
  /** Frame counter at its last use. The current frame is never evicted. */
  readonly lastFrame: number;
}

/**
 * Keys to release to get back under `budgetBytes`, least-recently-drawn and
 * largest-first, never touching anything drawn on `currentFrame`.
 *
 * Size breaks the tie rather than being the primary key, because evicting one
 * 179 MB 8192 map beats evicting sixteen 1024s that cost nothing to hold —
 * but a map still on screen must never go, however large, or the body it
 * belongs to flips to its placeholder mid-view.
 */
export function evictionOrder(
  resident: readonly ResidentTexture[],
  budgetBytes: number,
  currentFrame: number,
): string[] {
  let total = 0;
  for (const t of resident) total += t.bytes;
  if (total <= budgetBytes) return [];

  const candidates = resident
    .filter((t) => t.lastFrame !== currentFrame)
    .sort((a, b) => a.lastFrame - b.lastFrame || b.bytes - a.bytes);

  const out: string[] = [];
  for (const t of candidates) {
    if (total <= budgetBytes) break;
    out.push(t.key);
    total -= t.bytes;
  }
  return out;
}

/**
 * Rungs of one body to release once `shownWidth` is the one drawn — every
 * other rung it holds, narrower OR wider.
 *
 * A body keeps exactly one ready colour rung. Narrower ones are dead because
 * the demand has outgrown them; wider ones are dead because selection only
 * ever drops after the body has shrunk well past them (the hysteresis band in
 * `texture-ladder.ts`), so they are memory the screen cannot show. Freeing
 * both here rather than waiting for budget pressure is what keeps resident
 * memory tracking demand instead of tracking the session's high-water mark.
 *
 * A rung still LOADING is not resident and so is not passed in — the swap
 * only happens once its replacement is fully uploaded.
 */
export function otherRungs(
  residentWidths: readonly number[],
  shownWidth: number,
): number[] {
  return residentWidths.filter((w) => w !== shownWidth);
}
