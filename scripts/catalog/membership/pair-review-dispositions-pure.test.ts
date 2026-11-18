import { describe, expect, it } from 'vitest';

import { parsePairDispositionsTsv, requirePhotometricKeeps, requirePositionalKeeps } from './pair-review-dispositions-pure';
import type { WitnessVerdict } from './positional-witness/positional-witness-pure';
import { PAIR_REVIEW_DISPOSITIONS } from './pair-review-dispositions-source';

const FROM = { file: 'pair-review-dispositions.tsv', hint: 'h' };
const HEADER = 'hip\tentries\tkeep_entry\tbasis\tevidence\n';
const parse = (...rows: string[]) => parsePairDispositionsTsv(HEADER + rows.map((r) => `${r}\n`).join(''), FROM);

describe('parsePairDispositionsTsv', () => {
  it('reads a disposition keyed on its HIP', () => {
    expect(parse('10\t1-1-1|1-1-2\t1-1-2\tpair_component\tsep 0.2"').get(10)).toEqual({
      hip: 10, entries: ['1-1-1', '1-1-2'], keepEntry: '1-1-2', basis: 'pair_component', evidence: 'sep 0.2"',
    });
  });

  it('refuses a keep_entry off the pair it restates', () => {
    expect(() => parse('10\t1-1-1|1-1-2\t1-1-9\tpair_component\tsep')).toThrow(/1-1-9 is not on the pair 1-1-1\|1-1-2/);
  });

  it('refuses a duplicate HIP, an unknown basis or a disposition with no evidence', () => {
    const ok = '10\t1-1-1|1-1-2\t1-1-2\tpair_component\tsep';
    expect(() => parse(ok, ok)).toThrow(/duplicate HIP 10/);
    expect(() => parse('10\t1-1-1|1-1-2\t1-1-2\thunch\tsep')).toThrow();
    expect(() => parse('10\t1-1-1|1-1-2\t1-1-2\ttycho2_position\tsep')).toThrow(/basis/);
    expect(() => parse('10\t1-1-1|1-1-2\t1-1-2\tpair_component\t')).toThrow();
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
    expect(check('1-1-2', {}, {}, 'pair_component')).not.toThrow();
  });
});

describe('requirePositionalKeeps', () => {
  const seps = [{ tyc: '1-1-2', separationArcsec: 0.02 }, { tyc: '1-1-1', separationArcsec: 0.98 }];
  const check = (keep: string, verdict: WitnessVerdict | null, basis = 'hip2_position') =>
    () => requirePositionalKeeps(parse(`10\t1-1-1|1-1-2\t${keep}\t${basis}\tHIP2`), () => verdict);

  it('passes a keep_entry HIP2 falls on alone', () => {
    expect(check('1-1-2', { kind: 'match', tyc: '1-1-2', separations: seps })).not.toThrow();
  });

  it('fails a keep_entry HIP2 matches another entry, both, or neither', () => {
    expect(check('1-1-1', { kind: 'match', tyc: '1-1-2', separations: seps })).toThrow(/does not fall on 1-1-1 alone \(1-1-2 0.02", 1-1-1 0.98"\)/);
    expect(check('1-1-2', { kind: 'several', tycs: ['1-1-2', '1-1-1'], separations: seps })).toThrow(/does not fall on 1-1-2 alone/);
    expect(check('1-1-2', { kind: 'none', separations: seps })).toThrow(/does not fall on 1-1-2 alone/);
  });

  it('fails a HIP HIP2 cannot carry', () => {
    expect(check('1-1-2', null)).toThrow(/gives it no position/);
  });

  it('weighs only hip2_position dispositions', () => {
    expect(check('1-1-1', null, 'pair_component')).not.toThrow();
  });
});
