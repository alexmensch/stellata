// Pure math for camera-anywhere geometric eclipse photometry on
// binary pairs with orbital elements. See
// src/client/binaries/README.md § Eclipse photometry.

export interface Vec3Ro { readonly x: number; readonly y: number; readonly z: number; }

/** Positive lower bound for the dim multiplier `eclipseDim` returns.
 *  Keeps `-2.5·log10(dim)` finite at a full geometric eclipse; the
 *  resulting ~7.5 mag of dim reads as effectively invisible under
 *  the glow pass's additive blend. See
 *  `src/client/binaries/README.md` § Eclipse photometry. */
export const DIM_FLOOR = 0.001;

export interface EclipseResult {
  /** Multiplicative dim factor on the BACK star's flux. 1.0 = no
   *  occlusion (no overlap, or front coincides with back so the back
   *  is fully visible). 0.0 = back fully occluded. The front star is
   *  not dimmed. */
  dim: number;
  /** Which member of the pair is in front of the other from the
   *  camera's viewpoint. 'primary' means d_primary < d_secondary;
   *  the secondary is the back star and carries the dim factor. */
  front: 'primary' | 'secondary';
}

/** Closed-form intersection area of two circles of radii (r1, r2) whose
 *  centres are separated by `d` (same units). Returns 0 when the circles
 *  are disjoint and π·min(r1, r2)² when one fully contains the other.
 *  Handles the degenerate `d = 0` (concentric) case as full coverage of
 *  the smaller disc. */
export function circleCircleLensArea(r1: number, r2: number, d: number): number {
  if (r1 <= 0 || r2 <= 0) return 0;
  const sum = r1 + r2;
  if (d >= sum) return 0;
  const rMin = Math.min(r1, r2);
  const rMax = Math.max(r1, r2);
  if (d <= rMax - rMin) return Math.PI * rMin * rMin;
  // Partial overlap. The standard two-circle lens formula:
  //   A = r1²·acos((d² + r1² − r2²) / (2·d·r1))
  //     + r2²·acos((d² + r2² − r1²) / (2·d·r2))
  //     − ½·√((−d+r1+r2)(d+r1−r2)(d−r1+r2)(d+r1+r2))
  // The acos arguments stay in [-1, 1] by construction over the partial-
  // overlap range, but float rounding can nudge them outside near the
  // boundary — clamp defensively so acos doesn't produce NaN.
  const d2 = d * d;
  const r1Sq = r1 * r1;
  const r2Sq = r2 * r2;
  const a1 = clamp((d2 + r1Sq - r2Sq) / (2 * d * r1), -1, 1);
  const a2 = clamp((d2 + r2Sq - r1Sq) / (2 * d * r2), -1, 1);
  const root = Math.max(
    0,
    (-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2),
  );
  return r1Sq * Math.acos(a1) + r2Sq * Math.acos(a2) - 0.5 * Math.sqrt(root);
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export interface EclipseInputs {
  /** Primary world position (any consistent frame — local or absolute,
   *  both must match `secondary` and `camera`). */
  primary: Vec3Ro;
  /** Secondary world position. Already perturbed by BinaryOrbitField. */
  secondary: Vec3Ro;
  /** Camera position in the same frame. */
  camera: Vec3Ro;
  /** Primary stellar radius, pc (same unit basis as positions). */
  radiusPrimaryPc: number;
  /** Secondary stellar radius, pc. */
  radiusSecondaryPc: number;
}

/** Image-plane geometric occlusion for a binary pair. Decomposes the
 *  3D separation onto (line-of-sight, perpendicular) using the camera→
 *  primary direction, runs the closed-form lens area against each
 *  component's angular disc, and reports the dim multiplier on the
 *  back component's flux.
 *
 *  The math is purely geometric (no Teff weighting) — each member of the
 *  pair is its own renderer instance with its own appMag, so dimming
 *  the back instance's flux by (1 − occluded_area / disc_area) gives
 *  the right composite when the two are additively summed at sub-pixel
 *  scale. Surface-brightness ratios are implicitly carried by each
 *  instance's absmag (which integrates Teff⁴ × R² already).
 *
 *  Returns `{ dim: 1, front: 'primary' }` for inputs that would produce
 *  no signal (no overlap, zero radii, degenerate distances). The `front`
 *  field is meaningful only when `dim < 1`. */
export function eclipseDim(inputs: EclipseInputs): EclipseResult {
  const { primary, secondary, camera, radiusPrimaryPc, radiusSecondaryPc } = inputs;

  const dPx = primary.x - camera.x;
  const dPy = primary.y - camera.y;
  const dPz = primary.z - camera.z;
  const dPri = Math.sqrt(dPx * dPx + dPy * dPy + dPz * dPz);

  const dSx = secondary.x - camera.x;
  const dSy = secondary.y - camera.y;
  const dSz = secondary.z - camera.z;
  const dSec = Math.sqrt(dSx * dSx + dSy * dSy + dSz * dSz);

  if (dPri <= 0 || dSec <= 0) return { dim: 1, front: 'primary' };

  // Angular radius of each disc as seen from the camera.
  const alphaPri = radiusPrimaryPc / dPri;
  const alphaSec = radiusSecondaryPc / dSec;
  if (alphaPri <= 0 && alphaSec <= 0) return { dim: 1, front: 'primary' };

  // Angular separation. Compute via dot product of unit camera→star
  // vectors — stable for both small and wide angles, no cancellation
  // when the two stars are nearly co-aligned.
  const uPx = dPx / dPri;
  const uPy = dPy / dPri;
  const uPz = dPz / dPri;
  const uSx = dSx / dSec;
  const uSy = dSy / dSec;
  const uSz = dSz / dSec;
  const dot = clamp(uPx * uSx + uPy * uSy + uPz * uSz, -1, 1);
  const theta = Math.acos(dot);

  const lensArea = circleCircleLensArea(alphaPri, alphaSec, theta);
  if (lensArea <= 0) return { dim: 1, front: 'primary' };

  // Whichever star is farther is the BACK component; its flux drops.
  const front: 'primary' | 'secondary' = dPri <= dSec ? 'primary' : 'secondary';
  const alphaBack = front === 'primary' ? alphaSec : alphaPri;
  if (alphaBack <= 0) return { dim: 1, front };
  const backDiscArea = Math.PI * alphaBack * alphaBack;
  const dim = clamp(1 - lensArea / backDiscArea, DIM_FLOOR, 1);
  return { dim, front };
}
