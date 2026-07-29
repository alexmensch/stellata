import { describe, it, expect } from 'vitest';

import {
  parseBsc5Tsv,
  parseCns5Tsv,
  parseCrossIndexTsv,
  parseTyc2HdTsv,
} from './classic-ids-parse';

const TYC2_HD = [
  'tyc1\ttyc2\ttyc3\thd\tn_hd\tn_tyc',
  '3105\t2070\t1\t172167\t1\t1',
  '1\t381\t1\t224700\t1\t1',
  '4\t5\t1\t999\t2\t3',
].join('\n');

const CROSS_INDEX = [
  'hd\thr\thip\tbayer\tflamsteed\tcst',
  '172167\t7001\t91262\talf\t3\tLyr',
  '28\t3\t443\t\t33\tPsc',
].join('\n');

const BSC5 = ['hr\thd\tname', '7001\t172167\t3Alp Lyr', '1\t3\t'].join('\n');

const CNS5 = [
  'cns5\tgj\tgj_comp\tgaia_source_id\thip',
  '3591\t551\tC\t5853498713190525696\t70890',
  '0\tSun\t\t\t',
].join('\n');

describe('classic-ids-parse / parseTyc2HdTsv', () => {
  it('composes the unpadded tyc key the Gaia cross-walk uses', () => {
    const rows = parseTyc2HdTsv(TYC2_HD);
    expect(rows.map((r) => r.tyc)).toEqual(['3105-2070-1', '1-381-1', '4-5-1']);
    expect(rows[0].hd).toBe(172167);
  });

  it('carries the upstream ambiguity flags', () => {
    const rows = parseTyc2HdTsv(TYC2_HD);
    expect(rows[2].nHd).toBe(2);
    expect(rows[2].nTyc).toBe(3);
    expect(rows[0].nHd).toBe(1);
  });

  it('throws when a required column is absent', () => {
    expect(() => parseTyc2HdTsv('tyc1\ttyc2\thd\n1\t2\t3')).toThrow(/tyc3/);
  });

  it('throws on an empty or headerless file rather than reporting zero rows', () => {
    // Every input here is a committed LFS artifact: "no rows" means truncated,
    // and answering [] would leave the join silently keyed on nothing until
    // the count snapshot flagged the drift a layer later.
    expect(() => parseTyc2HdTsv('')).toThrow(/missing required columns/);
    expect(() => parseTyc2HdTsv('\n\n')).toThrow(/missing required columns/);
  });

  it('returns no rows for a valid header with no data rows', () => {
    expect(parseTyc2HdTsv('tyc1\ttyc2\ttyc3\thd\tn_hd\tn_tyc\n')).toEqual([]);
  });
});

describe('classic-ids-parse / parseCrossIndexTsv', () => {
  it('reads Bayer in IV/27A\'s own lowercase form and nulls empty cells', () => {
    const rows = parseCrossIndexTsv(CROSS_INDEX);
    // No `hr`: HR reaches the overlay through V/50's own HR↔HD mapping, so
    // IV/27A's column is present in the committed slice but never parsed.
    expect(rows[0]).toEqual({
      hd: 172167, hip: 91262, bayer: 'alf', flamsteed: 3, cst: 'Lyr',
    });
    expect(rows[1].bayer).toBeNull();
    expect(rows[1].flamsteed).toBe(33);
  });
});

describe('classic-ids-parse / parseBsc5Tsv', () => {
  it('nulls the HD-less and name-less cells rather than defaulting them', () => {
    const rows = parseBsc5Tsv(BSC5);
    expect(rows[0]).toEqual({ hr: 7001, hd: 172167, name: '3Alp Lyr' });
    expect(rows[1].name).toBeNull();
  });
});

describe('classic-ids-parse / parseCns5Tsv', () => {
  it('keeps the EDR3 source_id as a decimal string past 2^53', () => {
    const rows = parseCns5Tsv(CNS5);
    expect(rows[0].gaiaSourceId).toBe('5853498713190525696');
    expect(rows[0].gjComp).toBe('C');
  });

  it('keeps non-numeric GJ designations (CNS5 0 is "Sun") with a null source', () => {
    const rows = parseCns5Tsv(CNS5);
    expect(rows[1].gj).toBe('Sun');
    expect(rows[1].gaiaSourceId).toBeNull();
    expect(rows[1].hip).toBeNull();
  });
});
