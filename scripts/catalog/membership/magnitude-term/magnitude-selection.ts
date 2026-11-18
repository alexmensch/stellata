// The floor's selection over the magnitude pull, streamed. See README.md#files-in-this-area.

import { MAGNITUDE_PULL } from './magnitude-pull-source';
import { magnitudeTermAccumulator, type MagnitudeTermSelection } from './magnitude-term-pure';
import type { HipsNear } from '../positional-witness/positional-witness-pure';

export async function readMagnitudeTerm(floorV: number, near: HipsNear): Promise<MagnitudeTermSelection> {
  const acc = magnitudeTermAccumulator(floorV, near, MAGNITUDE_PULL);
  await MAGNITUDE_PULL.read(acc.line);
  return acc.result();
}
