// The key catalog.bin records are sorted on: apparent V from Sol at
// J2016.0, brightest first. See ./README.md#record-order.

import { apparentMagnitude } from '../../../src/client/solar-system/perceptual-magnitude';

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
