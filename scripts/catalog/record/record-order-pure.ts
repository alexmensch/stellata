// The key catalog.bin records are sorted on — apparent V from Sol at J2016.0,
// brightest first — and Sol's place first once they are. See ../../../src/catalog-format/record/README.md#record-order.

import { apparentMagnitude } from '../../../src/astro-core/perceptual-magnitude';
import { FLAG_IS_SOL, SOL_RECORD_INDEX } from '../../../src/catalog-format/record/catalog-pure';
import { enterPhase, type Records, type Sorted } from './record-phase';

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

/** The promoted records in apparent-V order, with each one's key; throws on a
 *  non-finite key before sorting and unless Sol sorts first. */
export function sortByApparentV<S extends ApparentOrderStar & { readonly flags: number }>(
  records: Records<'promoted', S>,
  avSolToStar: (record: S) => number,
): { sorted: Sorted<S>; sortedKey: number[] } {
  const key = new Float64Array(records.length);
  records.forEach((record, i) => {
    const v = apparentVFromSol(record, avSolToStar(record));
    if (!Number.isFinite(v)) throw new Error(`Record ${i} has a non-finite apparent V sort key: ${v}`);
    key[i] = v;
  });
  const order = Array.from(records.keys()).sort((a, b) => key[a] - key[b]);
  const sorted = order.map((i) => records[i]);
  assertSolFirst(sorted);
  return { sorted: enterPhase('sorted', sorted), sortedKey: order.map((i) => key[i]) };
}

/** Throws unless exactly one record is flagged Sol and it sorted to SOL_RECORD_INDEX. */
export function assertSolFirst(records: readonly { readonly flags: number }[]): void {
  const found = records.flatMap((r, i) => ((r.flags & FLAG_IS_SOL) !== 0 ? [i] : []));
  if (found.length !== 1) {
    throw new Error(`Expected exactly one record flagged Sol; found ${found.length} (${found.slice(0, 10).join(', ')})`);
  }
  if (found[0] !== SOL_RECORD_INDEX) {
    throw new Error(`Sol must be record ${SOL_RECORD_INDEX}, the first the apparent-V order ships; it sorted to record ${found[0]}`);
  }
}
