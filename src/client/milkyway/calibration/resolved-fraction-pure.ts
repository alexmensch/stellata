// Layout, sampler mirror and texel values for the resolution hole.
// README.md § The resolution hole; the table itself is generated.

import { RESOLVED_HOLE_VALUES } from './resolved-hole-table';

/** Log-spaced distance shells from Sol, `RESOLVED_HOLE_DEX_PER_SHELL` wide,
 *  the first starting at 10^`RESOLVED_HOLE_LOG_DISTANCE0` pc. */
export const RESOLVED_HOLE_SHELLS = 32;
export const RESOLVED_HOLE_LOG_DISTANCE0 = 1;
export const RESOLVED_HOLE_DEX_PER_SHELL = 0.1;
/** Equal-|sin b| latitude bands from Sol — equal solid angle each. */
export const RESOLVED_HOLE_BANDS = 8;
/** Keeps `log10(d)` finite and `|z| / d` defined at Sol itself. */
export const RESOLVED_HOLE_MIN_DISTANCE_PC = 1e-6;

export interface ResolvedHoleTable {
  /** `RESOLVED_HOLE_BANDS` rows of `RESOLVED_HOLE_SHELLS`, band-major. */
  readonly values: ArrayLike<number>;
}

export const SHIPPED_RESOLVED_HOLE: ResolvedHoleTable = { values: RESOLVED_HOLE_VALUES };

export function resolvedHoleIndex(shell: number, band: number): number {
  return band * RESOLVED_HOLE_SHELLS + shell;
}

/** The `RESOLVED_HOLE_SHELLS + 1` shell edges in pc. */
export function resolvedHoleShellEdgesPc(): number[] {
  return Array.from(
    { length: RESOLVED_HOLE_SHELLS + 1 },
    (_, i) => 10 ** (RESOLVED_HOLE_LOG_DISTANCE0 + i * RESOLVED_HOLE_DEX_PER_SHELL),
  );
}

/** The `RESOLVED_HOLE_BANDS + 1` band edges as |sin b|. */
export function resolvedHoleBandEdges(): number[] {
  return Array.from({ length: RESOLVED_HOLE_BANDS + 1 }, (_, i) => i / RESOLVED_HOLE_BANDS);
}

/** The whole of what each shader computes before the fetch. */
export function resolvedHoleUv(dSolPc: number, absSinB: number): [number, number] {
  const d = Math.max(dSolPc, RESOLVED_HOLE_MIN_DISTANCE_PC);
  return [
    (Math.log10(d) - RESOLVED_HOLE_LOG_DISTANCE0)
      / (RESOLVED_HOLE_DEX_PER_SHELL * RESOLVED_HOLE_SHELLS),
    absSinB,
  ];
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** README.md § The table is a texture, not a uniform array. */
export function sampleTexelCentres(
  values: ArrayLike<number>,
  width: number,
  height: number,
  u: number,
  v: number,
): number {
  const x = Math.min(Math.max(u * width - 0.5, 0), width - 1);
  const y = Math.min(Math.max(v * height - 0.5, 0), height - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const at = (i: number, j: number) => values[j * width + i];
  return lerp(
    lerp(at(x0, y0), at(x1, y0), x - x0),
    lerp(at(x0, y1), at(x1, y1), x - x0),
    y - y0,
  );
}

/** The catalogue's share of the model's light at a point. */
export function resolvedLightFraction(
  dSolPc: number,
  absSinB: number,
  table: ResolvedHoleTable = SHIPPED_RESOLVED_HOLE,
): number {
  const [u, v] = resolvedHoleUv(dSolPc, absSinB);
  return sampleTexelCentres(
    table.values, RESOLVED_HOLE_SHELLS, RESOLVED_HOLE_BANDS, u, v);
}

/** What the band still owes at a point: the model's emissivity times this. */
export function unresolvedLightFraction(
  dSolPc: number,
  absSinB: number,
  table: ResolvedHoleTable = SHIPPED_RESOLVED_HOLE,
): number {
  return 1 - resolvedLightFraction(dSolPc, absSinB, table);
}

/** See README.md § The resolution hole. */
export function clampResolvedHoleStrength(k: number): number {
  return Math.min(1, Math.max(0, k));
}

/** What the shaders fetch. Why the complement and not the hole:
 *  README.md § The table is a texture, not a uniform array. */
export function unresolvedHoleTexels(strength = 1): Float32Array {
  const k = clampResolvedHoleStrength(strength);
  const out = new Float32Array(RESOLVED_HOLE_VALUES.length);
  for (let i = 0; i < out.length; i++) out[i] = 1 - k * RESOLVED_HOLE_VALUES[i];
  return out;
}
