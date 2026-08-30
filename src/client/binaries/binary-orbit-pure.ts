// Pure orbital math for binaries: Kepler + Thiele-Innes + tangent-plane
// (Tier 1) and galactic-plane fallback (Tier 2). See
// src/client/binaries/README.md § Tier mapping.

import * as THREE from 'three';
import { AU_PC } from '../util/astronomy-constants';
import { solveKepler } from '../util/kepler-solver';
import { equatorialTangentBasisAt } from '../util/equatorial-basis';
import { GAL_TO_ICRS } from '../galactic/galactic-coords';

export interface Vec3 { x: number; y: number; z: number; }

export interface OrbitalElements {
  /** Period, days. */
  P: number;
  /** Periastron-passage epoch, JD. */
  T: number;
  /** Eccentricity in [0, 1). */
  e: number;
  /** Semi-major axis, AU. */
  a: number;
  /** Inclination, rad. Ignored when has_inclination=0 (caller passes 0). */
  i: number;
  /** Argument of periastron, rad. */
  omega: number;
  /** Longitude of ascending node, rad. Ignored in Tier 2. */
  Omega: number;
  /** Mass-fraction split q = M_secondary / (M_primary + M_secondary).
   *  Primary moves by −q·R, secondary by +(1−q)·R about the barycentre. */
  q: number;
}

/** Separation of B relative to A at Julian Date `tJd`, AU. North=+X, east=+Y on
 *  the sky tangent plane; `radialAU` is the line-of-sight component,
 *  positive = receding from Sol (Z = r·sin(ν+ω)·sin i). Thiele-Innes;
 *  single Kepler solve. Tier 1 only — requires a published inclination.
 *
 *  Pure-astrometric orbits (ORB6 visual pairs without radial-velocity
 *  data) carry a ±180° ascending-node ambiguity, so `radialAU`'s SIGN is
 *  convention-resolved, not observed — front/back at conjunction is the
 *  published node's choice. The magnitude and the tangent components are
 *  unaffected. */
export function evaluateOrbitSkyAU(
  elements: OrbitalElements,
  tJd: number,
): { northAU: number; eastAU: number; radialAU: number } {
  const { P, T, e, a, i, omega, Omega } = elements;
  const M = (2 * Math.PI * (tJd - T)) / P;
  const E = solveKepler(M, e);
  const cosO = Math.cos(omega), sinO = Math.sin(omega);
  const cosN = Math.cos(Omega), sinN = Math.sin(Omega);
  const cosI = Math.cos(i);
  const A = cosO * cosN - sinO * sinN * cosI;
  const B = cosO * sinN + sinO * cosN * cosI;
  const F = -sinO * cosN - cosO * sinN * cosI;
  const G = -sinO * sinN + cosO * cosN * cosI;
  const X = Math.cos(E) - e;
  const Y = Math.sqrt(Math.max(0, 1 - e * e)) * Math.sin(E);
  return {
    northAU: a * (A * X + F * Y),
    eastAU: a * (B * X + G * Y),
    radialAU: a * Math.sin(i) * (sinO * X + cosO * Y),
  };
}

/** Unit normal of the orbital plane in the sky frame (north, east, radial)
 *  — `(sin i sin Ω, −sin i cos Ω, cos i)`, the cross product of the
 *  Thiele-Innes periastron and quadrature vectors. Static in `t`: the plane
 *  is a property of the elements, so no Kepler solve enters.
 *
 *  Tier 1 only. Tier 2's plane is the galactic-plane convention rather than
 *  a measurement (README § Tier mapping), and a caller levelling a view on
 *  it would be dressing a default as an observation. */
export function orbitNormalSky(
  elements: OrbitalElements,
): { north: number; east: number; radial: number } {
  const sinI = Math.sin(elements.i);
  return {
    north: sinI * Math.sin(elements.Omega),
    east: -sinI * Math.cos(elements.Omega),
    radial: Math.cos(elements.i),
  };
}

/** In-plane orbital position (AU) rotated by ω so periastron sits along
 *  the local x-axis. Used by Tier 2: the orbit plane is the galactic
 *  plane, so this 2D vector is placed in galactic-XY before rotating to
 *  ICRS. Ω is irrelevant here (no ascending node when i=0). */
export function evaluateOrbitInPlaneAU(
  elements: OrbitalElements,
  tJd: number,
): { xAU: number; yAU: number } {
  const { P, T, e, a, omega } = elements;
  const M = (2 * Math.PI * (tJd - T)) / P;
  const E = solveKepler(M, e);
  const X = Math.cos(E) - e;
  const Y = Math.sqrt(Math.max(0, 1 - e * e)) * Math.sin(E);
  const cosO = Math.cos(omega), sinO = Math.sin(omega);
  return {
    xAU: a * (cosO * X - sinO * Y),
    yAU: a * (sinO * X + cosO * Y),
  };
}

/** Instantaneous relative separation |R(t)| in AU — r = a(1 − e·cos E).
 *  Orientation-free, so Tier 2's fallback plane cannot skew it (README
 *  § Tier mapping). One Kepler solve, no projection. */
export function evaluateOrbitSeparationAU(
  elements: OrbitalElements,
  tJd: number,
): number {
  const { P, T, e, a } = elements;
  const E = solveKepler((2 * Math.PI * (tJd - T)) / P, e);
  return a * (1 - e * Math.cos(E));
}

/** Convert a sky-frame separation (north, east, radial) in pc at a
 *  system whose ICRS position is `systemXyzPc` into an ICRS Δxyz in pc.
 *  Tangent-plane projection for the sky components; the radial component
 *  rides along the Sol→system unit vector (positive = receding). The d
 *  term cancels because the input is linear units (pc), not angular. */
