// The key catalog.bin records are sorted on — apparent V from Sol at J2016.0,
// brightest first — and Sol's index once they are. See ../../../src/catalog-format/record/README.md#record-order.

import { apparentMagnitude } from '../../../src/astro-core/perceptual-magnitude';
import { FLAG_IS_SOL } from '../../../src/catalog-format/record/catalog-pure';

export interface ApparentOrderStar {
  x: number;
  y: number;
  z: number;
  absmag: number;
}

/** Observed apparent V from Sol. `absmag` on a built record is intrinsic —
 *  the build already subtracted the Sol→star A_V — so the extinction is
 *  added back here: a reddened star that looks faint must sort as faint.
 *  Sol's own zero distance floors inside `apparentMagnitude` and lands it
 *  first with no special case. */
export function apparentVFromSol(star: ApparentOrderStar, avSolToStar: number): number {
  return apparentMagnitude(star.absmag, Math.hypot(star.x, star.y, star.z)) + avSolToStar;
}

/** The index of the one record flagged Sol. Throws on none or several: every
 *  build ships exactly one. */
export function solRecordIndex(records: readonly { readonly flags: number }[]): number {
  const found = records.flatMap((r, i) => ((r.flags & FLAG_IS_SOL) !== 0 ? [i] : []));
  if (found.length !== 1) {
    throw new Error(`Expected exactly one record flagged Sol; found ${found.length} (${found.slice(0, 10).join(', ')})`);
  }
  return found[0];
}
