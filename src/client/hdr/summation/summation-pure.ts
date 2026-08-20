// The rod-summation convolution's kernel and resolution budget: patch
// radius in pixels, the downsample factor that bounds the tap count, and the
// disc's area-overlap weights. CPU mirror of summation.glsl — see README.md.

/**
 * Radius of the eye's summation patch in **CSS pixels**.
 *
 * `Ω_sum` is fixed in angle and `Ω_px` is not, so this is the one quantity in
 * the pass that moves with FOV — and it is why the convolution has to be
 * resolution-adaptive rather than a fixed-radius blur.
 */
export function summationRadiusPx(
  omegaSummationArcsec2: number,
  omegaPxArcsec2: number,
): number {
  return Math.sqrt(
    omegaSummationArcsec2 / (Math.PI * Math.max(omegaPxArcsec2, 1e-12)),
  );
}

/** Texel radius the downsample factor aims the kernel at. Below ~2 the
 *  disc quadrature loses accuracy fast (0.09 mag at 2, 0.37 at 1); above ~4
 *  it buys 0.01 mag for a quadratically growing tap count. */
export const TARGET_KERNEL_RADIUS_TEXELS = 3;

/** Rounding to the nearest factor lets the kernel run out to 4.5 texels
 *  before the next factor takes over, so the loop is bounded here rather
 *  than at the target radius. */
export const MAX_KERNEL_REACH_TEXELS = 5;

/** The box loop's bound in the downsample stage, and therefore the largest
 *  factor that averages a whole cell rather than a corner of one. 32 covers a
 *  patch radius of 144 px. The radius it is compared against is in
 *  **drawing-buffer** pixels — `SummationPass` crosses the device pixel ratio
 *  before choosing a factor — so the worst reachable case is ~47 px, not the
 *  ~23 CSS px of the narrowest FOV on the tallest viewport a browser reports.
 *  Both are pinned in the test. */
export const MAX_DOWNSAMPLE = 32;

/**
 * How many display pixels one source texel of the convolution covers.
 *
 * The kernel is a flat disc, which is not separable, so the tap count is
 * quadratic in its texel radius — this is what keeps it bounded while the
 * patch's pixel radius spans 0.8 px at 120° FOV to tens of px at 10° on a
 * tall viewport. 1 means the convolution reads the diffuse attachment
 * directly and no downsample pass runs at all.
 */
export function summationDownsample(radiusPx: number): number {
  return Math.min(
    MAX_DOWNSAMPLE,
    Math.max(1, Math.round(radiusPx / TARGET_KERNEL_RADIUS_TEXELS)),
  );
}

/**
 * Fraction of the texel at integer offset `(dx, dy)` that lies inside a disc
 * of `radiusTexels` — the kernel's weight.
 *
 * A linear ramp across the last texel rather than a hard threshold, which
 * matches exact circle-square overlap to 0.001 mag and is 4x more accurate
 * than thresholding at the same tap count. Normalisation is the caller's:
 * dividing by the summed weight is what makes a **uniform** field come
 * through untouched, which is the Milky Way band's whole invariant.
 */
export function summationWeight(dx: number, dy: number, radiusTexels: number): number {
  return Math.min(1, Math.max(0, radiusTexels + 0.5 - Math.hypot(dx, dy)));
}

/**
 * Weighted mean of `sample` over the summation disc. `sample(dx, dy)` reads
 * the source texel at an integer offset from the fragment's own.
 *
 * This is the average half of average-then-gain: the caller multiplies the
 * result by `Ω_sum`, and because the mean is over an angular patch rather
 * than a pixel, the product carries no plate scale at all.
 */
export function summationMean(
  sample: (dx: number, dy: number) => number,
  radiusTexels: number,
): number {
  let acc = 0;
  let weight = 0;
  for (let dy = -MAX_KERNEL_REACH_TEXELS; dy <= MAX_KERNEL_REACH_TEXELS; dy++) {
    for (let dx = -MAX_KERNEL_REACH_TEXELS; dx <= MAX_KERNEL_REACH_TEXELS; dx++) {
      const w = summationWeight(dx, dy, radiusTexels);
      if (w <= 0) continue;
      acc += w * sample(dx, dy);
      weight += w;
    }
  }
  // No zero-weight guard: the centre tap's own weight is
  // min(1, radiusTexels + 0.5) ≥ 0.5 for any radius ≥ 0, so the division
  // is safe — a re-added fallback costs the GPU mirrors a dead texture
  // sample per pixel (WGSL select evaluates both operands).
  return acc / weight;
}
