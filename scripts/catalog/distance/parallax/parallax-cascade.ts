// The parallax behind every record's distance: Gaia DR3 → HIP2 → CNS5 →
// Gliese V/70A → bibcoded SIMBAD → curated, with the two skip rules. See
// README.md.

import { isGaiaCatalogueBibcode, isHipparcos2Bibcode } from '../gaia-distrust';
import type { GaiaAstrometryCatalogRow, Hip2AstrometryRow } from '../direction-cascade';
import type { CitedParallax } from '../../cited-parallax';
import type { SiblingParallax } from './pair-member-parallax';
import type { GlieseRow } from '../../gliese-parse';

// The two override layers sit above the cascade rather than inside it — each
// replaces the inverted distance wholesale, so they are outcomes of the routing
// and not parallax tiers. `resolveParallax` never returns either.
export const DIST_VIA_VALUES = [
  'bailer_jones',
  'lmc_kinematic',
  'gaia_dr3_inversion',
  'hip2_parallax',
  'cns5_plx',
  'gliese_plx',
  'simbad_plx',
  'pair_member_parallax',
  'curated',
  'none',
] as const;

export type DistVia = (typeof DIST_VIA_VALUES)[number];

/** The `BuildCounts` field each tier reports into. Declared beside the enum so
 *  adding a tier fails to compile until it is pinned, rather than shipping a
 *  route nothing counts. */
export const DIST_VIA_COUNT_KEY = {
  bailer_jones: 'distBailerJones',
  lmc_kinematic: 'distLmcKinematic',
  gaia_dr3_inversion: 'distGaiaDr3Inversion',
  hip2_parallax: 'distHip2Parallax',
  cns5_plx: 'distCns5Plx',
  gliese_plx: 'distGliesePlx',
  simbad_plx: 'distSimbadPlx',
  pair_member_parallax: 'distPairMemberParallax',
  curated: 'distCurated',
  none: 'distNone',
} as const satisfies Record<DistVia, string>;

/** Below this the parallax is not distinguishable from zero, so its inverse is
 *  unbounded above and carries no distance at all — a different failure from
 *  imprecision, which is why this is the gate rather than the ~20% bound that
 *  governs how BIASED an inversion is (Bailer-Jones 2015). Rows between the two
 *  ship, counted as `distHip2LowPrecision`.
 *
 *  Ungated, re-keying this tier off the spine's editorial `dist_src` puts 19
 *  rows past 1,000 pc and one at 25,000 pc off a parallax of S/N 0.11 — the
 *  catastrophic-inversion failure the SU Cru report names. None survives this
 *  gate. */
export const PARALLAX_SN_FLOOR = 1.0;

/** The ~20% fractional error beyond which inverting a parallax is measurably
 *  biased. Not a gate here — these rows have no second source, so refusing
 *  costs the record — but the population is pinned so it stays visible for a
 *  Gaia DR4 revisit. */
export const PARALLAX_LOW_PRECISION_SN = 5.0;

export interface ParallaxSources {
  gaia: GaiaAstrometryCatalogRow | null;
  hip2: Hip2AstrometryRow | null;
  cns5: CitedParallax | null;
  gliese: GlieseRow | null;
  simbad: CitedParallax | null;
  /** The best anchor-grade parallax this record's own bound siblings measured
   *  — `lookupPairMemberParallax`. */
  pairMember: SiblingParallax | null;
}

export interface ParallaxResolution {
  /** mas, always > 0. Null on `curated` (Sol, distance zero by construction)
   *  and on `none`, which is a membership event rather than a value. */
  plxMas: number | null;
  via: DistVia;
  /** The tier's parallax is real but its fractional error exceeds
   *  `PARALLAX_LOW_PRECISION_SN`, so the inverted distance is biased. */
  lowPrecision: boolean;
  /** A tier held a parallax and the skip rule refused it. Distinguishes a row
   *  nothing measured from one whose only measurement this build will not
   *  stand behind — § 5's residual policy requires the two be counted apart. */
  refused: boolean;
}

function usable(plx: number | null): plx is number {
  return plx !== null && plx > 0;
}

function signalToNoise(plx: number, err: number | null): number | null {
  return err !== null && err > 0 ? plx / err : null;
}

