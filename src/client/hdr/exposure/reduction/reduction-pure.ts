// The mip reduction's math: the level sizes, the weighted 2x2 combine the
// shader runs, the tile level's CPU combine and median, and the
// base-exposure rescale. See README.md.

/** One texel of a reduction level: three area-weighted means and
 *  `weight` — the fraction of the level's nominal 4^k source texels this
 *  one actually represents. */
export interface ReductionTexel {
  mean: number;
  surface: number;
  coverage: number;
  weight: number;
}

/** Level 0 is the RG16F statistic attachment, which carries only two of
 *  the three quantities: the masked mean's numerator is formed there, out
 *  of the flux channel times the mask. Its absent alpha reads as 1, which
 *  is exactly the weight it should carry. */
export function statisticTexelToReduction(fluxL: number, litMask: number): ReductionTexel {
  return { mean: fluxL, surface: fluxL * litMask, coverage: litMask, weight: 1 };
}

/** Halving with `ceil` down to 1x1, so the ragged last row and column of an
 *  odd level survive as taps rather than being dropped or duplicated. */
export function reductionLevelSizes(
  width: number,
  height: number,
): readonly (readonly [number, number])[] {
  const levels: [number, number][] = [];
  let w = Math.max(1, Math.floor(width));
  let h = Math.max(1, Math.floor(height));
  while (w > 1 || h > 1) {
    w = Math.max(1, Math.ceil(w / 2));
    h = Math.max(1, Math.ceil(h / 2));
    levels.push([w, h]);
  }
  return levels;
}

/** Texel count the chain aims to stop at. The tile grid is the estimator's
 *  resolution, not a change of quantity — a coverage-weighted tile median
 *  converges on the per-texel one as tiles shrink — so the target is a
 *  budget rather than a calibration: ~1024 tiles keep the readback in the
 *  tens of kilobytes while a parked body still spans ~70 of them
 *  (README.md § The tile level). */
export const REDUCTION_TILE_TEXELS = 1024;

/** The levels the chain actually draws: the halving sequence truncated at
 *  the level whose texel count is nearest `REDUCTION_TILE_TEXELS` in log
 *  ratio, which is the last one and therefore the RGBA32F one. Nearest in
 *  LOG ratio rather than in absolute count, because the sequence quarters:
 *  the two candidates either side of the target are a factor 4 apart and
 *  the ratio is what says which is closer. */
export function reductionChainSizes(
  width: number,
  height: number,
): readonly (readonly [number, number])[] {
  const sizes = reductionLevelSizes(width, height);
  let best = 0;
  let bestError = Infinity;
  for (const [i, [w, h]] of sizes.entries()) {
    const error = Math.abs(Math.log((w * h) / REDUCTION_TILE_TEXELS));
    if (error < bestError) {
      best = i;
      bestError = error;
    }
  }
  return sizes.slice(0, best + 1);
}

/**
 * The executable spec `reduce.frag.glsl` is pinned against: combine the
 * (at most four) in-bounds parent texels of one output texel.
 *
 * The weight is what makes the chain exact on a non-power-of-two frame.
 * Each texel's weight times its level's `4^k` is the number of level-0
 * texels behind it, that product is additive down the chain, and dividing
 * by the summed weight is therefore the true area-weighted mean at every
 * level — including the 1x1, where it is the mean over the whole frame.
 */
export function combineReductionTexels(taps: readonly ReductionTexel[]): ReductionTexel {
  let weight = 0;
  let mean = 0;
  let surface = 0;
  let coverage = 0;
  for (const tap of taps) {
    weight += tap.weight;
    mean += tap.weight * tap.mean;
    surface += tap.weight * tap.surface;
    coverage += tap.weight * tap.coverage;
  }
  const norm = weight > 0 ? 1 / weight : 0;
  return {
    mean: mean * norm,
    surface: surface * norm,
    coverage: coverage * norm,
    weight: weight / 4,
  };
}

/** The three numbers one frame's tile level combines to, still in the
 *  exposure the frame was rendered with. */
export interface TileReduction {
  /** Area-weighted mean of the flux channel over the whole frame. */
  meanL: number;
  /** Frame fraction covered by a lit resolved surface. */
  coverage: number;
  /** The pin's subject: the coverage-weighted median across tiles of each
   *  tile's own masked mean. */
  discL: number;
}

/** Working store the median partitions in place — one slot per tile, so it
 *  is allocated with the level chain and reused every landing. */
