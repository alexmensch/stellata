import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  BULGE_COLOUR_INDEX_BV,
  BULGE_ML_V,
  BULGE_TO_TOTAL_LIGHT_V,
  BULGE_TO_TOTAL_MASS,
  DISC_COLOUR_INDEX_BV,
  DISC_ML_V,
  GALAXY_TOTAL_COLOUR_INDEX_BV,
  LEINERT_TOTAL_STARLIGHT_MAG_ARCSEC2,
  NGP_DIFFUSE_RESIDUAL_MAG_ARCSEC2,
  RESOLVED_CATALOGUE_MAG_ARCSEC2,
  bulgeToTotalLight,
  diffuseResidualMagArcsec2,
} from './diffuse-reference';
import { fluxNumber } from '../../hdr/emission/density0-solver-pure';
import {
  combinedColourIndex,
  discColourIndex,
} from '../../hdr/emission/population-colour-pure';

/** The log-age-yr = 10.000 row of one committed BC03 table, whitespace-split. */
function bc03RowAt10Gyr(metallicityCode: 'm52' | 'm62' | 'm72'): string[] {
  const row = readFileSync(
    fileURLToPath(
      new URL(
        `../../../../data/bc03/bc2003_hr_${metallicityCode}_chab_ssp.4color`,
        import.meta.url,
      ),
    ),
    'utf-8',
  )
    .split('\n')
    .filter((l) => !l.startsWith('#') && l.trim() !== '')
    .map((l) => l.trim().split(/\s+/))
    .find((c) => Number(c[0]) === 10);
  if (row === undefined) {
    throw new Error(
      `BC03 ${metallicityCode} table has no log-age-yr = 10.000 row`,
    );
  }
  return row;
}

/** Υ\*_V — column 6 of that row. */
function bc03MlVAt10Gyr(metallicityCode: 'm52' | 'm62' | 'm72'): number {
  return Number(bc03RowAt10Gyr(metallicityCode)[5]);
}

/** (B−V) — columns 3 and 4 of that row, both per 1 M⊙ formed, so the
 *  difference needs no normalisation (`data/bc03/README.md` § Schema). */
function bc03ColourIndexAt10Gyr(
  metallicityCode: 'm52' | 'm62' | 'm72',
): number {
  const row = bc03RowAt10Gyr(metallicityCode);
  return Number(row[2]) - Number(row[3]);
}

// The band's target is published starlight MINUS the stars the app already
// draws. Pinning the published figure directly would enshrine that double
// count, which is exactly what the retired GC anchor did.
describe('MilkyWay diffuse reference', () => {
  it('subtracts the resolved catalogue from the published NGP total', () => {
    expect(NGP_DIFFUSE_RESIDUAL_MAG_ARCSEC2).toBeCloseTo(25.01, 2);
    expect(NGP_DIFFUSE_RESIDUAL_MAG_ARCSEC2).toBeGreaterThan(
      LEINERT_TOTAL_STARLIGHT_MAG_ARCSEC2.northGalacticPole,
    );
  });

  // The resolved star field carries two thirds of the pole's starlight.
  it('pins how much of the NGP total the star field already draws', () => {
    const share =
      fluxNumber(RESOLVED_CATALOGUE_MAG_ARCSEC2.northGalacticPole) /
      fluxNumber(LEINERT_TOTAL_STARLIGHT_MAG_ARCSEC2.northGalacticPole);
    expect(share).toBeCloseTo(0.664, 3);
  });

  // De-extincted catalogue vs observed sky model through a ~30 mag column:
  // the pair is not commensurable and must not yield a number.
  it('refuses a residual toward the Galactic centre', () => {
    expect(
      diffuseResidualMagArcsec2(
        LEINERT_TOTAL_STARLIGHT_MAG_ARCSEC2.galacticCentre,
        RESOLVED_CATALOGUE_MAG_ARCSEC2.galacticCentre,
      ),
    ).toBeNull();
  });
});

