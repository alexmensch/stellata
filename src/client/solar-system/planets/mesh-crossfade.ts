// Disc ↔ spheroid-mesh LOD crossfade + reflected-glare sizing: the glare
// is the shared star-perceptual point (a planet reads as a star of its
// magnitude). Contract in README.md § Planet mesh LOD.

/** Mesh fully faded out at/below this physical diameter — the eye can
 *  track a resolved body (and its crescent phase) down to ~1 px, so
 *  the mesh persists to that limit instead of handing off at the
 *  perceptual-disc scale. Doubles as the crescent-photocentre floor. */
export const MESH_FADE_MIN_PX = 1.0;
/** Mesh fully on at/above this physical diameter. */
export const MESH_FADE_FULL_PX = 2.0;
/** Kick off the lazy texture fetch on approach, before the band. */
export const TEXTURE_PREFETCH_PX = 0.5;

/** Photocentre shift toward the lit limb, as a fraction of the disc
 *  radius, at maximum crescent (illumFrac → 0) and full resolvedness —
 *  shape only, so a barely-resolved crescent's halo doesn't ring its
 *  dark limb. Mirrored in planet.vert.glsl (uGlarePhotocentreShift). */
export const GLARE_PHOTOCENTRE_SHIFT = 0.5;

/** Mesh opacity for a physical diameter in CSS px: 0 at/below
 *  MESH_FADE_MIN_PX, 1 at/above MESH_FADE_FULL_PX, smoothstep across.
 *  Doubles as glare resolvedness `res` — the shader computes the same
 *  smoothstep over uMeshFadePx (fades in the crescent photocentre). */
export function meshFadeFromPhysPx(physPx: number): number {
  return smooth01((physPx - MESH_FADE_MIN_PX) / (MESH_FADE_FULL_PX - MESH_FADE_MIN_PX));
}

function smooth01(x: number): number {
  const t = Math.min(Math.max(x, 0), 1);
  return t * t * (3 - 2 * t);
}
