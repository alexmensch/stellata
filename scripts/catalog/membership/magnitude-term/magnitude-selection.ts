// The floor's selection over the magnitude pull, streamed. See README.md#files-in-this-area.

import { MAGNITUDE_PULL } from './magnitude-pull-source';
import { MAGNITUDE_FLOOR_V, magnitudeTermAccumulator, type MagnitudeTermSelection } from './magnitude-term-pure';
import {
  hipparcosAstrometry, hipsNear, type HipparcosAstrometry, type HipsNear,
} from '../positional-witness/positional-witness-pure';
import type { Hip2AstrometryRow } from '../../sources/hip2-source';

export async function readMagnitudeTerm(floorV: number, near: HipsNear): Promise<MagnitudeTermSelection> {
  const acc = magnitudeTermAccumulator(floorV, near, MAGNITUDE_PULL);
  await MAGNITUDE_PULL.read(acc.line);
  return acc.result();
}

/** Every HIP2 row with a proper motion to carry it by, indexed for the position witness. */
export function hip2Near(hip2: ReadonlyMap<number, Hip2AstrometryRow>): HipsNear {
  const carried = new Map<number, HipparcosAstrometry>();
  for (const [hip, row] of hip2) {
    const astrometry = hipparcosAstrometry(row);
    if (astrometry !== null) carried.set(hip, astrometry);
  }
  return hipsNear(carried);
}

/** The shipped floor's selection, with each HIP's nearby kept sources; null while the floor is off. */
export async function readFloorSelection(
  hip2: ReadonlyMap<number, Hip2AstrometryRow>,
): Promise<MagnitudeTermSelection | null> {
  return MAGNITUDE_FLOOR_V === null ? null : readMagnitudeTerm(MAGNITUDE_FLOOR_V, hip2Near(hip2));
}
