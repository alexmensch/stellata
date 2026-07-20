// CPU mirror of the presence-pass shader math in cloud.frag.glsl:
// octave ladder, PCG3D/quintic value noise, band-limit fade, Plummer
// density, absorption alpha. Physics: docs/molecular-clouds.md §§ 4–5, 9.

/** `noiseModel` block of clouds.json v2 (docs/molecular-clouds.md § 5.2). */
export interface NoiseModel {
  lacunarity: number;
  betaSpectral: number;
  lambdaMinPc: number;
  domainStretchMajor: number;
  noiseClampSigma: number;
  ridgedFinestCount: number;
  ridgedExponent: Record<'dark' | 'sf' | 'hii', number>;
  sigmaS: Record<'dark' | 'sf' | 'hii', number>;
}

/** Uniform-array budget for the per-cloud octave ladder in the presence
 *  shader. Must hold the largest cloud's ladder (asserted in
 *  cloud-presence-pure.test.ts against the built clouds.json). */
export const MAX_OCTAVES = 12;

/** τ_V = 0.921 · A_V (A_V = 1.086 τ_V). */
export const TAU_PER_AV = 0.921;

/** A_V rate [mag/pc] per n_H [cm⁻³] (docs/molecular-clouds.md § 2). */
export const AV_RATE_PER_NH = 1.65e-3;

/** Scale that brings the quintic value noise (uniform [-1, 1] lattice
 *  values) to approximately unit variance, so the σ_s log-normal maths
 *  in § 5.2 applies directly to the octave sum. Pinned against the
 *  measured sample std in cloud-presence-pure.test.ts. */
export const NOISE_NORM = 2.49;

export interface OctaveLadder {
  /** Wavelengths in pc, coarsest first (= the cloud's major diameter). */
  lambdasPc: number[];
  /** Per-octave amplitudes, Σ amps² = 1. */
  amps: number[];
}

/**
 * One geometric octave sequence from the cloud's major diameter down to
 * `lambdaMinPc`, per-octave variance ratio `2^(3 − betaSpectral)` toward
 * finer scales, amplitudes normalised to unit total variance.
 */
export function buildOctaveLadder(
  majorDiameterPc: number,
  nm: Pick<NoiseModel, 'lacunarity' | 'betaSpectral' | 'lambdaMinPc'>,
): OctaveLadder {
  const lambdasPc: number[] = [];
  for (let l = majorDiameterPc; l >= nm.lambdaMinPc; l /= nm.lacunarity) {
    lambdasPc.push(l);
  }
  const ratio = 2 ** (3 - nm.betaSpectral);
  const variances = lambdasPc.map((_, k) => ratio ** k);
  const total = variances.reduce((a, b) => a + b, 0);
  return { lambdasPc, amps: variances.map((v) => Math.sqrt(v / total)) };
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}

/**
 * Band-limit fade for an octave inside the raymarch integral
 * (docs/molecular-clouds.md § 9.1 rule 1): 0 below λ = 2Δ, full
 * contribution from λ = 4Δ, smoothstep between — never a hard cut.
 */
export function bandLimitFade(lambdaPc: number, stepPc: number): number {
  return smoothstep(1, 2, lambdaPc / (2 * stepPc));
}

/**
 * Calibrated Plummer density [cm⁻³] at ellipsoidal radius `u`
 * (docs/molecular-clouds.md § 4.1): profile radius is `u · sMin`, the
 * mass-budget envelope cuts smoothly at `uEnv`.
 */
export function cloudModelDensity(
  u: number,
  sMinPc: number,
  n0Cal: number,
  rflatPc: number,
  p: number,
  uEnv: number,
): number {
  const envelope = 1 - smoothstep(0.85 * uEnv, uEnv, u);
  if (envelope <= 0) return 0;
  const q = (u * sMinPc) / rflatPc;
  return n0Cal * (1 + q * q) ** (-p / 2) * envelope;
}

/** Absorption opacity from a raymarched A_V column (§ 9): capped so the
 *  densest core never fully blacks out the background. */
export function absorptionAlpha(av: number): number {
  return Math.min(1 - Math.exp(-TAU_PER_AV * av), 0.95);
}

/** Analytic mean of the ridged shape `(1 − |g|)^e` for g ~ U[-1, 1] —
 *  subtracted in the shader so the ridged fine octaves are zero-mean. */
export function ridgedShapeMean(exponent: number): number {
  return 1 / (exponent + 1);
}

// --- PCG3D hash + quintic value noise (exact mirror of cloud.frag.glsl) ---

const U32 = 0xffffffff;

function pcg3d(x: number, y: number, z: number): number {
  let vx = (Math.imul(x, 1664525) + 1013904223) >>> 0;
  let vy = (Math.imul(y, 1664525) + 1013904223) >>> 0;
  let vz = (Math.imul(z, 1664525) + 1013904223) >>> 0;
  vx = (vx + Math.imul(vy, vz)) >>> 0;
  vy = (vy + Math.imul(vz, vx)) >>> 0;
  vz = (vz + Math.imul(vx, vy)) >>> 0;
  vx ^= vx >>> 16;
  vy ^= vy >>> 16;
  vz ^= vz >>> 16;
  vx = (vx + Math.imul(vy, vz)) >>> 0;
  vy = (vy + Math.imul(vz, vx)) >>> 0;
  vz = (vz + Math.imul(vx, vy)) >>> 0;
  return vx;
}

/** Lattice value in [-1, 1] at integer cell (cx, cy, cz) under `seed`. */
export function latticeValue(cx: number, cy: number, cz: number, seed: number): number {
  const h = pcg3d((cx + seed) >>> 0, (cy + seed) >>> 0, (cz + seed) >>> 0);
  return (h / U32) * 2 - 1;
}

function quintic(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Quintic-interpolated lattice value noise in [-1, 1]. */
export function valueNoise(px: number, py: number, pz: number, seed: number): number {
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const iz = Math.floor(pz);
  const wx = quintic(px - ix);
  const wy = quintic(py - iy);
  const wz = quintic(pz - iz);
  let acc = 0;
  for (let dz = 0; dz <= 1; dz++) {
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        const v = latticeValue(ix + dx, iy + dy, iz + dz, seed);
        acc +=
          v *
          (dx ? wx : 1 - wx) *
          (dy ? wy : 1 - wy) *
          (dz ? wz : 1 - wz);
      }
    }
  }
  return acc;
}
