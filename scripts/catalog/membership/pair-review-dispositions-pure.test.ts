import { describe, expect, it } from 'vitest';

import { parsePairDispositionsTsv, requirePhotometricKeeps } from './pair-review-dispositions-pure';
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

describe('requirePhotometricKeeps', () => {
  const REF = { file: 'f', line: 1 } as never;
  const check = (keep: string, hip: Record<number, number>, vt: Record<string, number>, basis = 'tycho2_photometry') =>
    () => requirePhotometricKeeps(
      parse(`10\t1-1-1|1-1-2\t${keep}\t${basis}\tVT`),
      (h) => (h in hip ? { vMag: hip[h], ref: REF } : null),
      (t) => vt[t] ?? null,
    );

  it('passes a keep_entry whose VT is nearest the printed V', () => {
    expect(check('1-1-1', { 10: 9.4 }, { '1-1-1': 10.7, '1-1-2': 12.1 })).not.toThrow();
  });

  it('fails a keep_entry another entry is nearer to, or an exact tie', () => {
    expect(check('1-1-2', { 10: 9.4 }, { '1-1-1': 10.7, '1-1-2': 12.1 })).toThrow(/1-1-2 is not the one entry whose VT is nearest/);
    expect(check('1-1-1', { 10: 10 }, { '1-1-1': 9, '1-1-2': 11 })).toThrow(/not the one entry/);
  });

  it('fails where either magnitude is missing', () => {
    expect(check('1-1-1', {}, { '1-1-1': 10.7, '1-1-2': 12.1 })).toThrow(/prints no V/);
    expect(check('1-1-1', { 10: 9.4 }, { '1-1-1': 10.7 })).toThrow(/1-1-2 prints no VT/);
  });

  it('weighs only tycho2_photometry dispositions', () => {
    expect(check('1-1-2', {}, {}, 'tycho2_position')).not.toThrow();
  });
});
