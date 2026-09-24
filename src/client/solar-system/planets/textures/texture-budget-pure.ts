// Resident-texture accounting and the eviction choice over it. Why a budget
// exists at all, and what the numbers are: README.md#staying-inside-vram.

import { MIP_CHAIN_FACTOR } from '../../../util/texture-bytes-pure';

const MIB = 1024 * 1024;

/** Every body's pinned 1024 plus one body at mid range — README.md#staying-inside-vram.
 * */
export const TEXTURE_VRAM_BUDGET_BYTES = 192 * MIB;

/** The pinned 1024 set alone: where repeated out-of-memory step-downs stop. */
export const TEXTURE_BUDGET_FLOOR_BYTES = 64 * MIB;

/** The WebGPU spec default for `maxTextureDimension2D`. three requests no
 *  raised limits, so this is every device's limit. */
export const DEVICE_MAX_TEXTURE_SIZE = 8192;

export const MIN_TEXTURE_CAP = 2048;

export interface TextureLimits {
  readonly budgetBytes: number;
  readonly maxTextureSize: number;
}

export const INITIAL_TEXTURE_LIMITS: TextureLimits = {
  budgetBytes: TEXTURE_VRAM_BUDGET_BYTES,
  maxTextureSize: DEVICE_MAX_TEXTURE_SIZE,
};

/** Null once both limits are at their floors. */
export function steppedTextureLimits(limits: TextureLimits): TextureLimits | null {
  const next = {
    budgetBytes: Math.max(TEXTURE_BUDGET_FLOOR_BYTES, limits.budgetBytes / 2),
    maxTextureSize: Math.max(MIN_TEXTURE_CAP, limits.maxTextureSize / 2),
  };
  const moved = next.budgetBytes !== limits.budgetBytes
    || next.maxTextureSize !== limits.maxTextureSize;
  return moved ? next : null;
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
  /** A body's floor rung, which is never evicted either. */
  readonly pinned: boolean;
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
    .filter((t) => t.lastFrame !== currentFrame && !t.pinned)
    .sort((a, b) => a.lastFrame - b.lastFrame || b.bytes - a.bytes);

  const out: string[] = [];
  for (const t of candidates) {
    if (total <= budgetBytes) break;
    out.push(t.key);
    total -= t.bytes;
  }
  return out;
}

/** README.md#staying-inside-vram. A rung still LOADING is not resident
 *  and so is not passed in. */
export function otherRungs(
  residentWidths: readonly number[],
  shownWidth: number,
  floorWidth: number,
): number[] {
  return residentWidths.filter((w) => w !== shownWidth && w !== floorWidth);
}
