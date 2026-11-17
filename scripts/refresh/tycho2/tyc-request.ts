// The TYCs the manifest and IV/25 mention: refresh:tycho2's request with the manifest's HIPs added, and refresh:simbad-tyc-hd's with the pair rule's entries added. See README.md#the-request-set.

import { TYC2_HD } from '../../catalog/classic-ids/tyc2-hd-source';
import { MEMBERSHIP_MANIFEST } from '../../catalog/membership/membership-manifest-tsv';
import { pairRuleTycHdRequest } from '../../catalog/membership/merge-derivation/merge-derivation-pure';
import { TYCHO2 } from '../../catalog/tycho2-source';
import { DATA_FILES } from '../../../src/catalog-format/pipeline-outputs/data-files';
import { artifactRows } from '../../util/sources/source';
import { parseTyc, tycho2Request, type Tyc, type Tycho2Inputs, type Tycho2PullInputs } from './tycho2-pure';

function tycsOf(file: string, cells: readonly string[]): Tyc[] {
  return cells.map((cell): Tyc => {
    const tyc = parseTyc(cell);
    if (tyc === null) throw new Error(`${file}: ${cell} is not a TYC`);
    return tyc;
  });
}

function tycInputs(
  manifest: readonly { tyc: string | null }[], asked: readonly string[], askedFrom: readonly string[],
): Tycho2Inputs {
  return {
    request: tycho2Request(manifest.map((record) => record.tyc), tycsOf(TYC2_HD.file, asked)),
    requestFrom: [MEMBERSHIP_MANIFEST.file, TYC2_HD.file, ...askedFrom],
  };
}

const iv25Tycs = (): string[] => TYC2_HD.read().map((row) => row.tyc);

/** README.md#the-request-set */
export const readTycRequest = (): Tycho2Inputs => tycInputs(
  [...artifactRows(MEMBERSHIP_MANIFEST)],
  pairRuleTycHdRequest(iv25Tycs(), TYCHO2.read()),
  [DATA_FILES.tycho2Main, DATA_FILES.tycho2Suppl1],
);

export function readTycho2Inputs(): Tycho2PullInputs {
  const manifest = [...artifactRows(MEMBERSHIP_MANIFEST)];
  const hips = new Set<number>();
  for (const record of manifest) if (record.hip !== null) hips.add(record.hip);
  return { ...tycInputs(manifest, iv25Tycs(), []), hips };
}
