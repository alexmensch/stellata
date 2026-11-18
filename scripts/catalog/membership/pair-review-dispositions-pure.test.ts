import { describe, expect, it } from 'vitest';

import { parsePairDispositionsTsv, requireWitnessedKeeps } from './pair-review-dispositions-pure';
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

describe('requireWitnessedKeeps', () => {
  const REF = { file: 'f', line: 1 } as never;
  const seps = [{ tyc: '1-1-2', separationArcsec: 0.02 }, { tyc: '1-1-1', separationArcsec: 0.98 }];
  const check = (
    keep: string, basis: string,
    { hip = {}, vt = {}, verdict = null }: { hip?: Record<number, number>; vt?: Record<string, number>; verdict?: WitnessVerdict | null },
  ) => () => requireWitnessedKeeps(parse(`10\t1-1-1|1-1-2\t${keep}\t${basis}\tevidence`), {
    printedHipV: (h) => (h in hip ? { vMag: hip[h], ref: REF } : null),
    vtOf: (t) => vt[t] ?? null,
    positionWitness: () => verdict,
  });
  const photometry = (keep: string, hip: Record<number, number>, vt: Record<string, number>) =>
    check(keep, 'tycho2_photometry', { hip, vt });
  const position = (keep: string, verdict: WitnessVerdict | null) => check(keep, 'hip2_position', { verdict });

  it('passes a tycho2_photometry keep_entry whose VT is nearest the printed V', () => {
    expect(photometry('1-1-1', { 10: 9.4 }, { '1-1-1': 10.7, '1-1-2': 12.1 })).not.toThrow();
  });

  it('fails a tycho2_photometry keep_entry another entry is nearer to, or an exact tie', () => {
    expect(photometry('1-1-2', { 10: 9.4 }, { '1-1-1': 10.7, '1-1-2': 12.1 })).toThrow(/1-1-2 is not the one entry whose VT is nearest/);
    expect(photometry('1-1-1', { 10: 10 }, { '1-1-1': 9, '1-1-2': 11 })).toThrow(/not the one entry/);
  });

  it('fails tycho2_photometry where either magnitude is missing', () => {
    expect(photometry('1-1-1', {}, { '1-1-1': 10.7, '1-1-2': 12.1 })).toThrow(/prints no V/);
    expect(photometry('1-1-1', { 10: 9.4 }, { '1-1-1': 10.7 })).toThrow(/1-1-2 prints no VT/);
  });

  it('fails a tycho2_photometry keep_entry where HIP2 falls on the other entry alone', () => {
    const vt = { '1-1-1': 10.7, '1-1-2': 12.1 };
    const onOther: WitnessVerdict = { kind: 'match', tyc: '1-1-2', separations: seps };
    expect(check('1-1-1', 'tycho2_photometry', { hip: { 10: 9.4 }, vt, verdict: onOther }))
      .toThrow(/HIP2's position falls on 1-1-2 alone \(1-1-2 0.02", 1-1-1 0.98"\), which outranks photometry/);
  });

  it('lets photometry decide where HIP2 matches the kept entry, both, neither, or cannot carry', () => {
    const vt = { '1-1-1': 10.7, '1-1-2': 12.1 };
    const flipped = [{ tyc: '1-1-1', separationArcsec: 0.02 }, { tyc: '1-1-2', separationArcsec: 0.98 }];
    for (const verdict of [
      { kind: 'match', tyc: '1-1-1', separations: flipped },
      { kind: 'several', tycs: ['1-1-1', '1-1-2'], separations: flipped },
      { kind: 'none', separations: flipped },
      null,
    ] as (WitnessVerdict | null)[]) {
      expect(check('1-1-1', 'tycho2_photometry', { hip: { 10: 9.4 }, vt, verdict })).not.toThrow();
    }
  });

  it('passes a hip2_position keep_entry HIP2 falls on alone', () => {
    expect(position('1-1-2', { kind: 'match', tyc: '1-1-2', separations: seps })).not.toThrow();
  });

  it('fails a hip2_position keep_entry HIP2 matches another entry, both, or neither', () => {
    expect(position('1-1-1', { kind: 'match', tyc: '1-1-2', separations: seps })).toThrow(/does not fall on 1-1-1 alone \(1-1-2 0.02", 1-1-1 0.98"\)/);
    expect(position('1-1-2', { kind: 'several', tycs: ['1-1-2', '1-1-1'], separations: seps })).toThrow(/does not fall on 1-1-2 alone/);
    expect(position('1-1-2', { kind: 'none', separations: seps })).toThrow(/does not fall on 1-1-2 alone/);
  });

  it('fails a hip2_position HIP HIP2 cannot carry', () => {
    expect(position('1-1-2', null)).toThrow(/gives it no position/);
  });

  it('recomputes nothing for pair_component', () => {
    expect(check('1-1-1', 'pair_component', { verdict: { kind: 'match', tyc: '1-1-2', separations: seps } })).not.toThrow();
  });
});
