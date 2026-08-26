// Extended-Reinhard tone-map operator, its exact inverse, and the sRGB
// transfer pair. CPU mirror of tonemap.glsl — see README.md § Operator.

export type Rgb = readonly [number, number, number];

export const L_THRESH = 0.02;
export const DR_MAG = 7.5;
export const HIGHLIGHT_DESAT = 0.35;
export const LUMA_WEIGHTS: Rgb = [0.2126, 0.7152, 0.0722];

/** The sRGB transfer function's piecewise knee and its linear slope —
 *  exported because the TSL mirror composes the same encode and must not
 *  restate the literals (`../webgpu/tonemap-tsl.ts`). */
export const SRGB_ENCODE_KNEE = 0.0031308;
export const SRGB_LINEAR_SLOPE = 12.92;
export const SRGB_ENCODE_GAIN = 1.055;
export const SRGB_ENCODE_OFFSET = 0.055;
export const SRGB_ENCODE_EXPONENT = 1 / 2.4;
export const SRGB_DECODE_KNEE = 0.04045;

/** Interleaved-gradient-noise constants of `stellataDither` — the scalar
 *  and the fragCoord dot vector. tonemap.glsl duplicates the literals
 *  (chunk-constant-drift pins them); the TSL resolve imports these. */
export const DITHER_IGN_SCALE = 52.9829189;
export const DITHER_IGN_DOT: readonly [number, number] = [0.06711056, 0.00583715];

/** Levels an 8-bit channel carries, so a ±0.5 dither spans exactly one
 *  output step. */
export const DITHER_LSB_LEVELS = 255;

/** Added to the fragment position before the output dither, so a layer
 *  that also jitters its ray start off the same noise gets an
 *  uncorrelated pattern for the two. */
export const DITHER_SEED_OFFSET = 113.7;

export function tonemapWhitePoint(drMag = DR_MAG, lThresh = L_THRESH): number {
  return lThresh * 10 ** (0.4 * drMag);
}

/** Magnitudes below the threshold at which the faint-end toe lands on
 *  black — the detection rolloff's full width. */
export const TOE_BLACK_MAG = 1.5;

/** The darkest level the encode can distinguish from black: half an
 *  8-bit output step, decoded through the sRGB linear segment. */
export const EIGHT_BIT_STEP_L = 0.5 / 255 / SRGB_LINEAR_SLOPE;

/** Displayed depth of the toe's black point, in magnitudes below the
 *  threshold's display level. */
const TOE_BLACK_DEPTH_MAG = 2.5 * Math.log10(L_THRESH / EIGHT_BIT_STEP_L);

/** Quadratic coefficient of the faint-end toe, derived so a source
 *  exactly `TOE_BLACK_MAG` under threshold lands on `EIGHT_BIT_STEP_L`.
 *  The toe maps `m` magnitudes under threshold to `m + TOE_CURVATURE·m²`
 *  displayed magnitudes under it — slope 1 at the knee, so the transfer
 *  is C1 through the threshold and no isophote marks the crossing. */
export const TOE_CURVATURE =
  (TOE_BLACK_DEPTH_MAG - TOE_BLACK_MAG) / (TOE_BLACK_MAG * TOE_BLACK_MAG);

/** Detection rolloff below the threshold: sub-threshold light compresses
 *  to black over `TOE_BLACK_MAG` magnitudes instead of rendering at its
 *  near-linear Reinhard value. Identity at and above `L_THRESH`, so the
 *  threshold anchor holds. */
export function faintToe(y: number, lThresh = L_THRESH): number {
  if (y >= lThresh) return y;
  if (y <= 0) return 0;
  const magsUnder = -2.5 * Math.log10(y / lThresh);
  return lThresh * (y / lThresh) ** (1 + TOE_CURVATURE * magsUnder);
}

/** Exact inverse of `faintToe` — the chrome mapping composes it. */
export function faintToeInverse(yt: number, lThresh = L_THRESH): number {
  if (yt >= lThresh) return yt;
  if (yt <= 0) return 0;
  const depth = -2.5 * Math.log10(yt / lThresh);
  const magsUnder =
    (Math.sqrt(1 + 4 * TOE_CURVATURE * depth) - 1) / (2 * TOE_CURVATURE);
  return lThresh * 10 ** (-0.4 * magsUnder);
}

export function relativeLuminance(rgb: Rgb): number {
  return (
    rgb[0] * LUMA_WEIGHTS[0] + rgb[1] * LUMA_WEIGHTS[1] + rgb[2] * LUMA_WEIGHTS[2]
  );
}

export function reinhardExtended(y: number, whitePoint: number): number {
  return (y * (1 + y / (whitePoint * whitePoint))) / (1 + y);
}

/** Non-negative root of `reinhardExtended(y, whitePoint) = yd`. */
export function reinhardExtendedInverse(yd: number, whitePoint: number): number {
  const w2 = whitePoint * whitePoint;
  return 0.5 * w2 * (yd - 1 + Math.sqrt((1 - yd) * (1 - yd) + (4 * yd) / w2));
}

export function srgbEncode(c: number): number {
  const v = Math.min(Math.max(c, 0), 1);
  return v < SRGB_ENCODE_KNEE
    ? v * SRGB_LINEAR_SLOPE
    : SRGB_ENCODE_GAIN * v ** SRGB_ENCODE_EXPONENT - SRGB_ENCODE_OFFSET;
}

export function srgbDecode(c: number): number {
  const v = Math.min(Math.max(c, 0), 1);
  return v < SRGB_DECODE_KNEE
    ? v / SRGB_LINEAR_SLOPE
    : ((v + SRGB_ENCODE_OFFSET) / SRGB_ENCODE_GAIN) ** (1 / SRGB_ENCODE_EXPONENT);
}

/** Scalar display transfer: linear luminance → encoded sRGB, the whole
 *  chain a hue-free level comparison runs through. */
export function displayLevel(y: number, whitePoint: number): number {
  return srgbEncode(reinhardExtended(faintToe(y), whitePoint));
}

/** Linear HDR luminance → display sRGB, hue-preserving. Mirrors
 *  `stellataTonemapUndithered`: the dither is 8-bit quantisation noise
 *  applied after the operator, not part of it. */
export function tonemap(hdr: Rgb, whitePoint: number, desat = HIGHLIGHT_DESAT): Rgb {
  const y = relativeLuminance(hdr);
  if (y <= 0) return [0, 0, 0];
  const yd = reinhardExtended(faintToe(y), whitePoint);
  const white = 1 - Math.exp(-desat * Math.max(y / whitePoint - 1, 0));
  const chroma = (yd / y) * (1 - white);
  return [
    srgbEncode(hdr[0] * chroma + yd * white),
    srgbEncode(hdr[1] * chroma + yd * white),
    srgbEncode(hdr[2] * chroma + yd * white),
  ];
}

/** Emission whose tone-mapped, pre-encode value is `linearDisplay` — what
 *  a non-physical chrome layer must write to come out of the pass at its
 *  authored appearance. Exact for every authored colour: a display
 *  luminance ≤ 1 lands at or below the desaturation knee, where `tonemap`
 *  is pure luminance scaling. */
export function inverseTonemapConstant(linearDisplay: Rgb, whitePoint: number): Rgb {
  const yd = relativeLuminance(linearDisplay);
  if (yd <= 0) return [0, 0, 0];
  const scale = faintToeInverse(reinhardExtendedInverse(yd, whitePoint)) / yd;
  return [
    linearDisplay[0] * scale,
    linearDisplay[1] * scale,
    linearDisplay[2] * scale,
  ];
}