/** The parallax a record's distance inverts, resolved through the § 5 cascade.
 *
 *  **Gaia leads, mirroring the direction cascade.** `hip2_saturated` fires only
 *  where Gaia states no usable parallax, and distance follows the same
 *  astrometric solution the position did rather than a second opinion. § 5's
 *  table lists HIP2 above the inversion; that order was written when this tier
 *  fired only for the Gaia-saturated bright set, and re-keyed off `dist_src` it
 *  would hand 115 rows to 1991 Hipparcos over a converged DR3 fit.
 *
 *  **Two skip rules, one principle** — a courier may not re-serve a value
 *  attributed to a publication a tier above it already refused:
 *   - `gaiaIs2p` → no Gaia release. DR3 published a position for this source and
 *     withdrew the parallax DR2 had; a CNS5 or SIMBAD value citing a release is
 *     that withdrawn fit returning.
 *   - HIP2 refused on the S/N floor → no van Leeuwen. For a HIP-bearing record
 *     SIMBAD's parallax usually IS van Leeuwen's, so without this the floor
 *     refuses a value and re-admits the same number without its error bar.
 *
 *  Gliese V/70A needs neither, and its parser is what earns the exemption: only
 *  the trigonometric half of V/70A's resulting-parallax column is represented,
 *  so what reaches this tier predates both instruments and no later reduction
 *  stands behind it to withdraw. */
export function resolveParallax(
  { gaia, hip2, cns5, gliese, simbad, pairMember }: ParallaxSources,
  gaiaIs2p: boolean,
  isSol: boolean,
): ParallaxResolution {
  const hit = (
    plxMas: number, via: DistVia, sn: number | null,
  ): ParallaxResolution => ({
    plxMas,
    via,
    lowPrecision: sn !== null && sn < PARALLAX_LOW_PRECISION_SN,
    refused: false,
  });

  if (gaia !== null && usable(gaia.parallaxMas)) {
    return hit(gaia.parallaxMas, 'gaia_dr3_inversion',
      signalToNoise(gaia.parallaxMas, gaia.parallaxErrorMas));
  }

  let refused = false;
  let hip2Refused = false;
  if (hip2 !== null && usable(hip2.plxMas)) {
    const sn = signalToNoise(hip2.plxMas, hip2.plxErrorMas);
    if (sn === null || sn >= PARALLAX_SN_FLOOR) {
      return hit(hip2.plxMas, 'hip2_parallax', sn);
    }
    hip2Refused = true;
    refused = true;
  }

  if (cns5 !== null && usable(cns5.mas)) {
    if (!(gaiaIs2p && isGaiaCatalogueBibcode(cns5.bibcode))) {
      return hit(cns5.mas, 'cns5_plx', signalToNoise(cns5.mas, cns5.errMas));
    }
    refused = true;
  }

  if (gliese !== null && usable(gliese.plxMas)) {
    return hit(gliese.plxMas, 'gliese_plx',
      signalToNoise(gliese.plxMas, gliese.plxErrMas));
  }

  if (simbad !== null && usable(simbad.mas)) {
    const laundered = (gaiaIs2p && isGaiaCatalogueBibcode(simbad.bibcode))
      || (hip2Refused && isHipparcos2Bibcode(simbad.bibcode));
    if (!laundered) {
      return hit(simbad.mas, 'simbad_plx', signalToNoise(simbad.mas, simbad.errMas));
    }
    refused = true;
  }

  // A bound pair's components share a distance to a part in a million, so a
  // sibling's clean fit places this record where nothing measured on the record
  // itself survived — the claim applySystemDistanceCoherence already ships
  // catalogue-wide, reaching one tier further down. Below the second-order
  // indices because it lends a neighbour's measurement rather than serving this
  // star's own; above `none` because the alternative is no record at all.
  if (pairMember !== null) {
    return hit(pairMember.mas, 'pair_member_parallax',
      signalToNoise(pairMember.mas, pairMember.errMas));
  }

  // Sol carries no identifier any tier keys on, and its distance is zero rather
  // than a parallax — the same curated exit the direction and V cascades take.
  if (isSol) return { plxMas: null, via: 'curated', lowPrecision: false, refused: false };

  return { plxMas: null, via: 'none', lowPrecision: false, refused };
}
