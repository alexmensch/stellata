import { describe, expect, it } from 'vitest';

import { parsePairDispositionsTsv } from './pair-review-dispositions-pure';
import { PAIR_REVIEW_DISPOSITIONS } from './pair-review-dispositions-source';

const FROM = { file: 'pair-review-dispositions.tsv', hint: 'h' };
const HEADER = 'hip\tentries\tkeep_entry\tbasis\tevidence\n';
const parse = (...rows: string[]) => parsePairDispositionsTsv(HEADER + rows.map((r) => `${r}\n`).join(''), FROM);

describe('parsePairDispositionsTsv', () => {
  it('reads a disposition keyed on its HIP', () => {
    expect(parse('10\t1-1-1|1-1-2\t1-1-2\ttycho2_position\tsep 0.2"').get(10)).toEqual({
      hip: 10, entries: ['1-1-1', '1-1-2'], keepEntry: '1-1-2', basis: 'tycho2_position', evidence: 'sep 0.2"',
    });
  });

  it('refuses a keep_entry off the pair it restates', () => {
    expect(() => parse('10\t1-1-1|1-1-2\t1-1-9\ttycho2_position\tsep')).toThrow(/1-1-9 is not on the pair 1-1-1\|1-1-2/);
  });

  it('refuses a duplicate HIP, an unknown basis or a disposition with no evidence', () => {
    const ok = '10\t1-1-1|1-1-2\t1-1-2\ttycho2_position\tsep';
    expect(() => parse(ok, ok)).toThrow(/duplicate HIP 10/);
    expect(() => parse('10\t1-1-1|1-1-2\t1-1-2\thunch\tsep')).toThrow();
    expect(() => parse('10\t1-1-1|1-1-2\t1-1-2\ttycho2_position\t')).toThrow();
  });

  it('reads the committed file', () => {
    expect(PAIR_REVIEW_DISPOSITIONS.read()).toBeInstanceOf(Map);
  });
});
