// refresh:tycho2 — Tycho-2's main table and supplement 1, filtered to the TYCs the manifest and IV/25 mention. See README.md.

import { TYC2_HD } from '../../catalog/classic-ids/tyc2-hd-source';
import { MEMBERSHIP_MANIFEST } from '../../catalog/membership/membership-manifest-tsv';
import type { PullDescription } from '../../util/emit-artifacts';
import { artifactRows } from '../../util/sources/source';
import { describePhasedPull, runPhasedPull } from '../pull/pull';
import { TYCHO2_OUTPUTS } from './tycho2-outputs';
import { parseTyc, tycho2Pull, tycho2Request, type Tyc } from './tycho2-pure';

function pull() {
  const manifestTycs = [...artifactRows(MEMBERSHIP_MANIFEST)].map((record) => record.tyc);
  const iv25Tycs = TYC2_HD.read().map((row): Tyc => {
    const tyc = parseTyc(row.tyc);
    if (tyc === null) throw new Error(`${TYC2_HD.file}: ${row.tyc} is not a TYC`);
    return tyc;
  });
  return tycho2Pull(TYCHO2_OUTPUTS, {
    request: tycho2Request(manifestTycs, iv25Tycs), requestFrom: [MEMBERSHIP_MANIFEST.file, TYC2_HD.file],
  });
}

export const describe = (): PullDescription => describePhasedPull(pull());
export const main = (): Promise<void> => runPhasedPull(pull());
