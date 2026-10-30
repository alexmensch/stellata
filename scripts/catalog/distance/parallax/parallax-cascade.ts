// The parallax behind every record's distance: Gaia DR3 → HIP2 → CNS5 →
// Gliese V/70A → bibcoded SIMBAD → curated, with the two skip rules. See
// README.md.

import { gaiaRefusals, refusedPublicationCited, type RefusedPublication } from '../gaia-distrust';
import type { GaiaAstrometryCatalogRow, Hip2AstrometryRow } from '../direction-cascade';
import { parallaxSignalToNoise } from '../../cited-parallax';
import type { CitedParallax, MeasuredParallax } from '../../cited-parallax';
import type { CitedCascadeResult, CitedRefusal } from '../../cascade-result';
import type { AnySourceRowRef } from '../../../util/sources/row-ref-pure';
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
 *  governs how BIASED an inversion is (Bailer-Jones 2015,
 *  /data/papers/index.md#bailerjones2015). Rows between the two ship, counted as
 *  `distLowPrecisionParallax`.
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

/** The tiers `resolveParallax` answers on: every `DistVia` but the two override
 *  layers and the residual. */
export type ParallaxTier = Exclude<DistVia, 'bailer_jones' | 'lmc_kinematic' | 'none'>;

/** A tier's parallax the floor or a skip rule refused. On a `none` result the
 *  refusals are what distinguish a row nothing measured from one whose only
 *  measurement this build will not stand behind — the residual policy
 *  (/docs/catalog-driver.md#5-per-field-cascades-and-rescue-tiers) counts the
 *  two apart — and `mas` is what companion promotion matches a pair row's
 *  stated distance against (`../../companions/README.md#refused-parallax-refusal`). */
export type ParallaxRefusal =
  CitedRefusal<ParallaxTier, 'below_sn_floor' | RefusedPublication> & { readonly mas: number };

/** `mas` always > 0. Sol's curated exit carries none: its distance is zero by
 *  construction. */
export type ParallaxResolution = CitedCascadeResult<
  Record<Exclude<ParallaxTier, 'curated'>, MeasuredParallax> & { curated: null },
  ParallaxRefusal
>;

/** The parallax is real but its fractional error exceeds
 *  `PARALLAX_LOW_PRECISION_SN`, so the inverted distance is biased. */
export function isLowPrecisionParallax(parallax: MeasuredParallax): boolean {
  const sn = parallaxSignalToNoise(parallax.mas, parallax.errMas);
  return sn !== null && sn < PARALLAX_LOW_PRECISION_SN;
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

/** **Gaia leads, and the per-field cascade table (/docs/catalog-driver.md#5-per-field-cascades-and-rescue-tiers) has the order wrong.** `hip2_saturated` fires
 *  only where Gaia states no usable parallax, so distance follows the same
 *  astrometric solution the position did. Restoring the doc's order would hand
 *  a converged DR3 fit back to 1991 Hipparcos on thousands of records.
 *
 *  **Two skip rules, one principle** — a courier may not re-serve a value
 *  attributed to a publication a tier above it already refused: a Gaia release
 *  cited on a 2p row, and van Leeuwen 2007 (/data/papers/index.md#vanleeuwen2007)
 *  re-served after the S/N floor refused HIP2. The floor gates every tier
 *  BELOW Gaia; Gaia itself stays ungated because Bailer-Jones sits above it
 *  for exactly the low-S/N case, and a gate here would strip a record of a
 *  posterior that exists for it. */
export function resolveParallax(
  { gaia, hip2, cns5, gliese, simbad, pairMember }: ParallaxSources,
  isSol: boolean,
): ParallaxResolution {
  const refusals: ParallaxRefusal[] = [];
  const refused = new Set<RefusedPublication>(gaiaRefusals(gaia));
  const hit = (
    via: Exclude<ParallaxTier, 'curated'>, value: MeasuredParallax, ref: AnySourceRowRef,
  ): ParallaxResolution => ({ via, value, evidence: [ref], refusals });

  const courier = (
    via: 'cns5_plx' | 'simbad_plx', p: CitedParallax | null,
  ): ParallaxResolution | null => {
    if (p === null || !usable(p.mas)) return null;
    const publication = refusedPublicationCited(p.bibcode, refused);
    if (publication === null && !belowParallaxSnFloor(p.mas, p.errMas)) return hit(via, p, p.ref);
    refusals.push({ tier: via, reason: publication ?? 'below_sn_floor', mas: p.mas, ref: p.ref });
    return null;
  };

  /** V/70A's two tiers differ only in which kind of parallax they take, so one
   *  form serves both and the cascade order below states the ranking. */
  const glieseHit = (
    trigonometric: boolean, via: 'gliese_plx' | 'gliese_photometric_plx',
  ): ParallaxResolution | null => {
    if (gliese === null) return null;
    const p = gliese.parallax;
    if (p === null || p.trigonometric !== trigonometric || !usable(p.mas)) {
      return null;
    }
    if (belowParallaxSnFloor(p.mas, p.errMas)) {
      refusals.push({ tier: via, reason: 'below_sn_floor', mas: p.mas, ref: gliese.ref });
      return null;
    }
    return hit(via, p, gliese.ref);
  };

  if (gaia !== null && usable(gaia.parallaxMas)) {
    return hit('gaia_dr3_inversion', { mas: gaia.parallaxMas, errMas: gaia.parallaxErrorMas }, gaia.ref);
  }

  if (hip2 !== null && usable(hip2.plxMas)) {
    if (!belowParallaxSnFloor(hip2.plxMas, hip2.plxErrorMas)) {
      return hit('hip2_parallax', { mas: hip2.plxMas, errMas: hip2.plxErrorMas }, hip2.ref);
    }
    refused.add('hipparcos2');
    refusals.push({ tier: 'hip2_parallax', reason: 'below_sn_floor', mas: hip2.plxMas, ref: hip2.ref });
  }

  const fromCns5 = courier('cns5_plx', cns5);
  if (fromCns5 !== null) return fromCns5;

  const trigonometric = glieseHit(true, 'gliese_plx');
  if (trigonometric !== null) return trigonometric;

  const fromSimbad = courier('simbad_plx', simbad);
  if (fromSimbad !== null) return fromSimbad;

  // A bound pair's components share a distance to a part in a million, so a
  // sibling's clean fit places this record where nothing measured on the record
  // itself survived — the claim applySystemDistanceCoherence already ships
  // catalogue-wide, reaching one tier further down. Below the second-order
  // indices because it lends a neighbour's measurement rather than serving this
  // star's own.
  if (pairMember !== null) return hit('pair_member_parallax', pairMember, pairMember.ref);

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
  if (isSol) return { via: 'curated', value: null, evidence: [], refusals };

  return { via: 'none', refusals };
}
