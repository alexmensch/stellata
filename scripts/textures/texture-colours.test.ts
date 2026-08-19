import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SOL_BODIES } from '../../src/client/solar-system/planet-system';

// A body's disc colour and its calibrated map are two renderings of one
// quantity: iColour tints the glare billboard at distance and uColour shades
// the mesh until the map lands, and the map's own mean is what takes over.
// Where a measured index exists, both should be on it. data/textures/README.md
// § Colour fidelity says which bodies are and which are not.

const LUMA = [0.2126, 0.7152, 0.0722] as const;
const CALIBRATED_MOONS = [
  'Io', 'Europa', 'Ganymede', 'Callisto', 'Dione', 'Rhea', 'Titan', 'Triton',
] as const;

interface CalibRow { target?: [number, number, number] }
const calibration: Record<string, CalibRow> = JSON.parse(
  readFileSync(resolve(__dirname, '../../data/textures/calibration.json'), 'utf-8'),
);

const bodyNamed = (name: string) => {
  const b = SOL_BODIES.find((p) => p.name === name);
  expect(b, `${name} missing from SOL_BODIES`).toBeDefined();
  return b!;
};
/** V-normalised, the form `calibration.json` stores its target in. */
const chroma = (rgb: readonly number[]) => rgb.map((c) => c / rgb[1]);
const luminance = (rgb: readonly number[]) =>
  LUMA.reduce((a, w, i) => a + w * rgb[i], 0);

describe('the eight index-calibrated moons', () => {
  it('carry a disc colour on the same chromaticity as their map', () => {
    // The map moved onto measured photometry; a disc colour left on the
    // retired hand tint makes the body change hue the moment its texture
    // lands, which reads as a texture bug rather than a stale constant.
    for (const name of CALIBRATED_MOONS) {
      const target = calibration[name.toLowerCase()]?.target;
      expect(target, `${name} calibration row`).toBeDefined();
      const got = chroma(bodyNamed(name).colour);
      for (let i = 0; i < 3; i++) {
        // 0.5 % clears rounding the table to three decimals (worst 0.14 %).
        expect(got[i], `${name} channel ${i}`).toBeCloseTo(target![i], 2);
        expect(Math.abs(got[i] - target![i]) / target![i]).toBeLessThan(0.005);
      }
    }
  });

  it('kept the luminance they had, so only hue moved', () => {
    // Planets pass iColour to the glare UNNORMALISED, unlike the star path
    // which divides its LUT colour to relative luminance 1. So the triple's
    // scale is a brightness side-channel here, and a retune that changed it
    // would silently rescale these bodies' glare.
    const before: Record<string, number> = {
      Io: 0.7732, Europa: 0.7670, Ganymede: 0.5363, Callisto: 0.4156,
      Dione: 0.7493, Rhea: 0.7793, Titan: 0.6258, Triton: 0.8077,
    };
    for (const name of CALIBRATED_MOONS) {
      expect(luminance(bodyNamed(name).colour), name)
        .toBeCloseTo(before[name], 3);
    }
  });
});

describe('the build invents no colour of its own', () => {
  it('carries no representative-colour table to drift out of sync', () => {
    // The predecessor of this file pinned build-textures.py's own
    // REPRESENTATIVE_COLOURS copies against SOL_BODIES. Both those tables and
    // the tints they fed are retired: a grayscale source now takes its colour
    // from its measured index, so there is no second copy to keep in step.
    const build = readFileSync(resolve(__dirname, 'build-textures.py'), 'utf-8');
    expect(build).not.toContain('REPRESENTATIVE_COLOURS');
    expect(build).not.toContain('TINT_STRENGTH');
    expect(build).not.toContain('def tint_grayscale');
  });
});
