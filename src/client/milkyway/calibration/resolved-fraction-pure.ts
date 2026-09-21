// The resolution hole's layout, sampler and slot writer. README.md § The
// resolution hole; the table itself is generated.

import { RESOLVED_HOLE_VALUES } from './resolved-hole-table';

/** Log-spaced distance shells from Sol, `RESOLVED_HOLE_DEX_PER_SHELL` wide,
 *  the first starting at 10^`RESOLVED_HOLE_LOG_DISTANCE0` pc. */
export const RESOLVED_HOLE_SHELLS = 32;
export const RESOLVED_HOLE_LOG_DISTANCE0 = 1;
export const RESOLVED_HOLE_DEX_PER_SHELL = 0.1;
/** Equal-|sin b| latitude bands from Sol — equal solid angle each. */
export const RESOLVED_HOLE_BANDS = 8;

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

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Mirrors the two shaders' `resolvedLightFraction` — keep the three in lockstep. */
export function resolvedLightFraction(
  dSolPc: number,
  absSinB: number,
  table: ResolvedHoleTable = SHIPPED_RESOLVED_HOLE,
): number {
  const u = Math.min(
    Math.max((Math.log10(dSolPc) - RESOLVED_HOLE_LOG_DISTANCE0) / RESOLVED_HOLE_DEX_PER_SHELL - 0.5, 0),
    RESOLVED_HOLE_SHELLS - 1,
  );
  const v = Math.min(Math.max(absSinB * RESOLVED_HOLE_BANDS - 0.5, 0), RESOLVED_HOLE_BANDS - 1);
  const i0 = Math.floor(u);
  const j0 = Math.floor(v);
  const i1 = Math.min(i0 + 1, RESOLVED_HOLE_SHELLS - 1);
  const j1 = Math.min(j0 + 1, RESOLVED_HOLE_BANDS - 1);
  const t = table.values;
  const at = (i: number, j: number) => t[resolvedHoleIndex(i, j)];
  return lerp(
    lerp(at(i0, j0), at(i1, j0), u - i0),
    lerp(at(i0, j1), at(i1, j1), u - i0),
    v - j0,
  );
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

/** In place, never by reassignment: on WebGPU the slot's value is the array
 *  node's own backing array behind a getter. */
export function writeResolvedHoleSlot(target: { [i: number]: number }, strength = 1): void {
  const k = clampResolvedHoleStrength(strength);
  for (let i = 0; i < RESOLVED_HOLE_VALUES.length; i++) {
    target[i] = k * RESOLVED_HOLE_VALUES[i];
  }
}
