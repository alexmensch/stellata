// Pure colour math: Ballesteros 2012 and its analytic inverse, the Planck
// → CIE 1931 → linear-sRGB chromaticity chain, and the LUT shape
// constants. Node-free so client code can import it.

// ---- LUT shape (must match src/client/star-pipeline/blackbody-lut-data.ts) ----

/** Number of RGB entries in the LUT. 256 keeps cache lines clean and is
 *  plenty of resolution for B-V over a 2.4-magnitude span. */
export const LUT_SIZE = 256;

/** Inclusive B-V range covered by the LUT. */
export const BV_MIN = -0.4;
export const BV_MAX = 2.0;

// ---- Ballesteros 2012 ---------------------------------------------------

/**
 * Ballesteros 2012 empirical relation: B-V → Teff in Kelvin.
 *
 *   Teff = 4600 × ( 1/(0.92(B-V) + 1.7) + 1/(0.92(B-V) + 0.62) )
 */
export function ballesterosTeff(bv: number): number {
  const a = 0.92 * bv + 1.7;
  const b = 0.92 * bv + 0.62;
  return 4600.0 * (1.0 / a + 1.0 / b);
}

/**
 * Analytic inverse of Ballesteros 2012: Teff (K) → B-V. Picks the
 * positive root of the quadratic that recovers `u = 0.92 · bv` from
 * `T = 4600 · (2u + 2.32) / (u² + 2.32u + 1.054)`. Discriminant
 * `4 + 1.1664·k²` is always positive (k = T/4600), so the inverse is
 * defined for all Teff > 0. Mirrored byte-for-byte in star.vert.glsl —
 * keep the two in sync.
 */
export function ballesterosBvFromTeff(teff: number): number {
  const k = teff / 4600.0;
  const disc = Math.sqrt(4.0 + 1.1664 * k * k);
  const u = (2.0 - 2.32 * k + disc) / (2.0 * k);
  return u / 0.92;
}

/** B-V value at LUT index i ∈ [0, LUT_SIZE-1]. Endpoints map to BV_MIN / BV_MAX. */
export function bvAtIndex(i: number): number {
  return BV_MIN + (i / (LUT_SIZE - 1)) * (BV_MAX - BV_MIN);
}

// ---- Planck spectral radiance -------------------------------------------

const H = 6.62607015e-34;   // Planck (J·s)
const C = 2.99792458e8;     // speed of light (m/s)
const KB = 1.380649e-23;    // Boltzmann (J/K)

// Visible band, 5 nm samples — matches blackbody_color.py.
const LAMBDA_NM_MIN = 380.0;
const LAMBDA_NM_MAX = 780.0;
const LAMBDA_NM_STEP = 5.0;

function planckSpectralRadiance(lambdaNm: number, tempK: number): number {
  const lam = lambdaNm * 1e-9;
  const a = (2.0 * H * C * C) / Math.pow(lam, 5);
  const exponent = (H * C) / (lam * KB * tempK);
  return a / (Math.exp(exponent) - 1.0);
}

// ---- CIE 1931 2° colour-matching functions (Wyman 2013) -----------------

function wymanGaussian(
  lam: number,
  alpha: number,
  betaLo: number,
  betaHi: number,
): number {
  const sigma = lam < alpha ? betaLo : betaHi;
  const t = (lam - alpha) / sigma;
  return Math.exp(-0.5 * t * t);
}

function cmfX(lam: number): number {
  return (
    0.362 * wymanGaussian(lam, 442.0, 16.0, 26.7) +
    1.056 * wymanGaussian(lam, 599.8, 37.9, 31.0) -
    0.065 * wymanGaussian(lam, 501.1, 20.4, 26.2)
  );
}

function cmfY(lam: number): number {
  return (
    0.821 * wymanGaussian(lam, 568.8, 46.9, 40.5) +
    0.286 * wymanGaussian(lam, 530.9, 16.3, 31.1)
  );
}

