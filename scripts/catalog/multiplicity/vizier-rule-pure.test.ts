import { describe, expect, it } from 'vitest';

import { columnTable } from '../../util/tsv/table-pure';
import { skipVizierRule } from './vizier-rule-pure';

const FORMAT = { file: 'fixture/hip_ccdm.tsv', hint: 'h', comments: true } as const;
const hips = (text: string): (number | null)[] =>
  [...skipVizierRule(columnTable(FORMAT, text))(['HIP', 'CCDM'] as const)].map((r) => r.int('HIP'));

describe('skipVizierRule', () => {
  it('skips the dash rule under the header and the blank units line above it', () => {
    expect(hips('#\n#   VizieR header\nHIP\tCCDM\tMultFlag\n \t \t\n------\t----------\t-\n     3\t00000+3852\t\n    18\t          \tO\n'))
      .toEqual([3, 18]);
  });

  it('skips a rule with no per-column tabs', () => {
    expect(hips('HIP\tCCDM\n------\n     3\t00000+3852\n')).toEqual([3]);
  });

  it('passes a reformatted rule on, where the HIP cell throws naming the line', () => {
    expect(() => hips('HIP\tCCDM\tMultFlag\n======\t==========\t=\n     3\t00000+3852\t\n'))
      .toThrow(/fixture\/hip_ccdm\.tsv:2: HIP: "======" is not an integer/);
  });
});
