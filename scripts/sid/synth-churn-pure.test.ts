import { describe, expect, it } from 'vitest';

import { synthChurnReport } from './synth-churn-pure';

describe('synthChurnReport', () => {
  it('lists every live synth key under the orphan\'s WDS root with its row\'s geometry', () => {
    const report = synthChurnReport(
      ['04357+1010-Aa,Ab', '11111+2222-C'],
      ['04357+1010-Aa1', '04357+1010-Aa2', '99999+0000-B'],
      [{ systemId: '04357+1010-Aa1,2', comp: 'Aa2', sepArcsec: 0.12, paDeg: 45 }],
    ).split('\n');
    expect(report.slice(0, 5)).toEqual([
      '  synth:04357+1010-Aa,Ab — no live synth key matches (WDS root 04357+1010)',
      '    candidate synth:04357+1010-Aa1',
      '    candidate synth:04357+1010-Aa2 (comp Aa2, sep 0.12", PA 45°)',
      '  synth:11111+2222-C — no live synth key matches (WDS root 11111+2222)',
      '    (no live synth keys under this WDS root)',
    ]);
  });
});