export interface TileScratch {
  values: Float64Array;
  weights: Float64Array;
}

export function createTileScratch(capacity: number): TileScratch {
  return { values: new Float64Array(capacity), weights: new Float64Array(capacity) };
}

/**
 * The whole tile level, combined. `L̄` and the coverage come out EXACTLY as
 * the dropped tail of the chain would have produced them — a texel's
 * `weight · 4^k` is the count of level-0 texels behind it and that product
 * is additive, so weighting by `weight` alone across one level is the frame
 * mean.
 *
 * `discL` is where the tile level earns itself: the pin's subject is the
 * coverage-weighted MEDIAN of the tiles' own masked means, not their mean.
 * A ten-decade brightness gap cannot be pooled away by any exponent, so a
 * small blinding emitter sharing the frame with a parked body has to be
 * SEGMENTED out rather than averaged down — and a tile owning a fraction of
 * the masked area under a half cannot move a median however bright it is.
 */
export function reduceTileLevel(
  pixels: Float32Array,
  texelCount: number,
  scratch: TileScratch,
): TileReduction {
  let weight = 0;
  let meanNumerator = 0;
  let coverageNumerator = 0;
  let subjects = 0;
  for (let i = 0; i < texelCount; i++) {
    const w = pixels[4 * i + 3];
    if (w <= 0) continue;
    const coverage = pixels[4 * i + 2];
    weight += w;
    meanNumerator += w * pixels[4 * i];
    coverageNumerator += w * coverage;
    if (coverage > 0) {
      scratch.values[subjects] = pixels[4 * i + 1] / coverage;
      scratch.weights[subjects] = w * coverage;
      subjects++;
    }
  }
  if (weight <= 0) return { meanL: 0, coverage: 0, discL: 0 };
  return {
    meanL: meanNumerator / weight,
    coverage: coverageNumerator / weight,
    discL: weightedMedian(scratch, subjects),
  };
}

/**
 * The lower weighted median of `scratch.values[0..n)`: the smallest value
 * whose cumulative weight reaches half the total. Quickselect over a
 * three-way partition, so it is linear in the tile count and never sorts —
 * it runs on the main thread inside `measure()`, where a sort of ~1500
 * tiles costs several times what the whole rest of the landing does.
 *
 * PARTITIONS BOTH ARRAYS IN PLACE. The caller's scratch is refilled from
 * the readback every landing, so the shuffle is never read again.
 */
export function weightedMedian(scratch: TileScratch, n: number): number {
  const { values, weights } = scratch;
  if (n <= 0) return 0;
  let remaining = 0;
  for (let i = 0; i < n; i++) remaining += weights[i];
  remaining /= 2;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const pivot = values[lo + ((hi - lo) >> 1)];
    let less = lo;
    let scan = lo;
    let greater = hi;
    let weightLess = 0;
    let weightEqual = 0;
    while (scan <= greater) {
      const v = values[scan];
      if (v < pivot) {
        swapTiles(scratch, less, scan);
        weightLess += weights[less];
        less++;
        scan++;
      } else if (v > pivot) {
        swapTiles(scratch, scan, greater);
        greater--;
      } else {
        weightEqual += weights[scan];
        scan++;
      }
    }
    if (weightLess >= remaining) {
      hi = less - 1;
    } else if (weightLess + weightEqual >= remaining) {
      return pivot;
    } else {
      remaining -= weightLess + weightEqual;
      lo = greater + 1;
    }
  }
  return values[lo];
}

function swapTiles(scratch: TileScratch, a: number, b: number): void {
  const v = scratch.values[a];
  scratch.values[a] = scratch.values[b];
  scratch.values[b] = v;
  const w = scratch.weights[a];
  scratch.weights[a] = scratch.weights[b];
  scratch.weights[b] = w;
}

/**
 * Undo the exposure the frame was rendered with. The statistic has to be
 * read at the BASE instrument exposure — the measurement feeds the term it
 * would otherwise be reading — but the attachment was written with the
 * live adapted-and-trimmed scalar, so the ratio divides back out. It is
 * the render-time scalar, not the current one: the readback lands frames
 * after the draw it measures.
 *
 * The mask channel is a coverage fraction rather than a luminance, so it
 * is invariant to the exposure and never passes through here.
 */
export function rescaleToBaseExposure(
  measured: number,
  renderExposure: number,
  baseExposure: number,
): number {
  if (renderExposure <= 0) return 0;
  return (measured * baseExposure) / renderExposure;
}
