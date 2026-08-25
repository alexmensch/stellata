// The perceptual-disc kernel's area integral — what turns the
// peak-normalised display kernel into a flux-correct one. The kernel
// itself is ./perceptual-disc-pure.ts.

/**
 * Coefficients of `perceptualDiscFluxIntegral`, in ascending powers of
 * `1/n`. A degree-4 fit over the reachable exponent range [1.32, 10] —
 * `distN·lumBias` at the corners of both morphs — good to 0.27 %, i.e.
 * 0.0029 mag of flux.
 */
export const KERNEL_FLUX_FIT: readonly number[] = [
  0.774519065, -2.002796349, 3.390374540, -3.309638782, 1.360211895,
];

/** Exponent range the fit is valid over, and the reachable range of
 *  `distN·lumBias` under the shipped debug-knob bounds. */
export const KERNEL_FLUX_FIT_N_MIN = 1.32;
export const KERNEL_FLUX_FIT_N_MAX = 10;

/**
 * Area integral of the unit-peak profile over its own quad,
 * `∫₀^½ I(r)·2πr dr`, in quad-normalised units — so a kernel `D` px across
 * covers `Φ(n)·D²` px² of unit-peak light.
 *
 * The exact integral is an incomplete gamma in `n`, hence the fit. The
 * `uDiscardThreshold` fringe the disc pass drops is deliberately NOT
 * modelled: it moves Φ by at most 0.26 % across the whole range, so one
 * integral serves both passes and nothing here tracks a debug knob.
 */
export function perceptualDiscFluxIntegral(n: number): number {
  const x = 1 / Math.max(n, 1e-6);
  let acc = 0;
  for (let i = KERNEL_FLUX_FIT.length - 1; i >= 0; i--) {
    acc = acc * x + KERNEL_FLUX_FIT[i];
  }
  return acc;
}
