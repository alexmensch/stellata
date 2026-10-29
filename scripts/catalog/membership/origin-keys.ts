// ORIGIN_KEYS: each membership record's origin SourceRowRef, from the declarations of the rows that found it. See ../lineage/README.md#identity--the-origin-source-row.

import { sourceRowRef, sourceRowRefText } from '../../util/sources/row-ref-pure';
import { CNS5 } from '../classic-ids/cns5-source';
import { TYC2_HD } from '../classic-ids/tyc2-hd-source';
import { HIP_PHOTOMETRY } from '../photometry/hip-photometry-source';
import { INHERITED_SPINE, spineLine } from '../spine/inherited-spine-tsv';
import { MAGNITUDE_PULL } from './magnitude-term/magnitude-pull-source';
import type { OriginKeys } from './membership-manifest-pure';

export const ORIGIN_KEYS: OriginKeys = {
  spine: (index) => sourceRowRefText(sourceRowRef(INHERITED_SPINE, spineLine(index))),
  iv25: (tyc) => sourceRowRefText(sourceRowRef(TYC2_HD, tyc)),
  i239: (hip) => sourceRowRefText(sourceRowRef(HIP_PHOTOMETRY, hip)),
  cns5: (id) => sourceRowRefText(sourceRowRef(CNS5, id)),
  gaia: (sourceId) => sourceRowRefText(sourceRowRef(MAGNITUDE_PULL, sourceId)),
};
