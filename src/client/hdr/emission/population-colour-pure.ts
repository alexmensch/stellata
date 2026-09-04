// Colour indices for the two stellar populations the volumetric layers
// render, and the constrained solve that recovers a disc's index from a
// galaxy's published integrated one. See README.md § Population colours.

import { linearSrgbFromColourIndex } from '../../../../scripts/colour/blackbody-lut-pure';

/**
 * (B−V) of an old, metal-rich simple stellar population: Bruzual &
 * Charlot 2003, Chabrier IMF, Z = 0.02, 10 Gyr —
 * `data/bc03/bc2003_hr_m62_chab_ssp.4color` column 3 minus column 4 at
 * `log-age-yr = 10.000`, read back and pinned in
 * `../../milkyway/calibration/diffuse-reference.test.ts` beside the
 * Υ\*_V off the same row.
 *
 * Both layers take it: the Galactic bulge, M31's bulge and the luminous
 * early-type spheroids (M 32, NGC 205) are the same population, so this
 * is a *population* constant rather than either layer's own. It is not
 * the metal-poor dwarf spheroids — see
 * `../../local-group/emission/README.md` § Population tints.
 */
export const OLD_SPHEROID_COLOUR_INDEX_BV = 0.9574;

/**
 * That population's hue, through the star field's own chain. Shared
 * rather than derived per layer: the band's bulge and the Local Group's
 * spheroids are one population, so one triplet — two derivations of the
 * same index would drift apart the moment either is edited.
 */
export const OLD_SPHEROID_COLOR_RGB: [number, number, number] =
  linearSrgbFromColourIndex(OLD_SPHEROID_COLOUR_INDEX_BV);

/** A colour index as a zero-point-free B/V flux ratio. Zero points cancel
 *  in every expression below because all three indices are in one system. */
function colourFlux(bv: number): number {
  return 10 ** (-0.4 * bv);
}

/**
 * Integrated colour index of a two-component galaxy, given each
 * component's index and the spheroid's share of the **V-band light**.
 *
 * ```
 * 10^(−0.4·(B−V)_tot) = f·10^(−0.4·(B−V)_sph) + (1−f)·10^(−0.4·(B−V)_disc)
 * ```
 *
 * f has to be a light ratio, not a mass one: this mixes V-band
 * luminosities, so a mass share used here carries the same error it
 * carries in the flux split (`../../milkyway/calibration/README.md`
 * § The light ratio).
 */
export function combinedColourIndex(
  spheroidBv: number,
  discBv: number,
  spheroidLightFraction: number,
): number {
  const f = spheroidLightFraction;
  return (
    -2.5 *
    Math.log10(f * colourFlux(spheroidBv) + (1 - f) * colourFlux(discBv))
  );
}

/**
 * The inverse: a galaxy's published integrated index and its spheroid's
 * modelled one solve for the disc's, preserving the integrated colour by
 * construction.
 *
 * Which is the point — the integrated colour is the observationally
 * strongest constraint either layer has, and predicting both components
 * independently would violate it silently. The whole modelling
 * uncertainty lands on the disc, whose star-formation history is the
 * messier of the two to synthesise anyway.
 *
 * Throws rather than reaching a shader with a non-finite hue: either the
 * spheroid carries all the V light, leaving no disc to colour, or it is
 * alone bluer than the total at that share. Both mean the three inputs
 * are not describing one galaxy. `f = 1` needs its own half of the guard
 * — it divides by zero to `+Infinity`, which passes a positivity test.
 */
export function discColourIndex(
  totalBv: number,
  spheroidBv: number,
  spheroidLightFraction: number,
): number {
  const f = spheroidLightFraction;
  const discFlux =
    (colourFlux(totalBv) - f * colourFlux(spheroidBv)) / (1 - f);
  if (!(f < 1) || !Number.isFinite(discFlux) || !(discFlux > 0)) {
    throw new Error(
      `No disc colour solves (B−V)_total = ${totalBv} against a spheroid at ` +
        `${spheroidBv} carrying ${f} of the V light: either no disc light is ` +
        'left to colour, or the spheroid alone is already bluer than the total.',
    );
  }
  return -2.5 * Math.log10(discFlux);
}
