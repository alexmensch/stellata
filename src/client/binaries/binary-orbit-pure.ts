// Pure orbital math for binaries: Kepler + Thiele-Innes + tangent-plane
// (Tier 1) and galactic-plane fallback (Tier 2). See
// src/client/binaries/README.md § Tier mapping.

import * as THREE from 'three';
import { AU_PC, J2000_JD } from '../util/astronomy-constants';
import { solveKepler } from '../util/kepler-solver';
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
  /** Mass ratio M_secondary / M_primary in (0, 1]. */
  q: number;
}

/** Sky-plane separation of B relative to A at JDE `tJd`, AU. North=+X,
 *  east=+Y. Thiele-Innes; single Kepler solve. Tier 1 only — requires
 *  a published inclination. */
export function evaluateOrbitSkyAU(
  elements: OrbitalElements,
  tJd: number,
): { northAU: number; eastAU: number } {
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

/** Convert a sky-plane separation (north, east) in pc at a system whose
 *  ICRS position is `systemXyzPc` into an ICRS Δxyz in pc. Tangent-plane
 *  projection; the d term cancels because the input is linear units (pc),
 *  not angular. */
export function projectSkyToICRS(
  systemXyzPc: Vec3,
  northPc: number,
  eastPc: number,
): Vec3 {
  const r = Math.hypot(systemXyzPc.x, systemXyzPc.y, systemXyzPc.z);
  if (r === 0) return { x: 0, y: 0, z: 0 };
  const dec = Math.asin(systemXyzPc.z / r);
  const ra = Math.atan2(systemXyzPc.y, systemXyzPc.x);
  const sinRa = Math.sin(ra), cosRa = Math.cos(ra);
  const sinDec = Math.sin(dec), cosDec = Math.cos(dec);
  return {
    x: northPc * (-sinDec * cosRa) + eastPc * (-sinRa),
    y: northPc * (-sinDec * sinRa) + eastPc * cosRa,
    z: northPc * cosDec,
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

/** Tier 1 per-component ICRS Δxyz (pc) for `elements` at JDE `tJd`. The
 *  stored catalog xyz already encodes the J2000 offset baked-in via the
 *  ΔR(t) − R(J2000) baseline contract, split q : (1−q) between A and B.
 *
 *  Two Kepler solves per call (now + J2000). For per-frame use the runtime
 *  field caches `R(J2000)` separately and calls `evaluateOrbitSkyAU`
 *  directly. */
export function evaluateBinaryOffsetTier1(
  elements: OrbitalElements,
  tJd: number,
  isSecondary: boolean,
  systemXyzPc: Vec3,
): Vec3 {
  const now = evaluateOrbitSkyAU(elements, tJd);
  const ref = evaluateOrbitSkyAU(elements, J2000_JD);
  const sign = isSecondary ? (1 - elements.q) : -elements.q;
  const dnPc = (now.northAU - ref.northAU) * AU_PC * sign;
  const dePc = (now.eastAU - ref.eastAU) * AU_PC * sign;
  return projectSkyToICRS(systemXyzPc, dnPc, dePc);
}

/** Tier 2 per-component ICRS Δxyz (pc) for `elements` at JDE `tJd`.
 *  Galactic-plane fallback when inclination is unknown. */
export function evaluateBinaryOffsetTier2(
  elements: OrbitalElements,
  tJd: number,
  isSecondary: boolean,
): Vec3 {
  const now = evaluateOrbitInPlaneAU(elements, tJd);
  const ref = evaluateOrbitInPlaneAU(elements, J2000_JD);
  const sign = isSecondary ? (1 - elements.q) : -elements.q;
  const dxPc = (now.xAU - ref.xAU) * AU_PC * sign;
  const dyPc = (now.yAU - ref.yAU) * AU_PC * sign;
  return projectGalacticPlaneToICRS(dxPc, dyPc);
}
