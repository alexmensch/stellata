// Layout, sampler mirror and texel values for the resolution hole.
// README.md#the-resolution-hole--the-band-marches-the-model-minus-the-drawn-stars; the table itself is generated.

import {
  RESOLVED_HOLE_CATALOGUE_RECORDS,
  RESOLVED_HOLE_VALUES,
} from './resolved-hole-table';

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

/** The table subtracts the light of the catalogue it was MEASURED on, so a
 *  client loading a different one removes light for stars the star field
 *  never draws. Returns what to say about a mismatch, else null. A shallower
 *  local build is legitimate and the band still renders, which is why the
 *  caller warns rather than throwing. */
export function resolvedHoleCatalogueMismatch(
  loadedRecords: number,
): string | null {
  if (loadedRecords === RESOLVED_HOLE_CATALOGUE_RECORDS) return null;
  return 'resolved-hole table was measured on '
    + `${RESOLVED_HOLE_CATALOGUE_RECORDS.toLocaleString()} records but this `
    + `catalogue loaded ${loadedRecords.toLocaleString()}, so the band `
    + 'subtracts resolved light for a population the star field does not '
    + 'draw. Regenerate with: pnpm run measure:band-resolved';
}

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

/** A normalised coordinate onto a texel-centre index, clamped to the edge —
 *  the filtering rule both samplers mirror. */
const texelCoord = (c: number, size: number) =>
  Math.min(Math.max(c * size - 0.5, 0), size - 1);

/** README.md#the-table-is-a-3d-grid-not-a-uniform-array. */
export function sampleTexelCentres(
  values: ArrayLike<number>,
  width: number,
  height: number,
  u: number,
  v: number,
): number {
  const x = texelCoord(u, width);
  const y = texelCoord(v, height);
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

/** README.md#the-table-is-a-3d-grid-not-a-uniform-array. */
export const RESOLVED_HOLE_GRID_N = 64;
export const RESOLVED_HOLE_GRID_HALF_PC = 4000;

function holeVoxelsOf(table: ResolvedHoleTable): Float32Array {
  const n = RESOLVED_HOLE_GRID_N;
  const step = (2 * RESOLVED_HOLE_GRID_HALF_PC) / n;
  const out = new Float32Array(n * n * n);
  for (let iz = 0; iz < n; iz++) {
    const z = -RESOLVED_HOLE_GRID_HALF_PC + (iz + 0.5) * step;
    for (let iy = 0; iy < n; iy++) {
      const y = -RESOLVED_HOLE_GRID_HALF_PC + (iy + 0.5) * step;
      for (let ix = 0; ix < n; ix++) {
        const x = -RESOLVED_HOLE_GRID_HALF_PC + (ix + 0.5) * step;
        const d = Math.hypot(x, y, z);
        out[(iz * n + iy) * n + ix] =
          resolvedLightFraction(d, d > 0 ? Math.abs(z) / d : 0, table);
      }
    }
  }
  return out;
}

let shippedHole: Float32Array | null = null;

/** Build from this, never re-sample — README.md#the-table-is-a-3d-grid-not-a-uniform-array. */
export function shippedHoleVoxels(): Float32Array {
  shippedHole ??= holeVoxelsOf(SHIPPED_RESOLVED_HOLE);
  return shippedHole;
}

/** What the 3D slot is written with. README.md#the-table-is-a-3d-grid-not-a-uniform-array. */
export function unresolvedHoleVoxels(
  strength = 1,
  table: ResolvedHoleTable = SHIPPED_RESOLVED_HOLE,
): Float32Array {
  const k = clampResolvedHoleStrength(strength);
  const hole = table === SHIPPED_RESOLVED_HOLE ? shippedHoleVoxels() : holeVoxelsOf(table);
  const out = new Float32Array(hole.length);
  for (let i = 0; i < hole.length; i++) out[i] = 1 - k * hole[i];
  return out;
}

/** `RESOLVED_HOLE_GRID_N` cubed of `1 − strength·hole`. */
export interface ResolvedHoleGrid {
  readonly voxels: ArrayLike<number>;
}

let shippedGrid: ResolvedHoleGrid | null = null;

/** README.md#the-table-is-a-3d-grid-not-a-uniform-array — why this is not a constant. */
export function shippedResolvedHoleGrid(): ResolvedHoleGrid {
  shippedGrid ??= { voxels: unresolvedHoleVoxels() };
  return shippedGrid;
}

/** The cube a freshly measured table implies — what the shaders would fetch
 *  once it is committed. */
export function resolvedHoleGridOf(
  table: ResolvedHoleTable,
  strength = 1,
): ResolvedHoleGrid {
  return { voxels: unresolvedHoleVoxels(strength, table) };
}

/** The CPU mirror of the hardware's trilinear fetch. */
function sampleVoxelCentres(
  voxels: ArrayLike<number>,
  n: number,
  u: number,
  v: number,
  w: number,
): number {
  const x = texelCoord(u, n), y = texelCoord(v, n), z = texelCoord(w, n);
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  const x1 = Math.min(x0 + 1, n - 1);
  const y1 = Math.min(y0 + 1, n - 1);
  const z1 = Math.min(z0 + 1, n - 1);
  const tx = x - x0, ty = y - y0, tz = z - z0;
  const at = (i: number, j: number, k: number) => voxels[(k * n + j) * n + i];
  const plane = (k: number) => lerp(
    lerp(at(x0, y0, k), at(x1, y0, k), tx),
    lerp(at(x0, y1, k), at(x1, y1, k), tx), ty);
  return lerp(plane(z0), plane(z1), tz);
}

/** The whole of what each shader computes before the fetch. */
function resolvedHoleUvw(
  xFromSolPc: number,
  yFromSolPc: number,
  zFromSolPc: number,
): [number, number, number] {
  const k = 0.5 / RESOLVED_HOLE_GRID_HALF_PC;
  return [xFromSolPc * k + 0.5, yFromSolPc * k + 0.5, zFromSolPc * k + 0.5];
}

/** What the band still owes at a point: the model's emissivity times this. */
export function unresolvedGridLight(
  xFromSolPc: number,
  yFromSolPc: number,
  zFromSolPc: number,
  grid: ResolvedHoleGrid = shippedResolvedHoleGrid(),
): number {
  const [u, v, w] = resolvedHoleUvw(xFromSolPc, yFromSolPc, zFromSolPc);
  return sampleVoxelCentres(grid.voxels, RESOLVED_HOLE_GRID_N, u, v, w);
}

/** See README.md#the-resolution-hole--the-band-marches-the-model-minus-the-drawn-stars. */
export function clampResolvedHoleStrength(k: number): number {
  return Math.min(1, Math.max(0, k));
}
