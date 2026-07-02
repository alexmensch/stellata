// LOD thresholds for the binary-orbit field. See
// src/client/binaries/README.md § Walk-active LOD.

/** Maximum primary-camera distance (pc) at which a relation participates
 *  in per-frame Kepler evaluation. At 1 kpc, a 50 AU orbital separation
 *  subtends ~50 mas — well below 1 px at any plausible FOV/viewport, so
 *  evaluating the orbit produces no visible motion and burns CPU. */
export const VISIBILITY_HORIZON_PC = 1000;

/** Screen-separation threshold (pixels) below which the secondary is
 *  composite-suppressed: the close-range disc + core depth-mask passes
 *  are skipped for it and the additive glow pass alone sums the two
 *  near-coincident point sources. The Kepler eval is also skipped (its
 *  output would land within one pixel of the static catalog position),
 *  so the relation costs nothing but the screen-projection check. */
export const SUB_PIXEL_THRESHOLD_PX = 1.5;

/** Real-time smoothing constant (seconds) for the eclipse dim factor.
 *  Under heavy time-warp an eclipse can last less than a frame; without
 *  smoothing the composite strobes at frame rate. The exponential blend
 *  turns sub-frame events into a soft shimmer while leaving real-time
 *  dips (hours long) visually untouched. */
export const ECLIPSE_DIM_TAU_S = 0.12;
