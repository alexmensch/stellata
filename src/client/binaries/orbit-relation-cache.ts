// Shared per-relation orbital cache for the runtime binary fields
// (orbit perturbation + eclipse photometry). See
// src/client/binaries/README.md § Tier mapping.

import { AU_PC, J2000_JD } from '../util/astronomy-constants';
import {
  evaluateOrbitSkyAU,
  evaluateOrbitInPlaneAU,
  evaluateOrbitDeltaPcTier1,
  evaluateOrbitDeltaPcTier2,
  projectSkyToICRS,
  projectGalacticPlaneToICRS,
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
  /** Tier-1 R(baseline) cached so per-frame eval is a single Kepler
   *  solve (now) plus a subtract. Baseline epoch = sepPaEpochJd — the
   *  epoch the stored catalog separation was measured at, NOT J2000 —
   *  falling back to J2000 when the record carries none. */
  refSkyAU: { northAU: number; eastAU: number; radialAU: number } | null;
  /** Tier-2 R(baseline) cached. {xAU, yAU} in the orbit plane. */
  refInPlaneAU: { xAU: number; yAU: number } | null;
  /** R(baseline) as a float64 ICRS pc vector — the epoch relative offset
   *  the consumers add ΔR(t) to, giving rendered rel = R(t) exactly. This
   *  is the elements-alone geometry seam: it replaces subtracting two
   *  float32 catalog positions (which quantises to grid noise for tight
   *  pairs and carries any WDS/Kepler placement disagreement into the
   *  rendered orbit centre). */
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
    if ((r.flags & FLAG_HAS_ORBIT) === 0) continue;
    // binaries.bin invariant restated at the consumer: has_orbit=1
    // implies all elements needed for ΔR(t) are finite (P, T, e, a,
    // ω, q — i and Ω fall back to 0 in relationToElements). A record
    // that violates that contract would drive the per-frame eval to
    // NaN ΔR, poisoning every downstream consumer. Skip the cache
    // entry so the relation stays at its catalog baseline.
    if (
      !Number.isFinite(r.q) || !Number.isFinite(r.aAU)
      || !Number.isFinite(r.e) || !Number.isFinite(r.pDays)
      || !Number.isFinite(r.tJd) || !Number.isFinite(r.omegaRad)
    ) continue;
    if (r.primaryIdx * 3 + 2 >= absLength || r.secondaryIdx * 3 + 2 >= absLength) continue;
    const tier: 1 | 2 = (r.flags & FLAG_HAS_INCLINATION) !== 0 ? 1 : 2;
    const elements = relationToElements(r);
    const baselineJd = Number.isFinite(r.sepPaEpochJd)
      ? r.sepPaEpochJd
      : J2000_JD;
    const pBase = r.primaryIdx * 3;
    const refSkyAU = tier === 1 ? evaluateOrbitSkyAU(elements, baselineJd) : null;
    const refInPlaneAU = tier === 2 ? evaluateOrbitInPlaneAU(elements, baselineJd) : null;
    // R(baseline) as an ICRS pc vector. The primary's float32 catalog xyz
    // is a tangent-basis anchor only (same anchor evaluateDelta uses per
    // frame), so a float32 read here is fine; the RELATIVE geometry rides
    // entirely on the elements. Adding ΔR(t) = R(t) − R(baseline) gives
    // rendered rel = R(t) exactly for every pair — the sub-resolution
    // collocated case included, no special path.
    const baseDiffPc: Vec3 = tier === 1
      ? projectSkyToICRS(
          {
            x: absolutePositions[pBase],
            y: absolutePositions[pBase + 1],
            z: absolutePositions[pBase + 2],
          },
          refSkyAU!.northAU * AU_PC,
          refSkyAU!.eastAU * AU_PC,
          refSkyAU!.radialAU * AU_PC,
        )
      : projectGalacticPlaneToICRS(refInPlaneAU!.xAU * AU_PC, refInPlaneAU!.yAU * AU_PC);
    out.push({
      relationIdx: i,
      tier,
      elements,
      refSkyAU,
      refInPlaneAU,
      baseDiffPc,
      peakSepAU: elements.a * (1 + elements.e),
    });
  }
  return out;
}

/** Per-frame ΔR(t) = R(t) − R(baseline) in ICRS pc for a cached
 *  relation. `systemXyzPc` anchors the Tier-1 tangent basis (ignored
 *  for Tier 2). */
export function evaluateOrbitRelationDeltaPc(
  rc: OrbitRelationCache,
  tJd: number,
  systemXyzPc: Vec3,
): Vec3 {
  return rc.tier === 1
    ? evaluateOrbitDeltaPcTier1(rc.elements, rc.refSkyAU!, tJd, systemXyzPc)
    : evaluateOrbitDeltaPcTier2(rc.elements, rc.refInPlaneAU!, tJd);
}
