// Streaming reads over the Gaia magnitude pull. See README.md.

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';

import { REPO_ROOT as ROOT } from '../../../util/paths';
import {
  parseGaiaAstrometryCatalogTsv,
  type GaiaAstrometryCatalogRow,
} from '../../distance/direction-cascade';
import {
  MAGNITUDE_PULL_FILE,
  magnitudeTermAccumulator,
  type MagnitudeTermSelection,
} from './magnitude-term-pure';

export const MAGNITUDE_PULL_TSV = resolve(ROOT, MAGNITUDE_PULL_FILE);

async function forEachPullLine(consume: (line: string) => void): Promise<void> {
  const lines = createInterface({
    input: createReadStream(MAGNITUDE_PULL_TSV),
    crlfDelay: Infinity,
  });
  for await (const line of lines) consume(line);
}

export async function readMagnitudeTerm(floorV: number): Promise<MagnitudeTermSelection> {
  const acc = magnitudeTermAccumulator(floorV);
  await forEachPullLine(acc.line);
  return acc.result();
}

/** The pull's 5p astrometry for `keep` — README.md § The astrometry comes
 *  with it. */
export async function readMagnitudeTermAstrometry(
  keep: ReadonlySet<string>,
): Promise<Map<string, GaiaAstrometryCatalogRow>> {
  if (keep.size === 0) return new Map();
  let header = '';
  const wanted: string[] = [];
  await forEachPullLine((line) => {
    if (!header) {
      header = line;
      return;
    }
    const tab = line.indexOf('\t');
    if (tab < 0) return;
    if (keep.has(line.slice(0, tab).trim())) wanted.push(line);
  });
  return parseGaiaAstrometryCatalogTsv([header, ...wanted].join('\n'));
}
