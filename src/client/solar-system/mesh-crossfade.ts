// Disc ↔ spheroid-mesh LOD crossfade + reflected-glare sizing: mesh
// presence and the glare point↔bloom regime share one physical-pixel
// resolvedness band. Contract in README.md § Planet mesh LOD.

/** Mesh fully faded out at/below this physical diameter — the eye can
 *  track a resolved body (and its crescent phase) down to ~1 px, so
 *  the mesh persists to that limit instead of handing off at the
 *  perceptual-disc scale. Doubles as the glare's resolvedness floor. */
export const MESH_FADE_MIN_PX = 1.0;
/** Mesh fully on at/above this physical diameter; glare fully in its
 *  resolved bloom regime there. */
export const MESH_FADE_FULL_PX = 2.0;
/** Kick off the lazy texture fetch on approach, before the band. */
export const TEXTURE_PREFETCH_PX = 0.5;

/** Resolved-regime glare cap: the bloom halo extends to at most this
 *  multiple of the true disc, so a bright body's glare reads as a thin
 *  lit-limb bloom over the mesh — never a giant symmetric ring around a
 *  small crescent. Mirrored in planet.vert.glsl. */
export const GLARE_BLOOM_OVERSIZE = 1.3;

/** Photocentre shift toward the lit limb, as a fraction of the disc
 *  radius, at maximum crescent (illumFrac → 0) and full resolvedness.
 *  Mirrored in planet.vert.glsl. */
export const GLARE_PHOTOCENTRE_SHIFT = 0.5;

/** Default reflected-glare gain — the flux-continuity calibration
 *  between the resolved bloom peak and the mesh surface brightness it
 *  sits over. Smoke-tuned; drives the tunable uGlareGain uniform. */
export const DEFAULT_GLARE_GAIN = 1.0;

/** Mesh opacity for a physical diameter in CSS px: 0 at/below
 *  MESH_FADE_MIN_PX, 1 at/above MESH_FADE_FULL_PX, smoothstep across.
 *  Doubles as glare resolvedness `res` — the shader computes the same
 *  smoothstep over uMeshFadePx. */
export function meshFadeFromPhysPx(physPx: number): number {
  return smooth01((physPx - MESH_FADE_MIN_PX) / (MESH_FADE_FULL_PX - MESH_FADE_MIN_PX));
}

/** Glare quad diameter in CSS px. Blends the star-perceptual point size
 *  (unresolved) toward the size-clamped bloom `physPx · OVERSIZE`
 *  (resolved) on the mesh resolvedness band, so the glare shrinks onto
 *  the disc as the mesh appears. CPU mirror of the planet vertex
 *  shader's glare sizing; consumed by the hover pick footprint. */
export function glareSizePx(appSizePx: number, physPx: number): number {
  const res = meshFadeFromPhysPx(physPx);
  return appSizePx + res * (physPx * GLARE_BLOOM_OVERSIZE - appSizePx);
}

function smooth01(x: number): number {
  const t = Math.min(Math.max(x, 0), 1);
  return t * t * (3 - 2 * t);
}
