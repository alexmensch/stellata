import { describe, it, expect } from 'vitest';

import {
  cns5AstrometryByGj,
  parseBsc5Tsv,
  parseCns5Tsv,
  parseCrossIndexTsv,
  parseTyc2HdTsv,
} from './classic-ids-parse';
import { cns5Astrometry, cns5Row } from './cns5-fixture';

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
  'cns5\tgj\tgj_comp\tgaia_source_id\thip'
    + '\tra_deg\tde_deg\tpos_epoch\tplx_mas\tplx_bibcode\tpm_ra\tpm_de\tpm_bibcode',
  '3591\t551\tC\t5853498713190525696\t70890'
    + '\t217.39232147201\t-62.67607511677\t2016.0\t768.07\t2020yCat.1350....0G'
    + '\t-3781.74\t769.47\t2020yCat.1350....0G',
  '0\tSun\t\t\t\t\t\t\t\t\t\t\t\t',
  '3592\t552\t\t\t\t217.4\t-62.6\t2016.0\t100\t\t-10\t20\t',
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

  it('carries the PM bibcode, and drops an unbibcoded motion whole', () => {
    const rows = parseCns5Tsv(CNS5);
    expect(rows[0].astrometry?.pm).toEqual({
      pmRaMasyr: -3781.74, pmDecMasyr: 769.47, bibcode: '2020yCat.1350....0G',
    });
    // The position survives the drop; only the motion needed the citation.
    expect(rows[2].astrometry?.raDeg).toBe(217.4);
    expect(rows[2].astrometry?.pm).toBeNull();
  });

  it('drops an unbibcoded PARALLAX whole too — the distance cascade\'s skip '
    + 'rules read that bibcode, so a value without one cannot be weighed', () => {
    const rows = parseCns5Tsv(CNS5);
    expect(rows[0].astrometry?.parallax).toEqual({
      mas: 768.07, errMas: null, bibcode: '2020yCat.1350....0G',
    });
    // Row 3 states plx_mas=100 and no citation: the whole quantity goes.
    expect(rows[2].astrometry?.parallax).toBeNull();
  });
});

describe('classic-ids-parse / cns5AstrometryByGj', () => {
  const astrometry = cns5Astrometry({ raDeg: 10, decDeg: 20, posEpoch: 2016.0 });

  it("keys on the record's own gl form, component letter included", () => {
    const index = cns5AstrometryByGj([
      cns5Row({ gj: '1294', gjComp: 'A', astrometry }),
      cns5Row({ gj: '1294', gjComp: 'B', astrometry: { ...astrometry, raDeg: 11 } }),
    ]);
    expect(index.get('1294A')?.raDeg).toBe(10);
    expect(index.get('1294B')?.raDeg).toBe(11);
  });

  // CNS5 prints whole numbers with a trailing .0 where a record's gl cell
  // carries the bare number; not collapsing it costs the tier those rows
  // silently, since a miss is indistinguishable from an absent row.
  it("collapses CNS5's trailing .0 so a bare gl cell reaches the row", () => {
    const index = cns5AstrometryByGj([cns5Row({ gj: '18.0', astrometry })]);
    expect(index.get('18')?.raDeg).toBe(10);
  });

  it('keeps a genuinely fractional Gliese number intact', () => {
    const index = cns5AstrometryByGj([cns5Row({ gj: '17.1', astrometry })]);
    expect(index.get('17.1')?.raDeg).toBe(10);
    expect(index.get('17')).toBeUndefined();
  });

  it('skips a row stating no astrometry at all', () => {
    expect(cns5AstrometryByGj([cns5Row({ gj: '42' })]).size).toBe(0);
  });

  // gj_comp is one COMBINED string per entry, so the exact key reaches no
  // record: every record's own cell names a single component.
  it('aliases each letter of a combined gj_comp onto the row', () => {
    const index = cns5AstrometryByGj([
      cns5Row({ gj: '423', gjComp: 'ABCD', astrometry }),
    ]);
    for (const letter of 'ABCD') {
      expect(index.get(`423${letter}`)?.raDeg).toBe(10);
    }
    expect(index.get('423')?.raDeg).toBe(10);
  });

  it('keeps the first write on a repeated key rather than throwing', () => {
    const index = cns5AstrometryByGj([
      cns5Row({ cns5: 1, gj: '42', astrometry }),
      cns5Row({ cns5: 2, gj: '42.0', astrometry: { ...astrometry, raDeg: 11 } }),
    ]);
    expect(index.get('42')?.raDeg).toBe(10);
  });
});
