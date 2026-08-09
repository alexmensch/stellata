// Cell-count geometry for the two froxel parameterisations: solid angle for a
// sky-fixed grid, tan-space area for a screen-space one.

/** Solid angle of a rectangular frustum, steradians. */
export function frustumSr(fovVDeg: number, aspect: number): number {
  const h = (fovVDeg * Math.PI) / 180;
  const w = 2 * Math.atan(Math.tan(h / 2) * aspect);
  return 4 * Math.asin(Math.sin(w / 2) * Math.sin(h / 2));
}

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

/** A sky-fixed grid is uniform in angle, so its count is the solid angle. */
export function allSkyCells(cellRad: number): number {
  return (4 * Math.PI) / (cellRad * cellRad);
}

/** How much a screen-uniform grid costs over a uniform-in-angle count of the
 *  same coarsest cell — the factor the doc's cost table carries per FOV. */
export function screenGridOverhead(fovVDeg: number, aspect: number): number {
  const e = frustumScreenExtent(fovVDeg, aspect);
  return (e.x * e.y) / frustumSr(fovVDeg, aspect);
}