export function projectSkyToICRS(
  systemXyzPc: Vec3,
  northPc: number,
  eastPc: number,
  radialPc = 0,
): Vec3 {
  const at = equatorialTangentBasisAt(systemXyzPc.x, systemXyzPc.y, systemXyzPc.z);
  if (at === null) return { x: 0, y: 0, z: 0 };
  const { u, east, north } = at.basis;
  return {
    x: northPc * north.x + eastPc * east.x + radialPc * u.x,
    y: northPc * north.y + eastPc * east.y + radialPc * u.y,
    z: northPc * north.z + eastPc * east.z + radialPc * u.z,
  };
}

const gal4 = new THREE.Vector4();

/** Convert a galactic-plane vector (xGal, yGal) in pc into ICRS Δxyz in
 *  pc. Tier 2 path: the orbit normal is the North Galactic Pole; the
 *  in-plane (x, y) coords ride directly into the galactic-X / galactic-Y
 *  axes, then the standard galactic→ICRS rotation places them in ICRS. */
export function projectGalacticPlaneToICRS(
  xGalPc: number,
  yGalPc: number,
): Vec3 {
  gal4.set(xGalPc, yGalPc, 0, 0).applyMatrix4(GAL_TO_ICRS);
  return { x: gal4.x, y: gal4.y, z: gal4.z };
}

/** Full relative ICRS offset R(t) in pc — B relative to A at Julian Date `tJd`,
 *  the rendered pair offset (elements-alone; no baked-catalog term). Tier 1
 *  projects the sky separation through the system's tangent basis; Tier 2
 *  rides the galactic plane. One Kepler solve. The runtime caches R(epoch)
 *  from this and renders R(epoch) + ΔR(t) = R(t). */
export function evaluateOrbitOffsetPc(
  elements: OrbitalElements,
  tier: 1 | 2,
  tJd: number,
  systemXyzPc: Vec3,
): Vec3 {
  if (tier === 1) {
    const s = evaluateOrbitSkyAU(elements, tJd);
    return projectSkyToICRS(
      systemXyzPc, s.northAU * AU_PC, s.eastAU * AU_PC, s.radialAU * AU_PC,
    );
  }
  const p = evaluateOrbitInPlaneAU(elements, tJd);
  return projectGalacticPlaneToICRS(p.xAU * AU_PC, p.yAU * AU_PC);
}

/** Tier 1 full relative ICRS Δxyz (pc): R_B(t) − R_A(t) about the
 *  barycentre, expressed as a pc-valued ICRS offset. Caller supplies the
 *  cached baseline reference `refSky` (single Kepler solve per call) and
 *  applies the q : (1−q) barycentric split — or the focal-star rebase —
 *  outside. */
export function evaluateOrbitDeltaPcTier1(
  elements: OrbitalElements,
  refSky: { northAU: number; eastAU: number; radialAU: number },
  tJd: number,
  systemXyzPc: Vec3,
): Vec3 {
  const now = evaluateOrbitSkyAU(elements, tJd);
  const dnPc = (now.northAU - refSky.northAU) * AU_PC;
  const dePc = (now.eastAU - refSky.eastAU) * AU_PC;
  const drPc = (now.radialAU - refSky.radialAU) * AU_PC;
  return projectSkyToICRS(systemXyzPc, dnPc, dePc, drPc);
}

/** Tier 2 full relative ICRS Δxyz (pc): galactic-plane fallback when
 *  inclination is unknown. Caller supplies the cached baseline reference
 *  `refInPlane`. No sign — caller splits. */
export function evaluateOrbitDeltaPcTier2(
  elements: OrbitalElements,
  refInPlane: { xAU: number; yAU: number },
  tJd: number,
): Vec3 {
  const now = evaluateOrbitInPlaneAU(elements, tJd);
  const dxPc = (now.xAU - refInPlane.xAU) * AU_PC;
  const dyPc = (now.yAU - refInPlane.yAU) * AU_PC;
  return projectGalacticPlaneToICRS(dxPc, dyPc);
}

/** Tier 1 per-component ICRS Δxyz (pc) for `elements` at Julian Date `tJd`. The
 *  stored catalog xyz encodes the pair configuration at `refJd` (the
 *  sep+PA measurement epoch), so the offset is R(t) − R(refJd), split
 *  q : (1−q) between A and B.
 *
 *  Two Kepler solves per call (now + refJd). For per-frame use the
 *  runtime field caches `R(refJd)` and calls `evaluateOrbitDeltaPcTier1`
 *  directly. */
export function evaluateBinaryOffsetTier1(
  elements: OrbitalElements,
  tJd: number,
  refJd: number,
  isSecondary: boolean,
  systemXyzPc: Vec3,
): Vec3 {
  const ref = evaluateOrbitSkyAU(elements, refJd);
  const delta = evaluateOrbitDeltaPcTier1(elements, ref, tJd, systemXyzPc);
  const sign = isSecondary ? (1 - elements.q) : -elements.q;
  return { x: delta.x * sign, y: delta.y * sign, z: delta.z * sign };
}

/** Tier 2 per-component ICRS Δxyz (pc) for `elements` at Julian Date `tJd`.
 *  Galactic-plane fallback when inclination is unknown. */
export function evaluateBinaryOffsetTier2(
  elements: OrbitalElements,
  tJd: number,
  refJd: number,
  isSecondary: boolean,
): Vec3 {
  const ref = evaluateOrbitInPlaneAU(elements, refJd);
  const delta = evaluateOrbitDeltaPcTier2(elements, ref, tJd);
  const sign = isSecondary ? (1 - elements.q) : -elements.q;
  return { x: delta.x * sign, y: delta.y * sign, z: delta.z * sign };
}
