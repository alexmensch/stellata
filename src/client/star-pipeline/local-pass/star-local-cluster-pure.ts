// Membership predicate + camera-window bound for the star local-depth
// cluster and the core depth-mask gate. Vitest-pinned.

import { DCAM_LOG_FLOOR_PC } from '../../camera/timing';

/** Rendered-disc pixel size below which a disc-pass star's main-pass
 *  depth artefacts (background bleed-through, close-pair z-fights) are
 *  too small to see. Shared pivot for the core depth-mask gate and the
 *  local-depth membership scan. */
export const RESOLVED_DISC_MIN_PX = 5;

/** Mirrors `STELLATA_PHYS_RATIO_THRESHOLD` in perceptual-disc.glsl — the
 *  disc/glow pass split. A star renders as an opaque depth-writing disc
 *  when physSize ≥ this fraction of its final quad size. */
export const PHYS_RATIO_THRESHOLD = 0.5;

/** The pass split itself, with no size floor: true when the opaque disc
 *  pass owns the star, false when the glow pass does. Mirrors
 *  `star.frag.glsl`'s `vPhysRatio` test on the same
 *  `pxSize = max(appSize, physSize)` the vertex stage divides by. The one
 *  CPU mirror of that split — the local-depth membership test below and
 *  the pick gate's taper / eclipse-dim branches all read it. */
export function isDiscDominant(appSizePx: number, physSizePx: number): boolean {
  return physSizePx >= PHYS_RATIO_THRESHOLD * Math.max(appSizePx, physSizePx);
}

/** True when the star renders as a disc-pass quad at least `minPx`
 *  wide — the local-depth membership trigger (a glow-pass star writes
 *  no depth, so it has nothing for the bracket to fix). */
export function isResolvedDiscStar(
  appSizePx: number,
  physSizePx: number,
  minPx: number = RESOLVED_DISC_MIN_PX,
): boolean {
  return isDiscDominant(appSizePx, physSizePx)
    && Math.max(appSizePx, physSizePx) >= minPx;
}

/** Camera-distance bound: past this range not even the catalog's
 *  largest star can subtend `px` pixels, so a scan for rendered discs
 *  can stop looking. Membership needs `physSize ≥ PHYS_RATIO_THRESHOLD
 *  × pxSize ≥ PHYS_RATIO_THRESHOLD × RESOLVED_DISC_MIN_PX`, so the scan
 *  passes that product as `px`; the core-mask gate passes
 *  RESOLVED_DISC_MIN_PX directly. */
export function discWindowPc(
  maxRadiusPc: number,
  px: number,
  fovYRad: number,
  viewportHPx: number,
): number {
  const halfAngle = (px * fovYRad) / (Math.max(viewportHPx, 1) * 2);
  return maxRadiusPc / Math.max(Math.tan(halfAngle), DCAM_LOG_FLOOR_PC);
}
