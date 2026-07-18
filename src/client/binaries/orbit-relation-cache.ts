// Shared per-relation orbital cache for the runtime binary fields
// (orbit perturbation + eclipse photometry). See
// src/client/binaries/README.md § Tier mapping.

import { J2000_JD } from '../util/astronomy-constants';
import {
  evaluateOrbitOffsetPc,
  type OrbitalElements,
  type Vec3,
} from './binary-orbit-pure';
import {
  FLAG_HAS_ORBIT,
  FLAG_HAS_INCLINATION,
  type BinariesData,
  type BinaryRelation,
} from './binaries-loader';

/** Per-relation cache populated once per attach. Cheap to keep — at
 *  ~900 binary records the whole list is well under 100 KB. */
export interface OrbitRelationCache {
  /** Index back into `BinariesData.relations`. */
  relationIdx: number;
  /** Tier (1 or 2). Tier 3 records aren't cached; they never animate. */
  tier: 1 | 2;
  /** Orbital elements pulled from the relation, in the units the pure
   *  layer expects. */
  elements: OrbitalElements;
  /** R(baseline) as a float64 ICRS pc vector — the sole cached epoch
   *  geometry. The consumers add ΔR(t) to it, giving rendered rel = R(t)
   *  exactly. Baseline epoch = sepPaEpochJd (the epoch the stored catalog
   *  separation was measured at, NOT J2000), falling back to J2000 when
   *  the record carries none. See README § Tier mapping for why this
   *  replaces the float32 slot diff. */
  baseDiffPc: Vec3;
  /** Peak relative-separation envelope, AU. a · (1 + e). Used by the
   *  screen-separation LOD as the worst-case sub-pixel test. */
  peakSepAU: number;
}

export function relationToElements(r: BinaryRelation): OrbitalElements {
  // NaN-safe defaults for Tier 2 where Ω may be absent — the Tier 2
  // path ignores Ω entirely, so a NaN would silently propagate into
  // unused math but it's cleaner to zero it for log/debug clarity.
  return {
    P: r.pDays,
    T: r.tJd,
    e: r.e,
    a: r.aAU,
    i: Number.isFinite(r.iRad) ? r.iRad : 0,
    omega: Number.isFinite(r.omegaRad) ? r.omegaRad : 0,
    Omega: Number.isFinite(r.OmegaRad) ? r.OmegaRad : 0,
    q: r.q,
  };
}

/** Tier + elements for a Kepler-evaluable relation, or null for a Tier-3
 *  (no has_orbit) or malformed record whose ΔR(t) would go NaN. The
 *  has_orbit + finite gate: `has_orbit=1` should imply P, T, e, a, ω, q
 *  finite, so a violating record is skipped rather than poisoning every
 *  downstream consumer. Shared by the per-frame cache builder and the
 *  focus-gated orbit-path layer. */
export function keplerRelationParams(
  r: BinaryRelation,
): { tier: 1 | 2; elements: OrbitalElements } | null {
  if ((r.flags & FLAG_HAS_ORBIT) === 0) return null;
  if (
    !Number.isFinite(r.q) || !Number.isFinite(r.aAU)
    || !Number.isFinite(r.e) || !Number.isFinite(r.pDays)
    || !Number.isFinite(r.tJd) || !Number.isFinite(r.omegaRad)
  ) return null;
  const tier: 1 | 2 = (r.flags & FLAG_HAS_INCLINATION) !== 0 ? 1 : 2;
  return { tier, elements: relationToElements(r) };
}

/** Build one cache entry per Kepler-evaluable relation.
 *  `absolutePositions` is the catalog-wide xyz buffer; relations whose
 *  member indices fall outside it are skipped (defensive against a
 *  binaries.bin / catalog.bin generation mismatch). */
export function buildOrbitRelationCaches(
  binaries: BinariesData,
  absolutePositions: Float32Array,
): OrbitRelationCache[] {
  const absLength = absolutePositions.length;
  const out: OrbitRelationCache[] = [];
  const relations = binaries.relations;
  for (let i = 0; i < relations.length; i++) {
    const r = relations[i];
    const params = keplerRelationParams(r);
    if (params === null) continue;
    if (r.primaryIdx * 3 + 2 >= absLength || r.secondaryIdx * 3 + 2 >= absLength) continue;
    const { tier, elements } = params;
    const baselineJd = Number.isFinite(r.sepPaEpochJd)
      ? r.sepPaEpochJd
      : J2000_JD;
    const pBase = r.primaryIdx * 3;
    // R(baseline) as an ICRS pc vector. The primary's float32 catalog xyz
    // is a tangent-basis anchor only (same anchor the per-frame eval uses),
    // so a float32 read here is fine; the RELATIVE geometry rides entirely
    // on the elements. Adding ΔR(t) = R(t) − R(baseline) gives rendered
    // rel = R(t) exactly for every pair — the sub-resolution collocated
    // case included, no special path.
    const baseDiffPc = evaluateOrbitOffsetPc(elements, tier, baselineJd, {
      x: absolutePositions[pBase],
      y: absolutePositions[pBase + 1],
      z: absolutePositions[pBase + 2],
    });
    out.push({
      relationIdx: i,
      tier,
      elements,
      baseDiffPc,
      peakSepAU: elements.a * (1 + elements.e),
    });
  }
  return out;
}

/** Per-frame ΔR(t) = R(t) − R(baseline) in ICRS pc for a cached
 *  relation. `systemXyzPc` anchors the Tier-1 tangent basis (ignored
 *  for Tier 2) — the same anchor `baseDiffPc` was built with, so the
 *  R(baseline) terms cancel exactly. */
export function evaluateOrbitRelationDeltaPc(
  rc: OrbitRelationCache,
  tJd: number,
  systemXyzPc: Vec3,
): Vec3 {
  const rt = evaluateOrbitOffsetPc(rc.elements, rc.tier, tJd, systemXyzPc);
  return {
    x: rt.x - rc.baseDiffPc.x,
    y: rt.y - rc.baseDiffPc.y,
    z: rt.z - rc.baseDiffPc.z,
  };
}
