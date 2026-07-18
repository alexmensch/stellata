// Disc ↔ spheroid-mesh LOD crossfade, keyed on the ratio of the
// body's TRUE projected diameter (physSize) to its perceptual disc
// size (appSize). Contract in README.md § Planet mesh LOD.

/** Fade starts at physSize = appSize — exactly where the disc's
 *  `max(appSize, physSize)` switches to the physical term, so the
 *  mesh and the disc share the same footprint through the whole band
 *  and the handoff can't pop in size. Must stay ≥ 1 for that
 *  invariant to hold. */
export const MESH_FADE_START_RATIO = 1.0;
/** Mesh renders alone once physSize is this multiple of appSize. */
export const MESH_FADE_END_RATIO = 1.5;
/** Kick off the lazy texture fetch on approach, before the band. */
export const TEXTURE_PREFETCH_RATIO = 0.5;

/** Mesh opacity for a physSize/appSize ratio: 0 below the band, 1
 *  above, smoothstep across it. Disc opacity is `1 − meshFade`. */
export function meshFadeFromRatio(ratio: number): number {
  const t = Math.min(
    Math.max(
      (ratio - MESH_FADE_START_RATIO) / (MESH_FADE_END_RATIO - MESH_FADE_START_RATIO),
      0,
    ),
    1,
  );
  return t * t * (3 - 2 * t);
}
