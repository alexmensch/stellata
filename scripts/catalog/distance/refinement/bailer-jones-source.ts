// Bailer-Jones 2021 (/data/papers/index.md#bailerjones2021) DR3 distance posteriors, declared.

import type { RowKeyed } from '../../../util/sources/row-ref-pure';
import { defineSource, type Declared } from '../../../util/sources/source';
import { readTable } from '../../../util/tsv/table-pure';
import type { BailerJonesIndex } from './distance-overrides-pure';

const BAILER_JONES_COLUMNS = ['source_id', 'r_med_geo', 'r_med_photogeo'] as const;

/** Parse the TSV produced by `scripts/refresh/refresh-bailer-jones.py` into a
 *  Gaia DR3 source_id → distance (pc) map. `source_id` is kept as a
 *  string: Gaia source_ids exceed `Number.MAX_SAFE_INTEGER`, so any
 *  numeric parse would silently corrupt the join key.
 *
 *  Per Bailer-Jones 2021 (/data/papers/index.md#bailerjones2021),
 *  `r_med_photogeo` is preferred when available
 *  (combines the parallax likelihood with a colour-and-magnitude
 *  population prior); `r_med_geo` is the geometric-only fallback for
 *  rows without photogeo (no usable G or BP–RP, or a colour outside the
 *  prior model's range). */
export function parseBailerJonesTsv(text: string, from: Declared & RowKeyed<string>): BailerJonesIndex {
  const out = new Map<string, number>();
  for (const row of readTable({ ...from, columns: BAILER_JONES_COLUMNS }, text)) {
    const sourceId = row.sourceId('source_id');
    if (sourceId === null) continue;
    const d = row.float('r_med_photogeo') ?? row.float('r_med_geo');
    if (d === null || d <= 0) continue;
    out.set(sourceId, d);
  }
  return { source: from, distPc: out };
}

export const BAILER_JONES = defineSource({
  file: 'data/bailer-jones/bailer-jones-dr3.tsv',
  hint: 'Re-run `pnpm run refresh:bailer-jones`.',
  rowKey: { id: 'i352', text: (sourceId: string) => sourceId },
  parse: (input): BailerJonesIndex => parseBailerJonesTsv(input.text(), BAILER_JONES),
});
