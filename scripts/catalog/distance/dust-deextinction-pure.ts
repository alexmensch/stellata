// Build-time Sol→star extinction integral through the same encoded
// Edenhofer dust grid the runtime march samples. See
// scripts/catalog/distance/README.md § Build-time de-extinction.

import {
  segmentCubeOverlap,
  type Vec3,
} from '../../../src/client/star-pipeline/extinction/dust-raymarch-pure';

export { R_V } from '../../../src/client/star-pipeline/extinction/dust-raymarch-pure';

/** In-memory decode of the dust artifact `dust-loader.ts` streams at
 *  runtime. `data` is the flat gridSize³ grid of encoded uint8 voxels,
 *  x-fastest: `idx = (z·gridSize + y)·gridSize + x`. */
export interface DustGrid {
  gridSize: number;
  boundsHalfPc: number;
  densityMin: number;
  /** ln(densityMax / densityMin) — the shader's uDustLogRatio. */
  logRatio: number;
  avPerDensityPc: number;
  voxelSizePc: number;
  data: Uint8Array;
}

const ORIGIN: Vec3 = [0, 0, 0];

function mix(a: number, b: number, f: number): number {
  return a + (b - a) * f;
}

/** Trilinear read of the ENCODED value at volume coordinates, matching the
 *  GPU sampler3D (LinearFilter, ClampToEdge): normalise uint8 → [0,1] and
 *  interpolate in encoded space. Coordinates outside [0,1] clamp to the
 *  edge voxel. */
export function sampleEncodedAt(grid: DustGrid, u: number, v: number, w: number): number {
  const n = grid.gridSize;
  const cx = u * n - 0.5;
  const cy = v * n - 0.5;
  const cz = w * n - 0.5;
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const z0 = Math.floor(cz);
  const fx = cx - x0;
  const fy = cy - y0;
  const fz = cz - z0;

  const cl = (i: number): number => (i < 0 ? 0 : i >= n ? n - 1 : i);
  const x0c = cl(x0), x1c = cl(x0 + 1);
  const y0c = cl(y0), y1c = cl(y0 + 1);
  const z0c = cl(z0), z1c = cl(z0 + 1);
  const get = (gx: number, gy: number, gz: number): number =>
    grid.data[(gz * n + gy) * n + gx] / 255;

  const c00 = mix(get(x0c, y0c, z0c), get(x1c, y0c, z0c), fx);
  const c10 = mix(get(x0c, y1c, z0c), get(x1c, y1c, z0c), fx);
  const c01 = mix(get(x0c, y0c, z1c), get(x1c, y0c, z1c), fx);
  const c11 = mix(get(x0c, y1c, z1c), get(x1c, y1c, z1c), fx);
  const c0 = mix(c00, c10, fy);
  const c1 = mix(c01, c11, fy);
  return mix(c0, c1, fz);
}

/** Decoded E_ZGR/pc density at an absolute position; 0 outside the cube. */
export function sampleDensityAt(
  grid: DustGrid,
  x: number,
  y: number,
  z: number,
): number {
  const invRange = 0.5 / grid.boundsHalfPc;
  const u = x * invRange + 0.5;
  const v = y * invRange + 0.5;
  const w = z * invRange + 0.5;
  if (u < 0 || u > 1 || v < 0 || v > 1 || w < 0 || w > 1) return 0;
  return grid.densityMin * Math.exp(sampleEncodedAt(grid, u, v, w) * grid.logRatio);
}

/** Converged A_V along `from`→`to` (absolute pc). */
export function avAlongSegment(grid: DustGrid, from: Vec3, to: Vec3): number {
  const delta: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const lenPc = Math.hypot(delta[0], delta[1], delta[2]);
  if (lenPc < 1e-6) return 0;
  const [t0, t1] = segmentCubeOverlap(from, delta, grid.boundsHalfPc);
  if (t1 <= t0) return 0;
  const inCubeLenPc = (t1 - t0) * lenPc;

  const numSteps = Math.max(1, Math.ceil(inCubeLenPc / grid.voxelSizePc));
  const stepPc = inCubeLenPc / numSteps;
  let accumDensity = 0;
  for (let i = 0; i < numSteps; i++) {
    const t = t0 + (t1 - t0) * ((i + 0.5) / numSteps);
    accumDensity += sampleDensityAt(
      grid, from[0] + delta[0] * t, from[1] + delta[1] * t, from[2] + delta[2] * t);
  }
  return accumDensity * stepPc * grid.avPerDensityPc;
}

/** The build's Sol→star de-extinction integral. */
export function avSolToStar(
  grid: DustGrid,
  x: number,
  y: number,
  z: number,
): number {
  return avAlongSegment(grid, ORIGIN, [x, y, z]);
}
