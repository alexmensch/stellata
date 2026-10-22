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

/** Every printed tier silent, spelled out so a suite says so instead of
 *  inheriting it. */
export const NO_PRINTED_V: PrintedVLookups = printedVOf({});

/** Printed V by HIP, reduced Tycho-2 V by TYC and Gliese V by GJ cell, as the
 *  parsed tables would answer. */
export function printedVOf({ hip = new Map(), tycho2 = {}, gliese = {} }: {
  hip?: ReadonlyMap<number, number>;
  tycho2?: Readonly<Record<string, number>>;
  gliese?: Readonly<Record<string, number>>;
}): PrintedVLookups {
  return {
    printed_hip: (h) => hip.get(h) ?? null,
    tycho2: (tyc) => tycho2[tyc] ?? null,
    gliese: (gj) => gliese[gj] ?? null,
  };
}
