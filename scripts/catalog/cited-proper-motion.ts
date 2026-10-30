// A proper motion carried only alongside the publication that sourced it —
// the shape both second-order pulls write and the PM rescue's skip rule
// reads.

import type { AnySourceRowRef } from '../util/sources/row-ref-pure';

/** μ_α* is cos δ-applied — never divide by cos δ. `bibcode` is the source; the
 *  catalogue that carried the value is only the index that found it. */
export interface CitedProperMotion {
  pmRaMasyr: number;
  pmDecMasyr: number;
  bibcode: string;
  ref: AnySourceRowRef;
}

/** The only constructor, so no consumer can reach a motion it may not weigh:
 *  a partial or uncited one is dropped whole rather than admitted under a null
 *  citation, which every bibcode predicate reads as "not Gaia". */
export function citedProperMotion(
  pmRaMasyr: number | null,
  pmDecMasyr: number | null,
  bibcode: string | null,
  ref: AnySourceRowRef,
): CitedProperMotion | null {
  return pmRaMasyr !== null && pmDecMasyr !== null && bibcode !== null
    ? { pmRaMasyr, pmDecMasyr, bibcode, ref }
    : null;
}
