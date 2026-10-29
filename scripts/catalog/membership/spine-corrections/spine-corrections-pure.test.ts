import { describe, expect, it } from 'vitest';

import { parseSpineCorrectionsTsv, SPINE_CORRECTION_COLUMNS } from './spine-corrections-pure';

const FROM = { file: 'fixture.tsv', hint: 'h' };
const tsv = (cells: readonly string[]): string => `${SPINE_CORRECTION_COLUMNS.join('\t')}\n${cells.join('\t')}\n`;

describe('parseSpineCorrectionsTsv', () => {
  // A label the CDS join got wrong belongs in classic_id_overrides.tsv, where
  // the merge can see it; this file may not reach around the merge.
  it('parses only tyc as a set cell', () => {
    expect(() => parseSpineCorrectionsTsv(tsv(['1-2-1', '', '5', '', 'set', 'hd', '6', 'because']), FROM))
      .toThrow(/set may write tyc/);
  });

  it('refuses a correction that states no evidence', () => {
    expect(() => parseSpineCorrectionsTsv(tsv(['1-2-1', '', '5', '', 'set', 'tyc', '1-9-1', '']), FROM))
      .toThrow(/states no evidence/);
  });

  // Sol is the one spine row whose four key cells are all empty, so a blank key
  // RESOLVES — to the Sun — rather than failing to match. Do not read this
  // guard as redundant with 'matches no spine row'.
  it('refuses a correction naming no key cell, which would resolve to Sol', () => {
    expect(() => parseSpineCorrectionsTsv(tsv(['', '', '', '', 'set', 'tyc', '1-9-1', 'because']), FROM))
      .toThrow(/every key cell is empty/);
  });
});
