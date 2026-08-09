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
  diffuseResidualMagArcsec2,
} from './diffuse-reference';

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
      10 ** (-0.4 * RESOLVED_CATALOGUE_MAG_ARCSEC2.northGalacticPole) /
      10 ** (-0.4 * LEINERT_TOTAL_STARLIGHT_MAG_ARCSEC2.northGalacticPole);
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
    const row = readFileSync(
      fileURLToPath(
        new URL(
          '../../../../data/bc03/bc2003_hr_m62_chab_ssp.4color',
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
      throw new Error('BC03 m62 table has no log-age-yr = 10.000 row');
    }
    expect(Number(row[5])).toBe(BULGE_ML_V);
  });

  // Mass in, light out. The bulge's higher Υ*_V is the whole correction:
  // 0.150 of the stellar mass buys well under half that share of the V
  // light, and the ONLY quantity that survives the algebra is the ratio of
  // the two Υ*_V — which is what makes a measured disc value and a
  // modelled bulge one commensurable.
  it('converts the mass B/T into the V-band light B/T', () => {
    expect(BULGE_TO_TOTAL_MASS).toBe(0.15);
    expect(BULGE_ML_V / DISC_ML_V).toBeCloseTo(2.1, 12);
    expect(BULGE_TO_TOTAL_LIGHT_V).toBeCloseTo(0.07752, 5);
    expect(BULGE_TO_TOTAL_LIGHT_V).toBeLessThan(BULGE_TO_TOTAL_MASS);
  });
});
