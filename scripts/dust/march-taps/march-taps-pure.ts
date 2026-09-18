// Pure helpers for measure.ts — README.md.

import {
  decodeDensity,
  type DustDecodeParams,
  type Vec3,
} from '../../../src/client/star-pipeline/extinction/dust-raymarch-pure';

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
