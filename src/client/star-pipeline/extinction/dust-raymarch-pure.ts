// CPU mirror of dust-raymarch.glsl / dust-raymarch-tsl.ts — README.md § The march.

export const DUST_TAP_PC = 10;
export const DUST_TAPS_MIN = 4;
export const DUST_TAPS_MAX = 96;

/** A segment component smaller than this is axis-parallel to the slab: its
 *  entry/exit parameters would be ~1e9 and lie outside [0, 1] anyway. */
export const SLAB_PARALLEL_EPS_PC = 1e-6;

/** Canonical interstellar reddening ratio A_V / E(B-V) (CCM 1989,
 *  diffuse ISM). Single global value — mirrors `R_V` in star.vert.glsl.
 *  The density-dependent R_V(ρ) upgrade is a no-op at our voxel-scale
 *  column ceiling (peak A_V ≈ 2.7); see docs/science-molecular-clouds.md § 6. */
export const R_V = 3.1;

export interface DustDecodeParams {
  /** Half-extent of the voxel cube in pc; maps [-bounds,+bounds]→[0,1]. */
  boundsPc: number;
  /** Low end of the log density window (E_ZGR/pc). */
  densityMin: number;
  /** ln(densityMax / densityMin) — the log-window width. */
  logRatio: number;
  /** A_V magnitudes per unit E_ZGR density per pc (manifest 2.742). */
  avPerDensityPc: number;
}

export type Vec3 = readonly [number, number, number];

/** Decode a normalised [0,1] texture sample back to E_ZGR/pc density.
 *  Inverse of build-dust.py's pure-log u8 encoding. */
export function decodeDensity(encoded: number, p: DustDecodeParams): number {
  return p.densityMin * Math.exp(encoded * p.logRatio);
}

/** Parametric overlap [t0, t1] of the segment `from + t·delta`, t ∈ [0, 1],
 *  with the cube |x|,|y|,|z| ≤ boundsPc. Empty when t1 ≤ t0. */
export function segmentCubeOverlap(from: Vec3, delta: Vec3, boundsPc: number): [number, number] {
  let t0 = 0;
  let t1 = 1;
  for (let k = 0; k < 3; k++) {
    const f = from[k];
    const d = delta[k];
    if (Math.abs(d) > SLAB_PARALLEL_EPS_PC) {
      const ta = (-boundsPc - f) / d;
      const tb = (boundsPc - f) / d;
      t0 = Math.max(t0, Math.min(ta, tb));
      t1 = Math.min(t1, Math.max(ta, tb));
    } else if (Math.abs(f) > boundsPc) {
      t0 = 1;
      t1 = 0;
    }
  }
  return [t0, t1];
}

export function dustMarchTapCount(
  inCubeLenPc: number,
  tapPc: number = DUST_TAP_PC,
  maxTaps: number = DUST_TAPS_MAX,
): number {
  return Math.min(maxTaps, Math.max(DUST_TAPS_MIN, Math.ceil(inCubeLenPc / tapPc)));
}

/** Taps to spend on a given in-cube path length. */
export type TapCountRule = (inCubeLenPc: number) => number;

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** A_V along `from`→`to` (absolute pc); `sampleEncoded(u, v, w)` is the
 *  normalised [0,1] texture read at volume coordinates. */
export function dustRaymarchAv(
  from: Vec3,
  to: Vec3,
  sampleEncoded: (u: number, v: number, w: number) => number,
  p: DustDecodeParams,
  tapCount: TapCountRule = dustMarchTapCount,
): number {
  const delta: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const lenPc = Math.hypot(delta[0], delta[1], delta[2]);
  if (lenPc < 0.001) return 0;
  const [t0, t1] = segmentCubeOverlap(from, delta, p.boundsPc);
  if (t1 <= t0) return 0;
  const inCubeLenPc = (t1 - t0) * lenPc;
  const taps = tapCount(inCubeLenPc);
  const invRange = 0.5 / p.boundsPc;

  let accumDensity = 0;
  for (let i = 0; i < taps; i++) {
    const t = t0 + (t1 - t0) * ((i + 0.5) / taps);
    const u = clamp01((from[0] + delta[0] * t) * invRange + 0.5);
    const v = clamp01((from[1] + delta[1] * t) * invRange + 0.5);
    const w = clamp01((from[2] + delta[2] * t) * invRange + 0.5);
    accumDensity += decodeDensity(sampleEncoded(u, v, w), p);
  }
  return accumDensity * (inCubeLenPc / taps) * p.avPerDensityPc;
}

export function ebvFromAv(av: number, rV: number = R_V): number {
  return av / rV;
}

/** Dust-reddened LUT-input B-V: the intrinsic colour shifted redward by
 *  E(B-V). Mirrors `effectiveCi = intrinsicBv + absorbAV / R_V` in
 *  star.vert.glsl (excluding the per-frame pulsation swing). */
export function reddenedBv(
  intrinsicBv: number,
  av: number,
  rV: number = R_V,
): number {
  return intrinsicBv + ebvFromAv(av, rV);
}