function cmfZ(lam: number): number {
  return (
    1.217 * wymanGaussian(lam, 437.0, 11.8, 36.0) +
    0.681 * wymanGaussian(lam, 459.0, 26.0, 13.8)
  );
}

// ---- XYZ → linear sRGB (D65) --------------------------------------------

const XYZ_TO_LIN_SRGB: readonly (readonly number[])[] = [
  [3.2406, -1.5372, -0.4986],
  [-0.9689, 1.8758, 0.0415],
  [0.0557, -0.2040, 1.0570],
];

/**
 * Map T (Kelvin) → linear-light sRGB triplet, peak-normalised to [0, 1].
 * Out-of-gamut negative components are clipped to zero before
 * normalisation (preserves chroma; brightness is renderer-side).
 *
 * Peak-normalised rather than luminance-normalised because the star
 * shader wants `Y = 1` and a Y-normalised triplet runs to 1.88 at the
 * blue end — outside what the uint8 table can hold. The shader divides
 * by `dot(rgb, LUMA_WEIGHTS)` instead; see
 * `src/client/star-pipeline/README.md` § Physical-luminance emission.
 */
export function blackbodyToLinearSrgb(tempK: number): [number, number, number] {
  // Trapezoidal integration over the visible band.
  let X = 0;
  let Y = 0;
  let Z = 0;
  let prevS = planckSpectralRadiance(LAMBDA_NM_MIN, tempK);
  let prevX = prevS * cmfX(LAMBDA_NM_MIN);
  let prevY = prevS * cmfY(LAMBDA_NM_MIN);
  let prevZ = prevS * cmfZ(LAMBDA_NM_MIN);
  for (let lam = LAMBDA_NM_MIN + LAMBDA_NM_STEP; lam <= LAMBDA_NM_MAX; lam += LAMBDA_NM_STEP) {
    const s = planckSpectralRadiance(lam, tempK);
    const xi = s * cmfX(lam);
    const yi = s * cmfY(lam);
    const zi = s * cmfZ(lam);
    X += 0.5 * (prevX + xi) * LAMBDA_NM_STEP;
    Y += 0.5 * (prevY + yi) * LAMBDA_NM_STEP;
    Z += 0.5 * (prevZ + zi) * LAMBDA_NM_STEP;
    prevX = xi;
    prevY = yi;
    prevZ = zi;
  }

  let r = XYZ_TO_LIN_SRGB[0][0] * X + XYZ_TO_LIN_SRGB[0][1] * Y + XYZ_TO_LIN_SRGB[0][2] * Z;
  let g = XYZ_TO_LIN_SRGB[1][0] * X + XYZ_TO_LIN_SRGB[1][1] * Y + XYZ_TO_LIN_SRGB[1][2] * Z;
  let b = XYZ_TO_LIN_SRGB[2][0] * X + XYZ_TO_LIN_SRGB[2][1] * Y + XYZ_TO_LIN_SRGB[2][2] * Z;

  r = Math.max(0, r);
  g = Math.max(0, g);
  b = Math.max(0, b);
  const peak = Math.max(r, g, b);
  if (peak > 0) {
    r /= peak;
    g /= peak;
    b /= peak;
  }

  return [r, g, b];
}

/**
 * A B-V colour index → the linear-sRGB chromaticity of the blackbody
 * carrying it. The whole chain the star field's per-star colour runs, in
 * one call and at full precision rather than through the quantised LUT:
 * Ballesteros → Planck → CIE 1931 → linear sRGB, peak-normalised.
 *
 * The population tints of the volumetric layers take this route
 * (`src/client/milkyway/calibration/README.md` § Population colours), so
 * a component's hue and a single star's are the same function of B-V.
 * **A stellar population is not a blackbody** — what survives the chain
 * is the colour index, not the SED behind it.
 */
export function linearSrgbFromColourIndex(bv: number): [number, number, number] {
  return blackbodyToLinearSrgb(ballesterosTeff(bv));
}
