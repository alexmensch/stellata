// CPU mirror of the Edenhofer dust raymarch + reddening in
// dust-raymarch.glsl / star.vert.glsl. Test-only; pins the shader math.
// See src/client/star-pipeline/README.md § Dust extinction.

export const DUST_STEPS = 48;

/** Canonical interstellar reddening ratio A_V / E(B-V) (CCM 1989,
 *  diffuse ISM). Single global value — mirrors `R_V` in star.vert.glsl.
 *  The density-dependent R_V(ρ) upgrade is a no-op at our voxel-scale
 *  column ceiling (peak A_V ≈ 2.7); see docs/molecular-clouds.md § 6. */
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

/** Decode a normalised [0,1] texture sample back to E_ZGR/pc density.
 *  Inverse of build-dust.py's pure-log u8 encoding. */
export function decodeDensity(encoded: number, p: DustDecodeParams): number {
  return p.densityMin * Math.exp(encoded * p.logRatio);
}

/** Integrated V-band extinction A_V along `from`→`to` (absolute pc).
 *  `sampleEncoded(u, v, w)` returns the normalised [0,1] texture value at
 *  volume coordinates; callers outside the [0,1] cube are skipped exactly
 *  as the GLSL bbox test does. Trapezoidal midpoint sum, DUST_STEPS taps. */
export function dustRaymarchAv(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  sampleEncoded: (u: number, v: number, w: number) => number,
  p: DustDecodeParams,
): number {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const lenPc = Math.hypot(dx, dy, dz);
  if (lenPc < 0.001) return 0;
  const stepPc = lenPc / DUST_STEPS;
  const invRange = 0.5 / p.boundsPc;

  let accumDensity = 0;
  for (let i = 0; i < DUST_STEPS; i++) {
    const t = (i + 0.5) / DUST_STEPS;
    const u = (from[0] + dx * t) * invRange + 0.5;
    const v = (from[1] + dy * t) * invRange + 0.5;
    const w = (from[2] + dz * t) * invRange + 0.5;
    if (u < 0 || v < 0 || w < 0 || u > 1 || v > 1 || w > 1) continue;
    accumDensity += decodeDensity(sampleEncoded(u, v, w), p);
  }
  return accumDensity * stepPc * p.avPerDensityPc;
}

/** Colour excess E(B-V) from a V-band column at the global R_V. */
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
