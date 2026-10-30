// Gaia DR3 NSS two-body source_ids, declared.

import { defineSource } from '../../util/sources/source';
import type { SourceRowRef } from '../../util/sources/row-ref-pure';
import { parseNssIndex } from './direction-cascade';

export const GAIA_NSS = defineSource({
  file: 'data/gaia/gaia_dr3_nss_two_body.tsv',
  hint: 'Re-run `pnpm run refresh:gaia-nss`.',
  rowKey: { id: 'gaia-dr3-nss', text: (sourceId: string) => sourceId },
  parse: (input): Map<string, SourceRowRef<string>> => parseNssIndex(input.text(), GAIA_NSS),
});
