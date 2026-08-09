import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  BULGE_ML_V,
  BULGE_TO_TOTAL_LIGHT_V,
  BULGE_TO_TOTAL_MASS,
  DISC_ML_V,
  LEINERT_TOTAL_STARLIGHT_MAG_ARCSEC2,
  NGP_DIFFUSE_RESIDUAL_MAG_ARCSEC2,
  RESOLVED_CATALOGUE_MAG_ARCSEC2,
  bulgeToTotalLight,
  diffuseResidualMagArcsec2,
} from './diffuse-reference';
import { fluxNumber } from '../../hdr/emission/density0-solver-pure';

/** Υ\*_V at 10 Gyr out of one committed BC03 table, by metallicity code. */
function bc03MlVAt10Gyr(metallicityCode: 'm52' | 'm62' | 'm72'): number {
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
  return Number(row[5]);
}

// The band's target is published starlight MINUS the stars the app already
// draws. Pinning the published figure directly would enshrine that double
// count, which is exactly what the retired GC anchor did.
describe('MilkyWay diffuse reference', () => {
  it('subtracts the resolved catalogue from the published NGP total', () => {
    expect(NGP_DIFFUSE_RESIDUAL_MAG_ARCSEC2).toBeCloseTo(24.99, 2);
    expect(NGP_DIFFUSE_RESIDUAL_MAG_ARCSEC2).toBeGreaterThan(
      LEINERT_TOTAL_STARLIGHT_MAG_ARCSEC2.northGalacticPole,
    );
  });

  // The resolved star field carries two thirds of the pole's starlight.
  it('pins how much of the NGP total the star field already draws', () => {
    const share =
      fluxNumber(RESOLVED_CATALOGUE_MAG_ARCSEC2.northGalacticPole) /
      fluxNumber(LEINERT_TOTAL_STARLIGHT_MAG_ARCSEC2.northGalacticPole);
    expect(share).toBeCloseTo(0.657, 3);
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
