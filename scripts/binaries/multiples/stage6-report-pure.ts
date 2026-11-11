// Stage 6's build-log lines, read off the Stage6Result it returned.

import { count, countsListed, droppedPairSample } from '../build-log-pure';
import { SPECT_VIA } from '../multiples-tsv';
import { fold } from '../../util/counts/tally-pure';
import { stage6Counts, type Stage6Result } from './attach-multiples';

export function stage6Report(result: Stage6Result): string[] {
  const counts = stage6Counts(result);
  const standalone = counts.multiples_standalone_emitted;
  const pairs = (counts.multiples_rows_emitted - standalone) / 2;
  return [
    `filled pair mags from MSC pair-side V magnitudes on ${count(counts.msc_pair_mags_filled)} pairs`,
    ...droppedPairSample(
      'position-less pair drops: kept pairs with no astrometry and no system anchor never reach multiples.tsv',
      result.droppedNoPosition,
    ),
    `multiples.tsv: ${count(counts.multiples_rows_emitted)} component rows (${count(pairs)} physical pairs + ${count(standalone)} standalone rows)`,
    `spect provenance: ${countsListed(fold(SPECT_VIA, result.rows, (r) => r.spectVia))}`,
  ];
}
