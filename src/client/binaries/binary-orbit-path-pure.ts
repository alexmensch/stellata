// Focus-gated orbital-path geometry: the Kepler pairs on the focused
// system's chain, and each pair sampled into two barycentric ellipses.
// See src/client/binaries/README.md § Binary orbit paths.

import { evaluateOrbitOffsetPc, type OrbitalElements, type Vec3 } from './binary-orbit-pure';
import { FLAG_HAS_ORBIT, type BinariesData } from './binaries-loader';
import { focalChainRelationSet } from './focal-chain';

/** Relation indices on the focal star's chain that carry Kepler elements
 *  (has_orbit) — the pairs with a real orbit to trace. Visual companions
 *  (Tier 3, no elements) are excluded, so an unfocused system, a system
 *  of only visual pairs, or a null focal yields none. */
export function keplerChainRelationIdxs(
  binaries: BinariesData | null,
  focalIdx: number | null,
): number[] {
  if (binaries === null || focalIdx === null) return [];
  const out: number[] = [];
  for (const ri of focalChainRelationSet(binaries, focalIdx)) {
    if ((binaries.relations[ri].flags & FLAG_HAS_ORBIT) !== 0) out.push(ri);
  }
  return out;
}

/** Sample one pair's orbit over a full period into the two members'
 *  barycentric ellipses — ICRS pc offsets from the common barycentre,
 *  primary `−q·R(φ)` / secondary `+(1−q)·R(φ)`. See README § Binary
 *  orbit paths. */
export function buildBinaryOrbitRingPoints(
  elements: OrbitalElements,
  tier: 1 | 2,
  systemXyzPc: Vec3,
  segments: number,
): { primary: Float32Array; secondary: Float32Array } {
  const primary = new Float32Array(segments * 3);
  const secondary = new Float32Array(segments * 3);
  const q = elements.q;
  const secCoeff = 1 - q;
  for (let i = 0; i < segments; i++) {
    const tJd = elements.T + (i / segments) * elements.P;
    const r = evaluateOrbitOffsetPc(elements, tier, tJd, systemXyzPc);
    const o = i * 3;
    primary[o] = -q * r.x;
    primary[o + 1] = -q * r.y;
    primary[o + 2] = -q * r.z;
    secondary[o] = secCoeff * r.x;
    secondary[o + 1] = secCoeff * r.y;
    secondary[o + 2] = secCoeff * r.z;
  }
  return { primary, secondary };
}
