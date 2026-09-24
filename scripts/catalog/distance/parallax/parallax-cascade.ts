// The parallax behind every record's distance: Gaia DR3 → HIP2 → CNS5 →
// Gliese V/70A → bibcoded SIMBAD → curated, with the two skip rules. See
// README.md.

import { isGaiaCatalogueBibcode, isHipparcos2Bibcode } from '../gaia-distrust';
import type { GaiaAstrometryCatalogRow, Hip2AstrometryRow } from '../direction-cascade';
import { parallaxSignalToNoise } from '../../cited-parallax';
import type { CitedParallax, MeasuredParallax } from '../../cited-parallax';
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
  /** `mas` always > 0. Null on `curated` (Sol, distance zero by construction)
   *  and on `none`, which is a membership event rather than a value. */
  parallax: MeasuredParallax | null;
  via: DistVia;
  /** The tier's parallax is real but its fractional error exceeds
   *  `PARALLAX_LOW_PRECISION_SN`, so the inverted distance is biased. */
  lowPrecision: boolean;
  /** Every parallax a skip rule or the S/N floor refused, mas. Non-empty
   *  distinguishes a row nothing measured from one whose only measurement this
   *  build will not stand behind — /docs/catalog-driver.md#5-per-field-cascades-and-rescue-tiers's residual policy requires the two be
   *  counted apart. The values themselves are what companion promotion matches
   *  a pair row's stated distance against
   *  (`../../companions/README.md#refused-parallax-refusal`). */
  refusedPlxMas: readonly number[];
}

function usable(plx: number | null): plx is number {
  return plx !== null && plx > 0;
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

/** **Gaia leads, and /docs/catalog-driver.md#5-per-field-cascades-and-rescue-tiers's table has the order wrong.** `hip2_saturated` fires
 *  only where Gaia states no usable parallax, so distance follows the same
 *  astrometric solution the position did. Restoring the doc's order would hand
 *  a converged DR3 fit back to 1991 Hipparcos on thousands of records.
 *
 *  **Two skip rules, one principle** — a courier may not re-serve a value
 *  attributed to a publication a tier above it already refused: a Gaia release
 *  cited on a 2p row, and van Leeuwen re-served after the S/N floor refused
 *  HIP2. The floor gates every tier BELOW Gaia; Gaia itself stays ungated
 *  because Bailer-Jones sits above it for exactly the low-S/N case, and a gate
 *  here would strip a record of a posterior that exists for it. */
export function resolveParallax(
  { gaia, hip2, cns5, gliese, simbad, pairMember }: ParallaxSources,
  gaiaIs2p: boolean,
  isSol: boolean,
): ParallaxResolution {
  const hit = (parallax: MeasuredParallax, via: DistVia): ParallaxResolution => {
    const sn = parallaxSignalToNoise(parallax.mas, parallax.errMas);
    return {
      parallax,
      via,
      lowPrecision: sn !== null && sn < PARALLAX_LOW_PRECISION_SN,
      refusedPlxMas: [],
    };
  };

  const refusedPlxMas: number[] = [];
  let hip2Refused = false;

  /** V/70A's two tiers differ only in which kind of parallax they take, so one
   *  form serves both and the cascade order below states the ranking. */
  const glieseHit = (
    trigonometric: boolean, via: DistVia,
  ): ParallaxResolution | null => {
    const p = gliese?.parallax ?? null;
    if (p === null || p.trigonometric !== trigonometric || !usable(p.mas)) {
      return null;
    }
    if (belowParallaxSnFloor(p.mas, p.errMas)) {
      refusedPlxMas.push(p.mas);
      return null;
    }
    return hit(p, via);
  };

  if (gaia !== null && usable(gaia.parallaxMas)) {
    return hit(
      { mas: gaia.parallaxMas, errMas: gaia.parallaxErrorMas }, 'gaia_dr3_inversion',
    );
  }

  if (hip2 !== null && usable(hip2.plxMas)) {
    if (!belowParallaxSnFloor(hip2.plxMas, hip2.plxErrorMas)) {
      return hit({ mas: hip2.plxMas, errMas: hip2.plxErrorMas }, 'hip2_parallax');
    }
    hip2Refused = true;
    refusedPlxMas.push(hip2.plxMas);
  }

  if (cns5 !== null && usable(cns5.mas)) {
    if (!(gaiaIs2p && isGaiaCatalogueBibcode(cns5.bibcode))
        && !belowParallaxSnFloor(cns5.mas, cns5.errMas)) {
      return hit(cns5, 'cns5_plx');
    }
    refusedPlxMas.push(cns5.mas);
  }

  const trigonometric = glieseHit(true, 'gliese_plx');
  if (trigonometric !== null) return trigonometric;

  if (simbad !== null && usable(simbad.mas)) {
    const laundered = (gaiaIs2p && isGaiaCatalogueBibcode(simbad.bibcode))
      || (hip2Refused && isHipparcos2Bibcode(simbad.bibcode));
    if (!laundered && !belowParallaxSnFloor(simbad.mas, simbad.errMas)) {
      return hit(simbad, 'simbad_plx');
    }
    refusedPlxMas.push(simbad.mas);
  }

  // A bound pair's components share a distance to a part in a million, so a
  // sibling's clean fit places this record where nothing measured on the record
  // itself survived — the claim applySystemDistanceCoherence already ships
  // catalogue-wide, reaching one tier further down. Below the second-order
  // indices because it lends a neighbour's measurement rather than serving this
  // star's own.
  if (pairMember !== null) {
    return hit(pairMember, 'pair_member_parallax');
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

  // Sol's distance is zero rather than a parallax — the same curated exit the
  // direction and V cascades take.
  if (isSol) {
    return { parallax: null, via: 'curated', lowPrecision: false, refusedPlxMas: [] };
  }

  return { parallax: null, via: 'none', lowPrecision: false, refusedPlxMas };
}
