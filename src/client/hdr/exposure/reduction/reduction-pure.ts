// The mip reduction's math: the level sizes, the weighted 2x2 combine the
// shader runs, and the base-exposure rescale. See README.md.

/** One texel of a reduction level: the area-weighted mean of the flux
 *  channel, the max of the peak channel, and `weight` — the fraction of
 *  the level's nominal 4^k source texels this one actually represents.
 *  Level 0 is the RG16F statistic attachment itself, whose absent alpha
 *  reads as 1, which is exactly the weight it should carry. */
export interface ReductionTexel {
  mean: number;
  peak: number;
  weight: number;
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
  let numerator = 0;
  let peak = 0;
  for (const tap of taps) {
    weight += tap.weight;
    numerator += tap.weight * tap.mean;
    peak = Math.max(peak, tap.peak);
  }
  return {
    mean: weight > 0 ? numerator / weight : 0,
    peak,
    weight: weight / 4,
  };
}

/**
 * Undo the exposure the frame was rendered with. The statistic has to be
 * read at the BASE instrument exposure — the measurement feeds the term it
 * would otherwise be reading — but the attachment was written with the
 * live adapted-and-trimmed scalar, so the ratio divides back out. It is
 * the render-time scalar, not the current one: the readback lands frames
 * after the draw it measures.
 */
export function rescaleToBaseExposure(
  measured: number,
  renderExposure: number,
  baseExposure: number,
): number {
  if (renderExposure <= 0) return 0;
  return (measured * baseExposure) / renderExposure;
}
