// Disc ↔ spheroid-mesh LOD crossfade: mesh presence keyed on physical
// pixels, billboard fade on the physSize/appSize ratio. Contract in
// README.md § Planet mesh LOD.

/** Mesh fully faded out at/below this physical diameter — the eye can
 *  track a resolved body (and its crescent phase) down to ~1 px, so
 *  the mesh persists to that limit instead of handing off at the
 *  perceptual-disc scale. */
export const MESH_FADE_MIN_PX = 1.0;
/** Mesh fully on at/above this physical diameter. */
export const MESH_FADE_FULL_PX = 2.0;
/** Kick off the lazy texture fetch on approach, before the band. */
export const TEXTURE_PREFETCH_PX = 0.5;

/** Billboard disc-pass fade band, in physSize/appSize ratio. Starts at
 *  physSize = appSize — exactly where the disc's `max(appSize,
 *  physSize)` switches to the physical term. Through the whole band
 *  the disc's CORE is depth-hidden behind the fully-shown mesh (core
 *  radius < 0.5 · quad = the mesh silhouette), so only the thin halo
 *  annulus visibly fades — no size pop. Must stay ≥ 1 for the
 *  core-hidden invariant to hold. Below the band the billboard runs
 *  at full strength: the perceptual glow at appSize IS the correct
 *  glare for a bright body, and the mesh crescent sits inside it. */
export const DISC_FADE_START_RATIO = 1.0;
export const DISC_FADE_END_RATIO = 1.5;

/** Mesh opacity for a physical diameter in CSS px: 0 at/below
 *  MESH_FADE_MIN_PX, 1 at/above MESH_FADE_FULL_PX, smoothstep across. */
export function meshFadeFromPhysPx(physPx: number): number {
  return smooth01((physPx - MESH_FADE_MIN_PX) / (MESH_FADE_FULL_PX - MESH_FADE_MIN_PX));
}

/** Billboard disc opacity for a physSize/appSize ratio: 1 below the
 *  band, 0 above it. CPU mirror of the planet vertex shader's
 *  `vDiscFade` smoothstep. */
export function discFadeFromRatio(ratio: number): number {
  return 1 - smooth01(
    (ratio - DISC_FADE_START_RATIO) / (DISC_FADE_END_RATIO - DISC_FADE_START_RATIO),
  );
}

function smooth01(x: number): number {
  const t = Math.min(Math.max(x, 0), 1);
  return t * t * (3 - 2 * t);
}
