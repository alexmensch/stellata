import { describe, expect, it } from 'vitest';

import { alternateNames, buildWgsnIndex, pickBayerRow, pickNameRow } from './wgsn-index-pure';
import { WGSN_NAMES } from './wgsn-names-tsv';
import type { DesignationRow } from './wgsn-tables-pure';

const bayer = (over: Partial<DesignationRow>): DesignationRow => ({
  kind: 'bayer', letter: null, sup: null, num: null, dc: '', half: null,
  component: null, hip: null, hr: null, hd: null, source: 'nec', ...over,
});

const NAMES_HEADER = `${WGSN_NAMES.columns.join('\t')}\n`;

describe('the record-side join', () => {
  // NEC lists both p Eri rows against HIP 7751 and separates them only by
  // HR and HD, so a HIP-first join collapses A and B onto one record.
  const designations = [
    bayer({ letter: 'p', dc: 'Eri', component: 'A', hip: 7751, hr: 486, hd: 10360 }),
    bayer({ letter: 'p', dc: 'Eri', component: 'B', hip: 7751, hr: 487, hd: 10361 }),
  ];
  const index = buildWgsnIndex([], designations);

  it('resolves HR before HD before HIP', () => {
    expect(index.bayerOf({ hip: 7751, hd: 10360, hr: 486 })?.component)
      .toBe('A');
    expect(index.bayerOf({ hip: 7751, hd: 10361, hr: 487 })?.component)
      .toBe('B');
    expect(index.bayerOf({ hip: 7751, hd: 10361, hr: null })?.component)
      .toBe('B');
  });
});

describe('pickers', () => {
  it('prefers the bare row: a lettered one names a component, not the star', () => {
    // γ Cen's keys carry γ Cen, γ Cen A and γ Cen B.
    const rows = [
      bayer({ letter: 'γ', dc: 'Cen', component: 'A' }),
      bayer({ letter: 'γ', dc: 'Cen', component: null }),
      bayer({ letter: 'γ', dc: 'Cen', component: 'B' }),
    ];
    expect(pickBayerRow(rows).component).toBeNull();
  });

  it('prefers a Greek glyph over the Latin overflow series', () => {
    // NEC hangs `y Cen B` on γ Cen's keys, and reading that as the star's
    // designation renamed γ Cen to `y Cen`.
    const rows = [
      bayer({ letter: 'y', dc: 'Cen', component: 'B' }),
      bayer({ letter: 'γ', dc: 'Cen' }),
    ];
    expect(pickBayerRow(rows).letter).toBe('γ');
  });

  it('prefers the superscripted row: the bare one names the pair', () => {
    // β Sco and β¹ Sco both key HIP 78820; the star is β¹ Sco.
    const rows = [bayer({ letter: 'β', dc: 'Sco' }), bayer({ letter: 'β', sup: 1, dc: 'Sco' })];
    expect(pickBayerRow(rows).sup).toBe(1);
  });

  it('prefers the bare NAME: a lettered one names a component of the star', () => {
    const rows = WGSN_NAMES.parse(
      NAMES_HEADER
      + 'Albireo A\t\t95947\t\t7417\t183912\t\t3.2\tnec\t7411\n'
      + 'Albireo\t\t95947\t\t7417\t183912\t\t3.08\tnec\t7410\n',
    );
    expect(pickNameRow(rows).name).toBe('Albireo');
  });
});

describe('alternateNames', () => {
  it('keeps every other name the authority approves on the star, never a component\'s', () => {
    // NEC lists σ CMa twice: Unurgunite, and Nganurganity with Unurgunite as its alternate.
    const sigma = WGSN_NAMES.parse(
      NAMES_HEADER
      + 'Unurgunite\t\t33856\t\t2646\t52877\t\t3.49\tnec\t2617\n'
      + 'Nganurganity\tUnurgunite\t33856\t\t2646\t52877\t\t3.47\tnec\t2628\n',
    );
    expect(alternateNames(sigma, pickNameRow(sigma))).toEqual(['Nganurganity']);
    const albireo = WGSN_NAMES.parse(
      NAMES_HEADER
      + 'Albireo A\t\t95947\t\t7417\t183912\t\t3.2\tnec\t7411\n'
      + 'Albireo\t\t95947\t\t7417\t183912\t\t3.08\tnec\t7410\n',
    );
    expect(alternateNames(albireo, pickNameRow(albireo))).toEqual([]);
  });

  it('keeps a published alternate even where it reads like a component letter', () => {
    const bake = WGSN_NAMES.parse(`${NAMES_HEADER}Bake-eo\tBake Eo\t1\t\t\t\t\t\tnec\t1\n`);
    expect(alternateNames(bake, bake[0])).toEqual(['Bake Eo']);
  });
});
