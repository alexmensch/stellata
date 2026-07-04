// Pure math for camera-anywhere geometric eclipse photometry on
// binary pairs with orbital elements. See
// src/client/binaries/README.md § Eclipse photometry.

import {
  evaluateOrbitSkyAU,
  projectSkyToICRS,
  projectGalacticPlaneToICRS,
  type OrbitalElements,
  type Vec3,
} from './binary-orbit-pure';

/** Positive lower bound for the dim multiplier `eclipseDimFromOffsets`
 *  returns. Keeps `-2.5·log10(dim)` finite at a full geometric eclipse;
 *  the resulting ~7.5 mag of dim reads as effectively invisible under
 *  the glow pass's additive blend. See
 *  `src/client/binaries/README.md` § Eclipse photometry. */
export const DIM_FLOOR = 0.001;

export interface EclipseResult {
  /** Multiplicative dim factor on the BACK star's flux. 1.0 = no
   *  occlusion. `DIM_FLOOR` = back fully occluded. The front star is
   *  not dimmed. */
  dim: number;
  /** Which member of the pair is in front of the other from the
   *  camera's viewpoint. 'primary' means d_primary < d_secondary;
   *  the secondary is the back star and carries the dim factor.
   *  Valid whenever `alphaPri > 0 && alphaSec > 0` (i.e. a real
   *  evaluation, overlapping or not) — the disc-pass depth-bias trigger
   *  reads it across the wider rendered-overlap annulus where `dim` is
   *  still 1. Meaningless only on the no-signal early-outs. */
  front: 'primary' | 'secondary';
  /** Diagnostics for the debug HUD — 0 on the no-signal early-outs. */
  thetaRad: number;
  alphaPri: number;
  alphaSec: number;
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

const NO_SIGNAL: EclipseResult = {
  dim: 1, front: 'primary', thetaRad: 0, alphaPri: 0, alphaSec: 0,
};

/** Image-plane geometric occlusion for a binary pair, from the pair's
 *  RELATIVE offset rather than two absolute positions. The relative
 *  offset comes from the float64 orbital evaluation; absolute positions
 *  live in a float32 buffer whose quantum (≈0.6 AU at 25 pc from the
 *  local origin) exceeds typical pair separations, so a subtraction of
 *  two buffer positions cannot resolve this geometry.
 *
 *  Inputs: `los*` is camera→primary in pc (float32-derived is fine — it
 *  only sets the view direction and distance); `rel*` is secondary −
 *  primary in pc (must carry float64 orbital precision); radii in pc.
 *
 *  The math is purely geometric (no Teff weighting) — each member of the
 *  pair is its own renderer instance with its own appMag, so dimming
 *  the back instance's flux by (1 − occluded_area / disc_area) gives
 *  the right composite when the two are additively summed at sub-pixel
 *  scale. Surface-brightness ratios are implicitly carried by each
 *  instance's absmag (which integrates Teff⁴ × R² already). Uniform
 *  disc surface brightness (no limb darkening).
 *
 *  Returns `{ dim: 1, front: 'primary' }` for inputs that would produce
 *  no signal (no overlap, zero radii or offsets, camera inside either
 *  disc — the resolved disc pass owns that regime). The `front` field
 *  is meaningful only when `dim < 1`. */
export function eclipseDimFromOffsets(
  losXPc: number, losYPc: number, losZPc: number,
  relXPc: number, relYPc: number, relZPc: number,
  radiusPrimaryPc: number,
  radiusSecondaryPc: number,
): EclipseResult {
  const relLenSq = relXPc * relXPc + relYPc * relYPc + relZPc * relZPc;
  if (relLenSq <= 0) return NO_SIGNAL;

  const dPri = Math.sqrt(losXPc * losXPc + losYPc * losYPc + losZPc * losZPc);
  const sX = losXPc + relXPc;
  const sY = losYPc + relYPc;
  const sZ = losZPc + relZPc;
  const dSec = Math.sqrt(sX * sX + sY * sY + sZ * sZ);
  if (dPri <= radiusPrimaryPc * 2 || dSec <= radiusSecondaryPc * 2) return NO_SIGNAL;

  const alphaPri = radiusPrimaryPc / dPri;
  const alphaSec = radiusSecondaryPc / dSec;
  if (alphaPri <= 0 && alphaSec <= 0) return NO_SIGNAL;

  // Angular separation via atan2(|cross|, dot) of the unit view vectors —
  // exact at wide angles and, unlike acos, not precision-limited near 0.
  // Both unit vectors derive from the SAME los vector, so its float32
  // quantization cancels in the angle between them; the angle carries
  // rel's float64 precision.
  const uPx = losXPc / dPri, uPy = losYPc / dPri, uPz = losZPc / dPri;
  const uSx = sX / dSec, uSy = sY / dSec, uSz = sZ / dSec;
  const cX = uPy * uSz - uPz * uSy;
  const cY = uPz * uSx - uPx * uSz;
  const cZ = uPx * uSy - uPy * uSx;
  const sinT = Math.sqrt(cX * cX + cY * cY + cZ * cZ);
  const cosT = uPx * uSx + uPy * uSy + uPz * uSz;
  const theta = Math.atan2(sinT, cosT);

  // Whichever star is farther is the BACK component; its flux drops.
  // sign(dSec − dPri) = sign(dSec² − dPri²) = sign(2·los·rel + |rel|²),
  // formed from rel directly so the comparison keeps rel's precision
  // instead of differencing two large near-equal distances. Computed
  // before the overlap test so the depth-bias trigger has a valid
  // front/back verdict across the rendered-overlap annulus (dim == 1).
  const discr = 2 * (losXPc * relXPc + losYPc * relYPc + losZPc * relZPc) + relLenSq;
  const front: 'primary' | 'secondary' = discr >= 0 ? 'primary' : 'secondary';

  const lensArea = circleCircleLensArea(alphaPri, alphaSec, theta);
  if (lensArea <= 0) {
    return { dim: 1, front, thetaRad: theta, alphaPri, alphaSec };
  }

  const alphaBack = front === 'primary' ? alphaSec : alphaPri;
  if (alphaBack <= 0) return { dim: 1, front, thetaRad: theta, alphaPri, alphaSec };
  const backDiscArea = Math.PI * alphaBack * alphaBack;
  const dim = clamp(1 - lensArea / backDiscArea, DIM_FLOOR, 1);
  return { dim, front, thetaRad: theta, alphaPri, alphaSec };
}

/** Unit normal of a cached relation's orbit plane in ICRS. Convention-
 *  proof: sampled from the same evaluation + projection path the
 *  renderer uses, so it can't drift from the rendered orbit. Returns
 *  null when the two samples are near-collinear (degenerate elements) —
 *  callers must then treat every view direction as eclipse-capable. */
export function orbitPlaneNormalICRS(
  tier: 1 | 2,
  elements: OrbitalElements,
  systemXyzPc: Vec3,
): Vec3 | null {
  if (tier === 2) {
    const v1 = projectGalacticPlaneToICRS(1, 0);
    const v2 = projectGalacticPlaneToICRS(0, 1);
    return unitCross(v1, v2);
  }
  const s1 = evaluateOrbitSkyAU(elements, elements.T);
  const v1 = projectSkyToICRS(systemXyzPc, s1.northAU, s1.eastAU, s1.radialAU);
  for (const phase of [0.25, 0.125, 0.375]) {
    const s2 = evaluateOrbitSkyAU(elements, elements.T + elements.P * phase);
    const v2 = projectSkyToICRS(systemXyzPc, s2.northAU, s2.eastAU, s2.radialAU);
    const n = unitCross(v1, v2);
    if (n !== null) return n;
  }
  return null;
}

function unitCross(a: Vec3, b: Vec3): Vec3 | null {
  const x = a.y * b.z - a.z * b.y;
  const y = a.z * b.x - a.x * b.z;
  const z = a.x * b.y - a.y * b.x;
  const len = Math.hypot(x, y, z);
  const scale = Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z);
  if (!(len > scale * 1e-9)) return null;
  return { x: x / len, y: y / len, z: z / len };
}
