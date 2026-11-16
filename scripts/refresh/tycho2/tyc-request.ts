// The TYCs the manifest and IV/25 mention and the manifest's HIPs, read off both: the one request refresh:tycho2 and refresh:simbad-tyc-hd ask. See README.md#the-request-set.

import { TYC2_HD } from '../../catalog/classic-ids/tyc2-hd-source';
import { MEMBERSHIP_MANIFEST } from '../../catalog/membership/membership-manifest-tsv';
import { artifactRows } from '../../util/sources/source';
import { parseTyc, tycho2Request, type Tyc, type Tycho2Inputs } from './tycho2-pure';

export function readTycRequest(): Tycho2Inputs {
  const manifest = [...artifactRows(MEMBERSHIP_MANIFEST)];
  const iv25Tycs = TYC2_HD.read().map((row): Tyc => {
    const tyc = parseTyc(row.tyc);
    if (tyc === null) throw new Error(`${TYC2_HD.file}: ${row.tyc} is not a TYC`);
    return tyc;
  });
  return { request: tycho2Request(manifest, iv25Tycs), requestFrom: [MEMBERSHIP_MANIFEST.file, TYC2_HD.file] };
}
