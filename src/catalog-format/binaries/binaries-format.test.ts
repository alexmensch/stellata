import { describe, expect, it } from 'vitest';

import { hasRenderableOrbit } from './binaries-format';

const ELEMENTS = { pDays: 100, tJd: 2451545, e: 0.3, aAU: 5, omegaRad: 1, q: 0.4 };

describe('hasRenderableOrbit', () => {
  it('true only when P, T, e, a, ω, q are all present', () => {
    expect(hasRenderableOrbit(ELEMENTS)).toBe(true);
    for (const key of Object.keys(ELEMENTS)) {
      expect(hasRenderableOrbit({ ...ELEMENTS, [key]: null })).toBe(false);
    }
  });

  it('i is optional (Tier-2 galactic-plane fallback)', () => {
    expect(hasRenderableOrbit({ ...ELEMENTS, iRad: null })).toBe(true);
  });
});
