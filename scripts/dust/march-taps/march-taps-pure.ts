// Pure helpers for measure.ts — README.md.

import {
  SLAB_PARALLEL_EPS_PC,
  clamp01,
  decodeDensity,
  dustMarchTapCount,
  type DustDecodeParams,
  type Vec3,
} from '../../../src/client/star-pipeline/extinction/dust-raymarch-pure';

/** The fixed tap count the march spent before the path-length rule, frozen as
 *  the yardstick both this sweep and `../prefilter/cost.ts` quote against.
 *  Deliberately not `DUST_TAP_PC`-derived: a retune must not move the
 *  baseline the older cost tables were written against. */
export const FIXED_MARCH_TAPS = 48;

export interface ErrorSummary {
  p50: number;
  p90: number;
  p99: number;
  max: number;
}

/** Nearest-rank percentile over an ascending array. */
export function percentile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[rank];
}

export function summarise(errors: readonly number[]): ErrorSummary {
  const sorted = [...errors].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    p99: percentile(sorted, 0.99),
    max: sorted[sorted.length - 1] ?? NaN,
  };
}

/** `n` indices spread evenly over `[0, count)`, deterministic. */
export function strideSample(count: number, n: number): number[] {
  const take = Math.min(n, count);
  const out: number[] = [];
  for (let i = 0; i < take; i++) out.push(Math.floor((i * count) / take));
  return out;
}

const f = Math.fround;

/** `dustRaymarchAv` rounded to single precision at every operation — the
 *  arithmetic the GLSL chunk and the TSL twin actually evaluate. Prices the
 *  GEOMETRY only: the sampler's sub-texel interpolation and the GPU's own
 *  `exp` carry error this does not model. README.md § Reading a result. */
export function fp32March(
  from: Vec3,
  to: Vec3,
  sampleEncoded: (u: number, v: number, w: number) => number,
  p: DustDecodeParams,
): number {
  const a: Vec3 = [f(from[0]), f(from[1]), f(from[2])];
  const d: Vec3 = [f(f(to[0]) - a[0]), f(f(to[1]) - a[1]), f(f(to[2]) - a[2])];
  const lenPc = f(Math.sqrt(f(f(f(d[0] * d[0]) + f(d[1] * d[1])) + f(d[2] * d[2]))));
  if (lenPc < 0.001) return 0;

  const bounds = f(p.boundsPc);
  let t0 = 0;
  let t1 = 1;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]) > SLAB_PARALLEL_EPS_PC) {
      const ta = f(f(-bounds - a[k]) / d[k]);
      const tb = f(f(bounds - a[k]) / d[k]);
      t0 = Math.max(t0, Math.min(ta, tb));
      t1 = Math.min(t1, Math.max(ta, tb));
    } else if (Math.abs(a[k]) > bounds) {
      t0 = 1;
      t1 = 0;
    }
  }
  if (t1 <= t0) return 0;

  const span = f(t1 - t0);
  const inCubeLenPc = f(span * lenPc);
  const taps = dustMarchTapCount(inCubeLenPc);
  const invRange = f(0.5 / bounds);
  let accumDensity = 0;
  for (let i = 0; i < taps; i++) {
    const t = f(t0 + f(span * f(f(i + 0.5) / taps)));
    const at = (k: number) => clamp01(f(f(f(a[k] + f(d[k] * t)) * invRange) + 0.5));
    accumDensity = f(accumDensity + f(decodeDensity(sampleEncoded(at(0), at(1), at(2)), p)));
  }
  return f(f(accumDensity * f(inCubeLenPc / taps)) * p.avPerDensityPc);
}

export function unclippedFixedMarch(
  from: Vec3,
  to: Vec3,
  sampleEncoded: (u: number, v: number, w: number) => number,
  p: DustDecodeParams,
  taps: number,
): number {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const lenPc = Math.hypot(dx, dy, dz);
  if (lenPc < 0.001) return 0;
  const stepPc = lenPc / taps;
  const invRange = 0.5 / p.boundsPc;
  let accumDensity = 0;
  for (let i = 0; i < taps; i++) {
    const t = (i + 0.5) / taps;
    const u = (from[0] + dx * t) * invRange + 0.5;
    const v = (from[1] + dy * t) * invRange + 0.5;
    const w = (from[2] + dz * t) * invRange + 0.5;
    if (u < 0 || v < 0 || w < 0 || u > 1 || v > 1 || w > 1) continue;
    accumDensity += decodeDensity(sampleEncoded(u, v, w), p);
  }
  return accumDensity * stepPc * p.avPerDensityPc;
}
