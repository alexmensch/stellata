// The TYCs the manifest and IV/25 mention, read off both: the request refresh:simbad-tyc-hd asks, and refresh:tycho2's with the manifest's HIPs added. See README.md#the-request-set.

import { TYC2_HD } from '../../catalog/classic-ids/tyc2-hd-source';
import { MEMBERSHIP_MANIFEST } from '../../catalog/membership/membership-manifest-tsv';
import { artifactRows } from '../../util/sources/source';
import { parseTyc, tycho2Request, type Tyc, type Tycho2Inputs, type Tycho2PullInputs } from './tycho2-pure';

function tycInputs(manifest: readonly { tyc: string | null }[]): Tycho2Inputs {
  const iv25Tycs = TYC2_HD.read().map((row): Tyc => {
    const tyc = parseTyc(row.tyc);
    if (tyc === null) throw new Error(`${TYC2_HD.file}: ${row.tyc} is not a TYC`);
    return tyc;
  });
  return {
    request: tycho2Request(manifest.map((record) => record.tyc), iv25Tycs),
    requestFrom: [MEMBERSHIP_MANIFEST.file, TYC2_HD.file],
  };
}

export const readTycRequest = (): Tycho2Inputs => tycInputs([...artifactRows(MEMBERSHIP_MANIFEST)]);

export function readTycho2Inputs(): Tycho2PullInputs {
  const manifest = [...artifactRows(MEMBERSHIP_MANIFEST)];
  const hips = new Set<number>();
  for (const record of manifest) if (record.hip !== null) hips.add(record.hip);
  return { ...tycInputs(manifest), hips };
}
