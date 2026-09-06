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
  'gliese_photometric_plx',
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
  gliese_photometric_plx: 'distGliesePhotometricPlx',
  curated: 'distCurated',
  none: 'distNone',
} as const satisfies Record<DistVia, string>;

/** Below this the parallax is not distinguishable from zero, so its inverse is
 *  unbounded above and carries no distance at all — a different failure from
 *  imprecision, which is why this is the gate rather than the ~20% bound that
 *  governs how BIASED an inversion is (Bailer-Jones 2015). Rows between the two
 *  ship, counted as `distLowPrecisionParallax`.
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

/** `plx / e_plx`, or null where the index publishes no usable error bar. */
export function parallaxSignalToNoise(
  plx: number, err: number | null,
): number | null {
  return err !== null && err > 0 ? plx / err : null;
}

/** Whether `PARALLAX_SN_FLOOR` refuses this parallax — the single statement of
 *  the rule, shared with the sibling index so the two cannot drift.
 *
 *  **An unstated error bar gets the benefit of the doubt.** The floor refuses a
 *  parallax measured to be indistinguishable from zero, which is a claim about
 *  a published error rather than about its absence; refusing on a missing one
 *  would discard a value on no evidence. No row of any index this cascade reads
 *  states a parallax without an error today, so the rule is a contract for the
 *  next re-pull rather than a live branch. */
export function belowParallaxSnFloor(plx: number, err: number | null): boolean {
  const sn = parallaxSignalToNoise(plx, err);
  return sn !== null && sn < PARALLAX_SN_FLOOR;
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
 *  **The S/N floor gates every tier below Gaia**, not HIP2 alone. It used to
 *  gate HIP2 and the sibling index because no other index HELD a sub-floor row
 *  a record could reach — true while the SIMBAD value cohort was spine-scoped
 *  and its tier served 93 records. Rebased onto the membership manifest that
 *  tier serves thousands, and 8 of SIMBAD's sub-floor rows became reachable:
 *  parallaxes of S/N 0.01–0.33, each one indistinguishable from zero, inverting
 *  to 54,000–714,000 pc. Those rows left `readStars` through the MAX_DIST_PC
 *  drop — the one exit that is not a § 6.1 park and is pinned at zero — instead
 *  of being refused here. Gaia stays ungated for the reason it always was:
 *  Bailer-Jones sits above it for exactly the low-S/N case, and a gate here
 *  would strip a record of a posterior that exists for it.
 *
 *  Gliese V/70A is subject to neither skip rule, for two different reasons, which is why
 *  it is TWO tiers on either side of SIMBAD. Its trigonometric parallaxes
 *  predate both instruments, so no later reduction stands behind them to
 *  withdraw. Its photometric and spectroscopic ones are not measurements at
 *  all, so there is nothing to withdraw either — but for the same reason they
 *  rank below a bibcoded parallax of the star itself, and below is where the
 *  cascade puts them. `GlieseParallax.trigonometric` is the split. */
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

  /** V/70A's two tiers differ only in which kind of parallax they take, so one
   *  form serves both and the cascade order below states the ranking. */
  const glieseHit = (
    trigonometric: boolean, via: DistVia,
  ): ParallaxResolution | null => {
    const p = gliese?.parallax ?? null;
    if (p === null || p.trigonometric !== trigonometric || !usable(p.mas)
        || belowParallaxSnFloor(p.mas, p.errMas)) {
      return null;
    }
    return hit(p.mas, via, parallaxSignalToNoise(p.mas, p.errMas));
  };

  if (gaia !== null && usable(gaia.parallaxMas)) {
    return hit(gaia.parallaxMas, 'gaia_dr3_inversion',
      parallaxSignalToNoise(gaia.parallaxMas, gaia.parallaxErrorMas));
  }

  let refused = false;
  let hip2Refused = false;
  if (hip2 !== null && usable(hip2.plxMas)) {
    if (!belowParallaxSnFloor(hip2.plxMas, hip2.plxErrorMas)) {
      return hit(hip2.plxMas, 'hip2_parallax',
        parallaxSignalToNoise(hip2.plxMas, hip2.plxErrorMas));
    }
    hip2Refused = true;
    refused = true;
  }

  if (cns5 !== null && usable(cns5.mas)) {
    if (!(gaiaIs2p && isGaiaCatalogueBibcode(cns5.bibcode))
        && !belowParallaxSnFloor(cns5.mas, cns5.errMas)) {
      return hit(cns5.mas, 'cns5_plx',
        parallaxSignalToNoise(cns5.mas, cns5.errMas));
    }
    refused = true;
  }

  const trigonometric = glieseHit(true, 'gliese_plx');
  if (trigonometric !== null) return trigonometric;

  if (simbad !== null && usable(simbad.mas)) {
    const laundered = (gaiaIs2p && isGaiaCatalogueBibcode(simbad.bibcode))
      || (hip2Refused && isHipparcos2Bibcode(simbad.bibcode));
    if (!laundered && !belowParallaxSnFloor(simbad.mas, simbad.errMas)) {
      return hit(simbad.mas, 'simbad_plx',
        parallaxSignalToNoise(simbad.mas, simbad.errMas));
    }
    refused = true;
  }

  // A bound pair's components share a distance to a part in a million, so a
  // sibling's clean fit places this record where nothing measured on the record
  // itself survived — the claim applySystemDistanceCoherence already ships
  // catalogue-wide, reaching one tier further down. Below the second-order
  // indices because it lends a neighbour's measurement rather than serving this
  // star's own.
  if (pairMember !== null) {
    return hit(pairMember.mas, 'pair_member_parallax',
      parallaxSignalToNoise(pairMember.mas, pairMember.errMas));
  }

  // V/70A's photometric and spectroscopic parallaxes: a distance from colour and
  // spectral type, which is circular for a build that then derives the record's
  // own absolute magnitude from it. The bottom tier because it is the only one
  // that is not a parallax measurement of anything — even a bound sibling's fit
  // outranks it, being a measurement of a star at this distance. Above `none`
  // only because the alternative is no record: xi UMa (Gl 423 A/B, V 4.33/4.80)
  // is what sits here, its Gaia rows position-only, HIP 55203 absent from HIP2,
  // and its CNS5 and SIMBAD parallaxes both withdrawn DR2 fits.
  const photometric = glieseHit(false, 'gliese_photometric_plx');
  if (photometric !== null) return photometric;

  // Sol carries no identifier any tier keys on, and its distance is zero rather
  // than a parallax — the same curated exit the direction and V cascades take.
  if (isSol) return { plxMas: null, via: 'curated', lowPrecision: false, refused: false };

  return { plxMas: null, via: 'none', lowPrecision: false, refused };
}
