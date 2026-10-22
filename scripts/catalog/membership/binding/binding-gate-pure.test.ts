import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  GAIA_BINDING_G_MINUS_V_REJECT_MAG,
  bindingEvidence,
  isSiblingLetterAttribution,
  parseSimbadWdsXidsTsv,
  rejectionOf,
  weighBinding,
} from './binding-gate-pure';
import { NO_PRINTED_V } from '../../photometry/photometry-fixture';

describe('weighBinding', () => {
  // Toliman's wrong binding: a G 20.95 background source on α Cen B's V 1.33.
  const TOLIMAN_BAD_SRC = '5877748442128924544';
  const evidence = bindingEvidence(
    new Map([[TOLIMAN_BAD_SRC, 20.95], ['777', 1.6]]), null, NO_PRINTED_V, new Set(['nullg']),
  );
  const printedAt = (vMag: number) => ({ vVia: 'printed_hip' as const, vMag, key: 1 });

  it('rejects a candidate fainter in G than the printed V beyond the gate', () => {
    const v = weighBinding(TOLIMAN_BAD_SRC, { hip: null, printedV: printedAt(1.33) }, evidence);
    expect(v).toEqual({ magnitude: 'rejected', siblingRefused: false });
    expect(rejectionOf(v)).toBe('mag');
  });

  it('binds a candidate consistent with the printed V', () => {
    const v = weighBinding('777', { hip: null, printedV: printedAt(1.58) }, evidence);
    expect(v).toEqual({ magnitude: 'consistent', siblingRefused: false });
    expect(rejectionOf(v)).toBeNull();
  });

  it('binds a candidate exactly at the threshold — the gate rejects only past it', () => {
    const atThreshold = bindingEvidence(
      new Map([['edge', 1.5 + GAIA_BINDING_G_MINUS_V_REJECT_MAG]]), null, NO_PRINTED_V,
    );
    expect(weighBinding('edge', { hip: null, printedV: printedAt(1.5) }, atThreshold).magnitude)
      .toBe('consistent');
  });

  it('names why it could not weigh a candidate, and binds it', () => {
    for (const [sourceId, printedV, why] of [
      [TOLIMAN_BAD_SRC, null, 'no_printed_v'],
      ['unpulled', printedAt(5), 'no_pulled_row'],
      ['nullg', printedAt(5), 'null_g'],
    ] as const) {
      const v = weighBinding(sourceId, { hip: null, printedV }, evidence);
      expect(v).toEqual({ magnitude: why, siblingRefused: false });
      expect(rejectionOf(v)).toBeNull();
    }
  });

  // μ Dra: HIP 83608 is filed under B's letter, and the source belongs to A
  // alone. The sibling arm keys on the HIP, so it needs neither a G nor a V.
  describe('the sibling-letter arm', () => {
    const xids = parseSimbadWdsXidsTsv([
      'wds_id\tcomponent\tgaia_source_id\thip',
      '17053+5428\tA\t1420101696285626624\t',
      '17053+5428\tB\t\t83608',
    ].join('\n'));
    const sibling = bindingEvidence(new Map(), xids, NO_PRINTED_V);

    it('refuses a source another letter owns, and still reports the magnitude arm', () => {
      for (const [printedV, magnitude] of [[printedAt(5), 'no_pulled_row'], [null, 'no_printed_v']] as const) {
        const v = weighBinding('1420101696285626624', { hip: 83608, printedV }, sibling);
        expect(v).toEqual({ magnitude, siblingRefused: true });
        expect(rejectionOf(v)).toBe('sibling');
      }
    });

    it('is inert on a row with no HIP', () => {
      expect(weighBinding('1420101696285626624', { hip: null, printedV: null }, sibling).siblingRefused)
        .toBe(false);
    });
  });
});

describe('GAIA_BINDING_G_MINUS_V_REJECT_MAG', () => {
  it('matches the binaries pipeline threshold (scripts/binaries/indices.py)', () => {
    const py = readFileSync(resolve(__dirname, '../../../binaries/indices.py'), 'utf8');
    const m = py.match(/^GAIA_BINDING_G_MINUS_V_REJECT_MAG\s*=\s*([\d.]+)/m);
    expect(m).not.toBeNull();
    expect(parseFloat(m![1])).toBe(GAIA_BINDING_G_MINUS_V_REJECT_MAG);
  });
});

