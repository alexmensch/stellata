// Cell-count geometry for the two froxel parameterisations: solid angle for a
// sky-fixed grid, tan-space area for a screen-space one. The screen-space half
// is shared with the client fill and lives in src/client/dust/froxel/.

import {
  frustumScreenExtent,
} from '../../../src/client/dust/froxel/froxel-grid-pure';

/** Solid angle of a rectangular frustum, steradians. */
export function frustumSr(fovVDeg: number, aspect: number): number {
  const h = (fovVDeg * Math.PI) / 180;
  const w = 2 * Math.atan(Math.tan(h / 2) * aspect);
  return 4 * Math.asin(Math.sin(w / 2) * Math.sin(h / 2));
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
