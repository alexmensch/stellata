// Test-only builders for GaiaPhotometry and the printed-V lookups both binding
// gates weigh against. See README.md.

import type { GaiaPhotometry } from './gaia-photometry-pure';
import type { PrintedVLookups } from './v-magnitude-pure';

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

/** Spelled out rather than defaulted, so a suite asserting HIP-tier behaviour
 *  says that both lower tiers are silent instead of inheriting it. */
export const NO_PRINTED_V_BELOW_HIP: PrintedVLookups = {
  tycho2VOfTyc: () => null,
  glieseVOfGj: () => null,
};

/** Reduced Tycho-2 V by TYC and Gliese V by GJ cell, as the parsed tables would
 *  answer. Four suites across three folders weigh a candidate against these. */
export function printedVOf(
  tycho2: Readonly<Record<string, number>>,
  gliese: Readonly<Record<string, number>> = {},
): PrintedVLookups {
  return {
    tycho2VOfTyc: (tyc) => tycho2[tyc] ?? null,
    glieseVOfGj: (gj) => gliese[gj] ?? null,
  };
}
