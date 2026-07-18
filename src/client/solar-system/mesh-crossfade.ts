// Disc ↔ spheroid-mesh LOD crossfade band, keyed on the body's TRUE
// projected angular diameter in CSS px (never the perceptual disc
// size, which floors). Contract in README.md § Planet mesh LOD.

/** Below this projected diameter the perceptual disc renders alone. */
export const MESH_FADE_START_PX = 20;
/** Above this the mesh renders alone (disc fully faded). */
export const MESH_FADE_END_PX = 40;
/** Kick off the lazy texture fetch on approach, before the band. */
export const TEXTURE_PREFETCH_PX = 8;

/** True projected angular diameter in CSS px: θ = 2·atan(R/d) mapped
 *  through the vertical FOV. Matches the shader's `physSize`. */
export function physicalDiameterPx(
  radiusPc: number,
  distPc: number,
  fovYRad: number,
  viewportHPx: number,
): number {
  if (distPc <= 0 || fovYRad <= 0) return 0;
  return 2 * Math.atan(radiusPc / distPc) * (viewportHPx / fovYRad);
}

/** Mesh opacity for a projected diameter: 0 below the band, 1 above,
 *  smoothstep across it. Disc opacity is `1 − meshFade(px)`. */
export function meshFade(px: number): number {
  const t = Math.min(
    Math.max((px - MESH_FADE_START_PX) / (MESH_FADE_END_PX - MESH_FADE_START_PX), 0),
    1,
  );
  return t * t * (3 - 2 * t);
}
