// Disc ↔ spheroid-mesh LOD crossfade + reflected-glare sizing: a
// flux-conserving photographic base plus an intensity-gated veiling-glare
// bloom. Contract in README.md § Planet mesh LOD.

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

/** Visibility floor for the photographic glare base: a body whose true
 *  disc·OVERSIZE falls below this renders at this pixel diameter with
 *  its peak scaled down to conserve flux (peak²·area invariant under the
 *  quarter-power display law ⇒ peak·√area), so a sub-pixel body dims
 *  with distance instead of vanishing or aliasing. Mirrored in
 *  planet.vert.glsl (uGlareShape.z). */
export const GLARE_MIN_PX = 2.0;

/** Default lit-surface radiance at which the veiling-glare bloom onsets
 *  (`iLitIntensity·albedo·uGlareGain`). Below it a body is just its
 *  flux-conserving base (a dim outer moon stays a dim point); above it
 *  the body blooms into a star-like halo (a sunlit inner surface reads
 *  brilliant). Debug-tunable via `uBloomThreshold`. */
export const DEFAULT_GLARE_BLOOM_THRESHOLD = 0.4;
/** Smoothstep width of the bloom onset above the threshold. Mirrored in
 *  planet.vert.glsl (uGlareShape.w). */
export const GLARE_BLOOM_KNEE = 0.4;

/** Default reflected-glare gain — scales the photographic surface-radiance
 *  scale the glare base and bloom onset both read. Smoke-tuned; drives
 *  the tunable uGlareGain uniform. */
export const DEFAULT_GLARE_GAIN = 1.0;

/** Mesh opacity for a physical diameter in CSS px: 0 at/below
 *  MESH_FADE_MIN_PX, 1 at/above MESH_FADE_FULL_PX, smoothstep across.
 *  Doubles as glare resolvedness `res` — the shader computes the same
 *  smoothstep over uMeshFadePx (drives the crescent photocentre shift). */
export function meshFadeFromPhysPx(physPx: number): number {
  return smooth01((physPx - MESH_FADE_MIN_PX) / (MESH_FADE_FULL_PX - MESH_FADE_MIN_PX));
}

/** Veiling-glare bloom amount in [0,1]: 0 = dim surface (base only),
 *  1 = bright surface (full star-like bloom). smoothstep over lit-surface
 *  radiance. Mirrors the shader's `bloom`. */
export function glareBloomAmount(litSurfaceRadiance: number, threshold: number): number {
  return smooth01((litSurfaceRadiance - threshold) / Math.max(GLARE_BLOOM_KNEE, 1e-6));
}

/** Flux-conserving photographic base peak: `L·√ratio`, ratio =
 *  physDisc·OVERSIZE / baseSize ≤ 1. `L` is the disc-averaged surface
 *  radiance (`iLitIntensity·albedo·uGlareGain·illumFrac`). Quarter-power
 *  display law turns linear flux conservation (peak·area = const) into
 *  peak·√area, so a sub-pixel body's peak is ≤ its surface radiance and
 *  dims ∝ physSize with distance. Mirrors the shader. */
export function glareBasePeak(discRadiance: number, physPx: number): number {
  const over = physPx * GLARE_BLOOM_OVERSIZE;
  const baseSize = Math.max(over, GLARE_MIN_PX);
  return discRadiance * Math.sqrt(Math.min(1, over / baseSize));
}

/** Glare quad diameter in CSS px: the flux-conserving base disc
 *  (`max(physDisc·OVERSIZE, GLARE_MIN_PX)`) blended toward the
 *  star-perceptual bloom extent (`appSizePx`) by the bloom amount. CPU
 *  mirror of the planet vertex shader's glare sizing; consumed by the
 *  hover pick footprint. */
export function glareSizePx(physPx: number, appSizePx: number, bloom: number): number {
  const baseSize = Math.max(physPx * GLARE_BLOOM_OVERSIZE, GLARE_MIN_PX);
  return baseSize + bloom * (Math.max(baseSize, appSizePx) - baseSize);
}

function smooth01(x: number): number {
  const t = Math.min(Math.max(x, 0), 1);
  return t * t * (3 - 2 * t);
}
