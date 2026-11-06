// SPTYPE_OVERRIDES, the spectral resolver's curated MK types by HIP, declared.

import { defineSource } from '../../util/sources/source';
import { readTable } from '../../util/tsv/table-pure';
import { curatedSpectralValue, type SpectralSources, type SpectralValue } from './spectral-resolve';

export const SPTYPE_OVERRIDES = defineSource({
  file: 'data/simbad/sptype_overrides.tsv',
  hint: 'It is committed and hand-curated (/data/simbad/README.md#provenance).',
  parse: (input): SpectralSources['sptypeOverrides'] => {
    const byHip = new Map<number, SpectralValue>();
    for (const row of readTable({ ...input, columns: ['hip', 'sp_type', 'source'], comments: true }, input.text())) {
      const hip = row.requiredId('hip');
      if (byHip.has(hip)) row.fail(`HIP ${hip} is curated twice`);
      if (row.text('source') === null) row.fail('source is empty: every curated type cites its literature');
      byHip.set(hip, curatedSpectralValue(row.text('sp_type') ?? row.fail('sp_type is empty'), (m) => row.fail(m)));
    }
    return byHip;
  },
});
