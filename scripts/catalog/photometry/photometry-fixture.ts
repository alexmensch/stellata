// Test-only builders for GaiaPhotometry and the printed-V lookups both binding
// gates weigh against. See README.md.

import { GLIESE } from '../gliese-source';
import { GAIA_ASTROMETRY } from '../sources/gaia-astrometry-source';
import { TYCHO2 } from '../tycho2-source';
import { sourceRowRef } from '../../util/sources/row-ref-pure';
import { HIP_PHOTOMETRY } from './hip-photometry-source';
import type { PrintedHipValue } from './hip-photometry-parse-pure';
import type { CitedPhotometry, PrintedVLookups } from './v-magnitude-pure';

export const PHOTOMETRY_SOURCE_ID = '1000';
export const PHOTOMETRY_REF = sourceRowRef(GAIA_ASTROMETRY, PHOTOMETRY_SOURCE_ID);

/** A well-measured unsaturated source at BP−RP 0.8, so a suite states only the
 *  band its assertion turns on. */
export function photometry(overrides: Partial<CitedPhotometry> = {}): CitedPhotometry {
  return { gMag: 10, bpMag: 10.5, rpMag: 9.7, ref: PHOTOMETRY_REF, ...overrides };
}

/** The same source moved to a requested colour. Both published relations are
 *  functions of BP−RP alone, so a colour-range assertion should not have to
 *  pick band values that happen to differ by it. */
export function atColour(bpMinusRp: number): CitedPhotometry {
  return { gMag: 10, bpMag: 10 + bpMinusRp, rpMag: 10, ref: PHOTOMETRY_REF };
}

/** A HIP-keyed printed table, as the I/239 parse yields it. */
export function printedHipTable(entries: Iterable<readonly [number, number]>): Map<number, PrintedHipValue> {
  return new Map([...entries].map(([hip, value]) => [hip, { value, ref: sourceRowRef(HIP_PHOTOMETRY, hip) }]));
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
    printed_hip: (h) => {
      const vMag = hip.get(h);
      return vMag === undefined ? null : { vMag, ref: sourceRowRef(HIP_PHOTOMETRY, h) };
    },
    tycho2: (tyc) => (tycho2[tyc] === undefined
      ? null
      : { vMag: tycho2[tyc], ref: sourceRowRef(TYCHO2, tyc), outsideRange: false }),
    gliese: (gj) => (gliese[gj] === undefined ? null : { vMag: gliese[gj], ref: sourceRowRef(GLIESE, gj) }),
  };
}
