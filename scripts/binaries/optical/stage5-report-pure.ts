// Stage 5's build-log lines, read off the Stage5Result it returned.

import { formatShare } from '../../util/counts/tally-pure';
import { count, countsListed, droppedPairSample } from '../build-log-pure';
import { opticalRejected, opticalTally, stage5Rates, type Stage5Result } from './attach-optical';

export function stage5Report(result: Stage5Result): string[] {
  const tally = opticalTally(result);
  const rate = stage5Rates(tally).optical_rejected_rate;
  const sepLimit = [...result.optical].flatMap(([p, via]) => (via === 'sep_limit_rejected' ? [p] : []));
  return [
    `optical-pair cascade: ${countsListed(tally)}`,
    `optical rejected rate: ${formatShare(rate)} (${count(opticalRejected(tally))} / ${count(result.optical.size)})`,
    ...droppedPairSample('separation-limit rejections: optical doubles dropped', sepLimit),
  ];
}
