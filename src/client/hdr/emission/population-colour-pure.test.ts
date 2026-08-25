import { describe, expect, it } from 'vitest';
import {
  OLD_SPHEROID_COLOR_RGB,
  OLD_SPHEROID_COLOUR_INDEX_BV,
  combinedColourIndex,
  discColourIndex,
} from './population-colour-pure';
import { linearSrgbFromColourIndex } from '../../../../scripts/colour/blackbody-lut-pure';
import { relativeLuminance } from '../tonemap/tonemap-pure';

// The population constant both volumetric layers render. Its provenance —
// that 0.9574 is the (B−V) on the same data/bc03/ row the band's Υ*_V comes
// off — is machine-checked against the committed table in
// ../../milkyway/calibration/diffuse-reference.test.ts; what belongs here is
// the hue it derives to and the fact that one triplet serves both layers.
describe('old-spheroid population constant', () => {
  it('derives its hue through the star field chain', () => {
    expect(OLD_SPHEROID_COLOR_RGB).toEqual(
      linearSrgbFromColourIndex(OLD_SPHEROID_COLOUR_INDEX_BV),
    );
    expect(OLD_SPHEROID_COLOR_RGB[0]).toBe(1);
    expect(OLD_SPHEROID_COLOR_RGB[2]).toBeLessThan(OLD_SPHEROID_COLOR_RGB[1]);
  });

  // Peak-normalised, so the triplet does not carry unit luminance and would
  // dim its own component by this much if a layer multiplied it in
  // unnormalised. Both layers pin their disc seeds against it.
  it('pins what it would cost unnormalised', () => {
    expect(-2.5 * Math.log10(relativeLuminance(OLD_SPHEROID_COLOR_RGB)))
      .toBeCloseTo(0.2277, 4);
  });
});

describe('combinedColourIndex / discColourIndex', () => {
  // The pair is an inverse, and that is the whole contract: solving a disc
  // out of a published total and recombining it has to return the total for
  // any galaxy either layer could describe, not just the two shipped ones.
  it('round-trips across the range either layer can reach', () => {
    for (const totalBv of [0.5, 0.73, 0.86, 1.1]) {
      for (const spheroidBv of [0.8655, 0.9574, 1.0692]) {
        for (const f of [0.05, 0.0775, 0.31, 0.6]) {
          const disc = discColourIndex(totalBv, spheroidBv, f);
          expect(combinedColourIndex(spheroidBv, disc, f)).toBeCloseTo(totalBv, 12);
        }
      }
    }
  });

  // A galaxy with no spheroid light is its disc, exactly — the degenerate
  // end the solve has to stay continuous through.
  it('returns the total itself when the spheroid carries no light', () => {
    expect(discColourIndex(0.73, 0.9574, 0)).toBeCloseTo(0.73, 12);
    expect(combinedColourIndex(0.9574, 0.73, 0)).toBeCloseTo(0.73, 12);
  });

  // A redder spheroid at a fixed total has to push the disc bluer: the two
  // components split one published colour between them.
  it('runs the disc bluer as the spheroid reddens', () => {
    const disc = (spheroidBv: number) => discColourIndex(0.73, spheroidBv, 0.31);
    expect(disc(1.0692)).toBeLessThan(disc(0.9574));
    expect(disc(0.9574)).toBeLessThan(disc(0.8655));
  });

  // Both halves of the guard. f = 1 is the one that needs its own test:
  // it divides by zero to +Infinity, which passes a bare positivity check
  // and would otherwise hand a shader -Infinity.
  it('refuses a spheroid carrying all the V light', () => {
    expect(() => discColourIndex(0.73, 0.9574, 1)).toThrow(/No disc colour/);
    expect(() => discColourIndex(0.73, 0.9574, 1.2)).toThrow(/No disc colour/);
  });

  it('refuses a spheroid bluer than the total it is inside', () => {
    expect(() => discColourIndex(0.73, 0.5, 0.9)).toThrow(/No disc colour/);
  });
});
