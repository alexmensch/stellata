// Test-only builders for GaiaPhotometry. See README.md.

import type { GaiaPhotometry } from './gaia-photometry-pure';

/** A well-measured unsaturated source at BP−RP 0.8, so a suite states only the
 *  band its assertion turns on. */
export function photometry(overrides: Partial<GaiaPhotometry> = {}): GaiaPhotometry {
  return { gMag: 10, bpMag: 10.5, rpMag: 9.7, ...overrides };
}

/** The same source moved to a requested colour. Both published relations are
 *  functions of BP−RP alone, so a colour-range assertion should not have to
 *  pick band values that happen to differ by it. */
export function atColour(bpMinusRp: number): GaiaPhotometry {
  return { gMag: 10, bpMag: 10 + bpMinusRp, rpMag: 10 };
}
