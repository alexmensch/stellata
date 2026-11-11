// Stage 5's build-log lines, read off the Stage5Result it returned.

import { count, countsListed, droppedPairSample } from '../build-log-pure';
import { opticalRejected, opticalTally, stage5Counts, stage5Rates, type Stage5Result } from './attach-optical';

export function stage5Report(result: Stage5Result): string[] {
  const counts = stage5Counts(result);
  const rate = stage5Rates(counts).optical_rejected_rate;
  const sepLimit = [...result.optical].flatMap(([p, via]) => (via === 'sep_limit_rejected' ? [`${p.pair.wdsId}${p.pair.components}`] : []));
  return [
    `optical-pair cascade: ${countsListed(opticalTally(result))}`,
    `optical rejected rate: ${(rate * 100).toFixed(1)}% (${count(opticalRejected(counts))} / ${count(result.optical.size)})`,
    ...droppedPairSample('separation-limit rejections: optical doubles dropped', sepLimit),
  ];
}
