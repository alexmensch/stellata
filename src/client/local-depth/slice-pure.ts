// Depth-slice partition math for the local depth pass: member bounding
// spheres → K ratio-bounded [near, far] brackets, rendered far→near.
// Derivation + precision analysis in README.md § Precision.

export interface MemberSphere {
  /** Camera → sphere-centre distance, pc. */
  distPc: number;
  /** Bounding radius (body + rings), pc. */
  radiusPc: number;
}

export interface DepthSlice {
  nearPc: number;
  farPc: number;
}

/** Hard floor on the nearest slice's near plane (~0.3 m) — sized for
 *  metre-scale bodies (probes) at their own park distance. */
export const NEAR_MIN_PC = 1e-17;
/** near = this fraction of the nearest member surface distance. */
export const NEAR_FRACTION = 0.5;
export const FAR_MARGIN = 1.05;
export const DEPTH_BUFFER_BITS = 24;
/** Headroom between the far-edge depth quantum and a one-pixel feature:
 *  at the maximal slice ratio, the smallest z-orderable feature at the
 *  slice's far plane subtends 1/SLICE_RATIO_SAFETY px. */
export const SLICE_RATIO_SAFETY = 4;

/** Largest far/near ratio a single slice may span while keeping every
 *  ≥(1/SLICE_RATIO_SAFETY)-pixel feature z-orderable at its far edge. */
export function maxSliceRatio(fovYRad: number, viewportHeightPx: number): number {
  return Math.max(
    2,
    (2 ** DEPTH_BUFFER_BITS) * (fovYRad / viewportHeightPx) / SLICE_RATIO_SAFETY,
  );
}

/** Standard-perspective depth quantum at distance z inside [near, far]:
 *  the world-space Δz that moves the depth value by one buffer step. */
export function depthQuantumPc(zPc: number, nearPc: number, farPc: number): number {
  return (zPc * zPc * (farPc - nearPc)) / (farPc * nearPc * 2 ** DEPTH_BUFFER_BITS);
}

/** Partition the members' depth range into equal-ratio slices, each
 *  within maxSliceRatio, returned far→near (the painter's render
 *  order). Empty input → no slices (the pass skips the frame). */
export function computeDepthSlices(
  spheres: readonly MemberSphere[],
  fovYRad: number,
  viewportHeightPx: number,
): DepthSlice[] {
  if (spheres.length === 0) return [];
  let minSurface = Infinity;
  let maxExtent = 0;
  for (const s of spheres) {
    minSurface = Math.min(minSurface, s.distPc - s.radiusPc);
    maxExtent = Math.max(maxExtent, s.distPc + s.radiusPc);
  }
  const near = Math.max(NEAR_MIN_PC, NEAR_FRACTION * minSurface);
  const far = Math.max(FAR_MARGIN * maxExtent, near * 2);
  const rMax = maxSliceRatio(fovYRad, viewportHeightPx);
  const count = Math.max(1, Math.ceil(Math.log(far / near) / Math.log(rMax)));
  const step = (far / near) ** (1 / count);
  const slices: DepthSlice[] = [];
  for (let i = count - 1; i >= 0; i--) {
    slices.push({ nearPc: near * step ** i, farPc: near * step ** (i + 1) });
  }
  return slices;
}