// No publication gives the Milky Way a V-band bulge-to-total LIGHT ratio,
// so the solve's flux split is derived from a published MASS ratio and the
// two populations' Υ*_V. README.md § The light ratio is the argument.
describe('MilkyWay bulge-to-total light ratio', () => {
  // Υ*_V of the bulge is read off a committed model table, so the citation
  // is machine-checked rather than asserted in a docstring: hand-editing
  // the constant, or swapping the file for a different IMF / track set,
  // fails here instead of silently re-scaling the flux split.
  it('reads the bulge Υ*_V back out of the committed BC03 table', () => {
    expect(bc03MlVAt10Gyr('m62')).toBe(BULGE_ML_V);
  });

  // Mass in, light out. The bulge's higher Υ*_V is the whole correction:
  // 0.150 of the stellar mass buys well under half that share of the V
  // light.
  it('converts the mass B/T into the V-band light B/T', () => {
    expect(BULGE_TO_TOTAL_MASS).toBe(0.15);
    expect(BULGE_TO_TOTAL_LIGHT_V).toBeCloseTo(0.07752, 5);
    expect(BULGE_TO_TOTAL_LIGHT_V).toBeLessThan(BULGE_TO_TOTAL_MASS);
  });

  // Metallicity, not age, is what the answer turns on, and the two other
  // committed tables exist to make that reproducible rather than asserted.
  // Both brackets stay under the mass ratio, so the sign of the correction
  // survives the whole plausible MDF — only its size is in play.
  it('brackets the ratio over the metallicity range the tables span', () => {
    const bracket = (code: 'm52' | 'm72') =>
      bulgeToTotalLight(BULGE_TO_TOTAL_MASS, bc03MlVAt10Gyr(code), DISC_ML_V);

    expect(bracket('m52')).toBeCloseTo(0.09796, 5);
    expect(bracket('m72')).toBeCloseTo(0.05563, 5);
    expect(bracket('m52')).toBeGreaterThan(BULGE_TO_TOTAL_LIGHT_V);
    expect(bracket('m72')).toBeLessThan(BULGE_TO_TOTAL_LIGHT_V);
    expect(bracket('m52')).toBeLessThan(BULGE_TO_TOTAL_MASS);
  });
});

// Nobody publishes the Galaxy's colour split by component either, so the
// disc index is solved against the published total rather than synthesised
// beside the bulge. README.md § Population colours is the argument.
describe('MilkyWay population colour indices', () => {
  // Same row, same machine-checked citation as Υ*_V above.
  it('reads the bulge colour index back out of the committed BC03 table', () => {
    expect(bc03ColourIndexAt10Gyr('m62')).toBeCloseTo(BULGE_COLOUR_INDEX_BV, 12);
  });

  it('solves the disc index against BHG16 Table 2', () => {
    expect(GALAXY_TOTAL_COLOUR_INDEX_BV).toBe(0.73);
    expect(DISC_COLOUR_INDEX_BV).toBeCloseTo(0.71289, 5);
    expect(DISC_COLOUR_INDEX_BV).toBeLessThan(BULGE_COLOUR_INDEX_BV);
  });

  // The constraint the solve exists to preserve: recombining the two at
  // the shipped light B/T returns the published integrated colour exactly.
  // An independently synthesised pair would violate this silently — the
  // same BC03 grid over a τ ≈ 8 Gyr declining SFH gives the disc 0.54,
  // which recombines to 0.567, 0.163 mag bluer than published.
  it('recombines to the published integrated colour', () => {
    expect(
      combinedColourIndex(
        BULGE_COLOUR_INDEX_BV,
        DISC_COLOUR_INDEX_BV,
        BULGE_TO_TOTAL_LIGHT_V,
      ),
    ).toBeCloseTo(GALAXY_TOTAL_COLOUR_INDEX_BV, 12);
    expect(
      combinedColourIndex(BULGE_COLOUR_INDEX_BV, 0.54, BULGE_TO_TOTAL_LIGHT_V),
    ).toBeCloseTo(0.5672, 4);
  });

  // What the answer actually turns on. The disc carries 92 % of the V
  // light, so moving the bulge across the whole committed metallicity
  // bracket — with f moving with it, as it must — barely reaches 0.004 mag
  // on the disc. The published total is the only load-bearing input.
  it('is insensitive to the bulge SSP across the metallicity bracket', () => {
    const solve = (code: 'm52' | 'm72') =>
      discColourIndex(
        GALAXY_TOTAL_COLOUR_INDEX_BV,
        bc03ColourIndexAt10Gyr(code),
        bulgeToTotalLight(
          BULGE_TO_TOTAL_MASS,
          bc03MlVAt10Gyr(code),
          DISC_ML_V,
        ),
      );
    expect(solve('m52')).toBeCloseTo(0.71625, 5);
    expect(solve('m72')).toBeCloseTo(0.71297, 5);
    for (const bracket of [solve('m52'), solve('m72')]) {
      expect(Math.abs(bracket - DISC_COLOUR_INDEX_BV)).toBeLessThan(0.004);
    }
  });

  // A mass share standing in for a light share biases the disc BLUE —
  // which is the direction the eyeballed pale-lavender palette leaned, so
  // using it would have ratified the thing this replaces.
  it('would have run the disc bluer on the mass B/T', () => {
    const onMass = discColourIndex(
      GALAXY_TOTAL_COLOUR_INDEX_BV,
      BULGE_COLOUR_INDEX_BV,
      BULGE_TO_TOTAL_MASS,
    );
    expect(onMass).toBeCloseTo(0.69438, 5);
    expect(onMass).toBeLessThan(DISC_COLOUR_INDEX_BV);
  });

  // Three inputs that do not describe one galaxy must fail loudly rather
  // than reach a shader as NaN.
  it('refuses a spheroid bluer than the total it is inside', () => {
    expect(() => discColourIndex(0.73, 0.5, 0.9)).toThrow(/No disc colour/);
  });
});
