// Build-time Sol→star extinction integral through the same encoded
// Edenhofer dust grid star.vert.glsl raymarches. See
// scripts/catalog/distance/README.md § Build-time de-extinction.

// Reddening ratio A_V / E(B−V). MUST equal R_V in
// src/client/star-pipeline/star.vert.glsl — the shader re-reddens by the
// same ratio, so a divergence breaks the Sol-view cancellation.
export const R_V = 3.1;

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

function mix(a: number, b: number, f: number): number {
  return a + (b - a) * f;
}

// Trilinear read matching the GPU sampler3D (LinearFilter, ClampToEdge):
// normalise uint8 → [0,1], interpolate in encoded space, THEN decode.
// Returns 0 for positions outside the cube — the shader `continue`s on
// out-of-range uvw and the boundary voxels are zero-padded.
export function sampleDensityAt(
  grid: DustGrid,
  x: number,
  y: number,
  z: number,
): number {
  const n = grid.gridSize;
  const invRange = 0.5 / grid.boundsHalfPc;
  const u = x * invRange + 0.5;
  const v = y * invRange + 0.5;
  const w = z * invRange + 0.5;
  if (u < 0 || u > 1 || v < 0 || v > 1 || w < 0 || w > 1) return 0;

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
  const encoded = mix(c0, c1, fz);

  return grid.densityMin * Math.exp(encoded * grid.logRatio);
}

// Converged A_V from Sol (origin) to the star, integrating only the
// portion of the sightline inside the cube (the ray from the cube's
// centre exits exactly once). Midpoint rule with step ≤ one voxel — the
// build reference that the shader's coarser 48-step march approximates,
// so the only at-Sol residual is the shader's quadrature error.
export function avSolToStar(
  grid: DustGrid,
  x: number,
  y: number,
  z: number,
): number {
  const lenPc = Math.hypot(x, y, z);
  if (lenPc < 1e-6) return 0;
  const dx = x / lenPc, dy = y / lenPc, dz = z / lenPc;

  const b = grid.boundsHalfPc;
  let tExit = Infinity;
  if (dx !== 0) tExit = Math.min(tExit, b / Math.abs(dx));
  if (dy !== 0) tExit = Math.min(tExit, b / Math.abs(dy));
  if (dz !== 0) tExit = Math.min(tExit, b / Math.abs(dz));
  const inCubeLen = Math.min(lenPc, tExit);

  const numSteps = Math.max(1, Math.ceil(inCubeLen / grid.voxelSizePc));
  const stepPc = inCubeLen / numSteps;
  let accumDensity = 0;
  for (let i = 0; i < numSteps; i++) {
    const t = (i + 0.5) * stepPc;
    accumDensity += sampleDensityAt(grid, dx * t, dy * t, dz * t);
  }
  return accumDensity * stepPc * grid.avPerDensityPc;
}