describe('isSiblingLetterAttribution', () => {
  // Live SIMBAD shapes as of the 2026-07 re-pull: μ Dra carries
  // blend-suffixed HIPs (83608A + 83608B); HD 70492's bare HIP 41098
  // lives on a system-level SIMBAD object absent from the per-component
  // xids, so neither component row carries it.
  const XIDS_TSV = [
    'wds_id\tcomponent\tsimbad_oid\tsimbad_main_id\tgaia_source_id\thip',
    '17053+5428\tA\t373388\t* mu. Dra A\t1420101696287738368\t83608',
    '17053+5428\tB\t373389\t* mu. Dra B\t1420101696285626624\t83608',
    '17053+5428\tC\t373439\t* mu. Dra C\t1420101696286312448\t',
    '08231+2001\tA\t18621022\tHD  70492A\t663434291021197568\t',
    '08231+2001\tB\t18621023\tHD  70492B\t663434291018997248\t',
    '99990+9990\tA\t2\town-hip A\t556\t',
    '99990+9990\tB\t1\town-hip B\t555\t104217',
    '06451-1643\tA\t3\tsaturated A\t\t32349',
    '06451-1643\tB\t4\tsaturated B\t777\t',
    '11111+1111\tA\t5\tblend A\t888\t',
    '11111+1111\tB\t6\tblend B\t888\t',
    '22222+2222\tA\t7\tlineage A\t\t100',
    '22222+2222\tAa\t8\tlineage Aa\t999\t',
  ].join('\n');
  const xids = parseSimbadWdsXidsTsv(XIDS_TSV);

  it('parses source / HIP attributions and the primary source letter', () => {
    expect(xids.bySource.get('1420101696285626624')).toEqual([
      { wdsId: '17053+5428', component: 'B' },
    ]);
    expect(xids.byHip.get(83608)).toEqual([
      { wdsId: '17053+5428', component: 'A' },
      { wdsId: '17053+5428', component: 'B' },
    ]);
    expect(xids.primarySourceLetterByWds.get('17053+5428')).toBe('A');
    expect(xids.primarySourceLetterByWds.get('06451-1643')).toBe('B');
  });

  it('rejects required-column drift', () => {
    expect(() => parseSimbadWdsXidsTsv('wds_id\tcomponent\n')).toThrow(
      /missing required columns/,
    );
  });

  it('scrubs a blend-suffixed-HIP row keyed on the sibling source (μ Dra)', () => {
    expect(
      isSiblingLetterAttribution('1420101696285626624', 83608, xids),
    ).toBe(true);
  });

  it('scrubs a system-level-HIP row keyed on the sibling source (HD 70492)', () => {
    expect(
      isSiblingLetterAttribution('663434291018997248', 41098, xids),
    ).toBe(true);
  });

  it('keeps the primary letter source on the same rows', () => {
    expect(
      isSiblingLetterAttribution('1420101696287738368', 83608, xids),
    ).toBe(false);
    expect(
      isSiblingLetterAttribution('663434291021197568', 41098, xids),
    ).toBe(false);
  });

  // μ Dra's spine row carries B's HD 154905, GJ 9584B and TYC 3890-1396-1 on
  // the pair's shared HIP; the TYC is on SIMBAD's B object, so the row is B.
  it('keeps the sibling source where the row names it by a component designation', () => {
    expect(isSiblingLetterAttribution('1420101696285626624', 83608, xids, true)).toBe(false);
  });

  // HD 70492's HIP sits on a system-level object, on neither letter: the row
  // is the system, so a component witness does not make it B.
  it('still scrubs a system-level HIP on neither letter, witness or not', () => {
    expect(isSiblingLetterAttribution('663434291018997248', 41098, xids, true)).toBe(true);
  });

  it('still scrubs a HIP attributed to the other letter alone, witness or not', () => {
    expect(isSiblingLetterAttribution('777', 32349, xids, true)).toBe(true);
  });

  it('keeps a secondary row whose own HIP is attributed to its letter', () => {
    expect(isSiblingLetterAttribution('555', 104217, xids)).toBe(false);
  });

  it('scrubs on directly-disjoint HIP letters even when the primary carries no source', () => {
    expect(isSiblingLetterAttribution('777', 32349, xids)).toBe(true);
  });

  it('never scrubs a photocentre blend (source attributed to two letters)', () => {
    expect(isSiblingLetterAttribution('888', 12345, xids)).toBe(false);
  });

  it('treats sub-letters as the parent lineage, not siblings', () => {
    expect(isSiblingLetterAttribution('999', 100, xids)).toBe(false);
  });

  it('is inert without a HIP or without the xids index', () => {
    expect(isSiblingLetterAttribution('1420101696285626624', null, xids)).toBe(false);
    expect(isSiblingLetterAttribution('1420101696285626624', 83608, null)).toBe(false);
  });
});
