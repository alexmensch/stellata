// refresh:simbad-values — bibcoded SIMBAD values for the manifest rows a value tier can reach. See README.md.

import { MAGNITUDE_PULL } from '../../catalog/membership/magnitude-term/magnitude-pull-source';
import { MEMBERSHIP_MANIFEST } from '../../catalog/membership/membership-manifest-tsv';
import { GAIA_ASTROMETRY, gaiaAstrometryLineReader } from '../../catalog/sources/gaia-astrometry-source';
import type { PullDescription } from '../../util/emit-artifacts';
import { artifactRows } from '../../util/sources/source';
import { describePhasedPull, runPhasedPull, type PhasedPull } from '../pull/pull';
import { gaiaCompleteSourceIds, statesEveryCascadeValue } from '../simbad/membership-keys-pure';
import { SIMBAD_VALUES_OUTPUTS } from './simbad-values-outputs';
import { valuesPull } from './simbad-values-pure';

/** Gaia's 5p table covers the primaries' sources and the magnitude pull the magnitude term's, so completeness reads both.
 *  The pull streams whole: an id the manifest does not carry is never asked about, so no keep-set is needed. */
async function gaiaComplete(): Promise<Set<string>> {
  const complete = gaiaCompleteSourceIds(GAIA_ASTROMETRY.read());
  await MAGNITUDE_PULL.read(gaiaAstrometryLineReader(MAGNITUDE_PULL, (sourceId, row) => {
    if (statesEveryCascadeValue(row)) complete.add(sourceId);
  }));
  return complete;
}

async function pull(): Promise<PhasedPull<'values'>> {
  return valuesPull(SIMBAD_VALUES_OUTPUTS, {
    records: () => artifactRows(MEMBERSHIP_MANIFEST),
    gaiaComplete: await gaiaComplete(),
    requestFrom: [MEMBERSHIP_MANIFEST.file, GAIA_ASTROMETRY.file, MAGNITUDE_PULL.file],
  });
}

export const describe = async (): Promise<PullDescription> => describePhasedPull(await pull());
export const main = async (): Promise<void> => runPhasedPull(await pull());
