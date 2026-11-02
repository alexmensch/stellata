import { describe, expect, it } from 'vitest';
import { lumaNormalisedTint } from './emission-pure';
import { relativeLuminance } from '../tonemap/tonemap-pure';

// The gain the tint multiplies is a scalar applied per channel, so a tint
// whose own relative luminance isn't 1 rescales its emitter's solved flux.
describe('lumaNormalisedTint', () => {
  const CASES: ReadonlyArray<readonly [number, number, number]> = [
    [0.6706, 0.6588, 0.8745],
    [1, 0.9647, 0.9294],
    [1, 0.5, 0],
    [0.1, 0.1, 0.1],
  ];

  it('leaves every tint at unit relative luminance', () => {
    for (const rgb of CASES) {
      expect(relativeLuminance(lumaNormalisedTint(rgb))).toBeCloseTo(1, 12);
    }
  });

  it('preserves chromaticity — only the scale moves', () => {
    for (const rgb of CASES) {
      const t = lumaNormalisedTint(rgb);
      expect(t[0] / t[1]).toBeCloseTo(rgb[0] / rgb[1], 12);
      expect(t[2] / t[1]).toBeCloseTo(rgb[2] / rgb[1], 12);
    }
  });

  it('is idempotent — normalising a tint again is a no-op', () => {
    const once = lumaNormalisedTint(CASES[0]);
    const twice = lumaNormalisedTint(once);
    for (let i = 0; i < 3; i++) expect(twice[i]).toBeCloseTo(once[i], 12);
  });

  it('degrades a black tint to white rather than extinguishing the emitter', () => {
    expect(lumaNormalisedTint([0, 0, 0])).toEqual([1, 1, 1]);
  });
});
