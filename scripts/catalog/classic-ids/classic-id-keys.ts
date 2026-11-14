// CLASSIC_ID_KEYS: each designation row's key, from the declaration of the catalogue row it reads. See README.md#classic-id-lineage.

import { sourceRowRef, sourceRowRefText } from '../../util/sources/row-ref-pure';
import { GAIA_HIP_XMATCH } from '../parse/gaia-hip-xmatch-source';
import { BSC5 } from './bsc5-source';
import type { ClassicIdKeys } from './classic-id-lineage-pure';
import { CNS5 } from './cns5-source';
import { CROSS_INDEX } from './cross-index-source';
import { TYC2_HD } from './tyc2-hd-source';

export const CLASSIC_ID_KEYS: ClassicIdKeys = {
  iv25: (tyc) => sourceRowRefText(sourceRowRef(TYC2_HD, tyc)),
  hipXmatch: (hip) => sourceRowRefText(sourceRowRef(GAIA_HIP_XMATCH, hip)),
  iv27a: (hd) => sourceRowRefText(sourceRowRef(CROSS_INDEX, hd)),
  v50: (hr) => sourceRowRefText(sourceRowRef(BSC5, hr)),
  cns5: (id) => sourceRowRefText(sourceRowRef(CNS5, id)),
};
