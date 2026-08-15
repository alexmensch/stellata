// Screen-space froxel geometry: the tan-space cell count both the cost model
// and the GPU fill derive their grid from, the coverage-sphere span each cell
// ray marches, and the fill's rebuild predicates.

import { PINNED_CELL_RAD } from './froxel-pins';

/** The frustum's extent in the screen's own coordinate, tan θ per axis. */
export function frustumScreenExtent(
  fovVDeg: number,
  aspect: number,
): { readonly x: number; readonly y: number } {
  const h = (fovVDeg * Math.PI) / 180;
  const y = 2 * Math.tan(h / 2);
  return { x: y * aspect, y };
}

/**
 * Cells in a **screen-uniform** grid whose coarsest cell spans `cellRad`.
 * Angular cell size is dθ/dx = cos²θ, so the on-axis cell is the coarsest and
 * every other one is finer: the count is the tan-space area, not Ω/cellRad²,
 * and the gap grows with FOV (1.4× at 50°, 5.5× at 120°).
 */
export function frustumCells(fovVDeg: number, aspect: number, cellRad: number): number {
  const e = frustumScreenExtent(fovVDeg, aspect);
  return (e.x / cellRad) * (e.y / cellRad);
}

/** Integer texture dimensions for the same grid — the fill allocates these,
 *  so it rounds up where `frustumCells` reports the exact tan-space area. */
export function froxelGridDims(
  fovVDeg: number,
  aspect: number,
  cellRad: number,
): { readonly x: number; readonly y: number } {
  const e = frustumScreenExtent(fovVDeg, aspect);
  return { x: Math.ceil(e.x / cellRad), y: Math.ceil(e.y / cellRad) };
}

/**
 * Where a sightline enters and leaves the coverage sphere, as distances along
 * a unit `dir` from an absolute camera position. Null when the ray misses, or
 * when the sphere lies entirely behind the camera.
 *
 * `[entry, exit]` rather than `[0, exit]` is the whole of the design gate's
 * fourth requirement: the distance axis has to start at the near root or a
 * camera outside coverage spends its whole grid on empty space.
 */
export function coverageSpanPc(
  camX: number, camY: number, camZ: number,
  dirX: number, dirY: number, dirZ: number,
  radiusPc: number,
): { readonly near: number; readonly far: number } | null {
  const b = camX * dirX + camY * dirY + camZ * dirZ;
  const c = camX * camX + camY * camY + camZ * camZ - radiusPc * radiusPc;
  const disc = b * b - c;
  if (disc <= 0) return null;
  const root = Math.sqrt(disc);
  const far = -b + root;
  if (far <= 0) return null;
  return { near: Math.max(-b - root, 0), far };
}

/** Log-spaced slice edge k ∈ [0, slices] over one ray's own coverage span.
 *  Every ray gets its own edges, which is what makes the grid's along-ray
 *  resolution track the shell it actually has to cover. */
export function sliceEdgePc(k: number, slices: number, nearPc: number, farPc: number): number {
  return nearPc * Math.pow(farPc / nearPc, k / slices);
}

/** Dust fetches one cell ray costs: its whole span at the fill step, however
 *  the slices divide it. */
export function fillSamplesPerRay(spanPc: number, stepPc: number): number {
  return Math.ceil(spanPc / stepPc);
}

/** Rotation beyond which the grid is rebuilt. A view-parameterised grid is
 *  stale the moment the camera turns, so this is the rotational analogue of
 *  the per-star prepass's 1 pc displacement ε — a fifth of a cell, matching
 *  that ε's fifth-of-a-voxel ratio. */
export const ROTATION_EPSILON_RAD = PINNED_CELL_RAD / 5;

/** True when the camera has turned beyond epsilon since the last fill.
 *  `dot` is the quaternion dot product, whose |·| is cos(θ/2). Negated rather
 *  than written as `<` so the NaN first-frame sentinel forces a fill, as the
 *  displacement predicate's Infinity does. */
export function rotatedBeyondEpsilon(dot: number, epsilonRad: number): boolean {
  return !(Math.abs(dot) >= Math.cos(epsilonRad / 2));
}
