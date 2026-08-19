// Resident-texture accounting and the eviction choice over it. Why a budget
// exists at all, and what the numbers are: README.md § Staying inside VRAM.

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

/** Bytes a decoded texture occupies once uploaded, mip chain included.
 *
 *  The full chain adds exactly 1/3 (1 + 1/4 + 1/16 + …), and it is not
 *  optional — these maps are minified almost everywhere on the disc, so
 *  dropping mips to save it would trade a third of the memory for aliasing
 *  across the whole body.
 */
export function textureBytes(
  width: number,
  height: number,
  bytesPerTexel: number,
): number {
  return Math.round((width * height * bytesPerTexel * 4) / 3);
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
 * Rungs of one body superseded by `shownWidth` — every narrower rung it
 * still holds.
 *
 * Freed as soon as the wider one is drawn rather than waiting for budget
 * pressure, because selection never downgrades: once a body is showing its
 * 8192 map, nothing will ask that body for its 2048 again. Holding the whole
 * ladder costs a third more than the top rung alone and buys nothing.
 */
export function supersededRungs(
  residentWidths: readonly number[],
  shownWidth: number,
): number[] {
  return residentWidths.filter((w) => w < shownWidth);
}
