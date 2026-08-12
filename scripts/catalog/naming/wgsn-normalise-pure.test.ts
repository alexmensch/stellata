import { describe, it, expect } from 'vitest';

import {
  foldNameKey,
  normaliseIv27aBayer,
  normaliseWgsnCell,
  splitNameCell,
} from './wgsn-normalise-pure';

describe('normaliseWgsnCell — NEC Bayer/other grammar', () => {
  it('parses glyph + genitive, with and without superscript', () => {
    expect(normaliseWgsnCell('τ Phoenicis')).toEqual({
      class: 'bayer',
      bayer: { letter: 'τ', sup: null, dc: 'Phe', component: null },
    });
    expect(normaliseWgsnCell('γ 3 Octantis')).toEqual({
      class: 'bayer',
      bayer: { letter: 'γ', sup: 3, dc: 'Oct', component: null },
    });
    expect(normaliseWgsnCell('κ2 Sculptoris')).toEqual({
      class: 'bayer',
      bayer: { letter: 'κ', sup: 2, dc: 'Scl', component: null },
    });
  });

  it('folds curly Greek variants to the canonical glyph', () => {
    expect(normaliseWgsnCell('ϕ Cassiopeiae')).toEqual({
      class: 'bayer',
      bayer: { letter: 'φ', sup: null, dc: 'Cas', component: null },
    });
    expect(normaliseWgsnCell('ϵ Ursae Majoris')).toEqual({
      class: 'bayer',
      bayer: { letter: 'ε', sup: null, dc: 'UMa', component: null },
    });
  });

  it('parses SIMBAD-form cells with letter, index and component', () => {
    expect(normaliseWgsnCell('* kap01 Scl B')).toEqual({
      class: 'bayer',
      bayer: { letter: 'κ', sup: 1, dc: 'Scl', component: 'B' },
    });
    expect(normaliseWgsnCell('* i02 Aqr A')).toEqual({
      class: 'bayer',
      bayer: { letter: 'i', sup: 2, dc: 'Aqr', component: 'A' },
    });
    expect(normaliseWgsnCell('* 65 Psc B')).toEqual({
      class: 'flamsteed',
      flamsteed: { num: 65, dc: 'Psc', component: 'B' },
    });
  });

  it('parses Flamsteed and Latin-letter forms', () => {
    expect(normaliseWgsnCell('29 Psc')).toEqual({
      class: 'flamsteed',
      flamsteed: { num: 29, dc: 'Psc', component: null },
    });
    expect(normaliseWgsnCell('1 Ari A')).toEqual({
      class: 'flamsteed',
      flamsteed: { num: 1, dc: 'Ari', component: 'A' },
    });
    expect(normaliseWgsnCell('l Carinae')).toEqual({
      class: 'bayer',
      bayer: { letter: 'l', sup: null, dc: 'Car', component: null },
    });
  });

  it('parses Gould designations, including the Serpens halves', () => {
    expect(normaliseWgsnCell('4 G. Cet')).toEqual({
      class: 'gould',
      gould: { num: 4, dc: 'Cet', component: null, serpensHalf: null },
    });
    expect(normaliseWgsnCell('10 G. Ser Cau')).toEqual({
      class: 'gould',
      gould: { num: 10, dc: 'Ser', component: null, serpensHalf: 'Cau' },
    });
    // Upstream footnote marker.
    expect(normaliseWgsnCell('82 G. Eri[3]')).toEqual({
      class: 'gould',
      gould: { num: 82, dc: 'Eri', component: null, serpensHalf: null },
    });
  });

  it('routes variable designations to the GCVS tier, never Bayer', () => {
    expect(normaliseWgsnCell('CG And')).toEqual({ class: 'variable', designation: 'CG And' });
    expect(normaliseWgsnCell('V398 Cep')).toEqual({ class: 'variable', designation: 'V398 Cep' });
    expect(normaliseWgsnCell('S Scl')).toEqual({ class: 'variable', designation: 'S Scl' });
  });

  it('takes the parenthetical designation off a variable-labelled cell', () => {
    expect(normaliseWgsnCell('LO Hya (25 G. Hya)')).toEqual({
      class: 'gould',
      gould: { num: 25, dc: 'Hya', component: null, serpensHalf: null },
    });
  });

  it('drops non-stellar and other-catalogue cells, and the corrupt cell', () => {
    expect(normaliseWgsnCell('NGC 129').class).toBe('non_stellar');
    expect(normaliseWgsnCell('M 31').class).toBe('non_stellar');
    expect(normaliseWgsnCell('NAME SMC').class).toBe('non_stellar');
    expect(normaliseWgsnCell('Cl Collinder 69').class).toBe('non_stellar');
    expect(normaliseWgsnCell('C 0255+602').class).toBe('non_stellar');
    expect(normaliseWgsnCell('BD+26 128').class).toBe('other_catalogue');
    expect(normaliseWgsnCell('BD +14 4559').class).toBe('other_catalogue');
    expect(normaliseWgsnCell('WASP-32').class).toBe('other_catalogue');
    expect(normaliseWgsnCell('41 H. And').class).toBe('other_catalogue');
    expect(normaliseWgsnCell('Σ 1694 A').class).toBe('other_catalogue');
    expect(normaliseWgsnCell('If[StringTake["ρ2", 3] == "HIP", "", name]').class).toBe('corrupt');
    expect(normaliseWgsnCell(null).class).toBe('empty');
  });
});

describe('normaliseIv27aBayer', () => {
  it('normalises ASCII Greek incl. dotted and zero-padded forms', () => {
    expect(normaliseIv27aBayer('alf', 'Lyr')).toEqual({
      class: 'bayer',
      bayer: { letter: 'α', sup: null, dc: 'Lyr', component: null },
    });
    expect(normaliseIv27aBayer('ksi', 'UMa')).toEqual({
      class: 'bayer',
      bayer: { letter: 'ξ', sup: null, dc: 'UMa', component: null },
    });
    expect(normaliseIv27aBayer('mu.01', 'Sco')).toEqual({
      class: 'bayer',
      bayer: { letter: 'μ', sup: 1, dc: 'Sco', component: null },
    });
    expect(normaliseIv27aBayer('tau02', 'Eri')).toEqual({
      class: 'bayer',
      bayer: { letter: 'τ', sup: 2, dc: 'Eri', component: null },
    });
  });

  it('keeps Latin letters and their indices', () => {
    expect(normaliseIv27aBayer('c', 'Pup')).toEqual({
      class: 'bayer',
      bayer: { letter: 'c', sup: null, dc: 'Pup', component: null },
    });
    expect(normaliseIv27aBayer('A01', 'Cen')).toEqual({
      class: 'bayer',
      bayer: { letter: 'A', sup: 1, dc: 'Cen', component: null },
    });
  });

  it('rejects the GCVS-style contaminants as variable designations', () => {
    expect(normaliseIv27aBayer('R', 'And')).toEqual({ class: 'variable', designation: 'R And' });
    expect(normaliseIv27aBayer('RZ', 'Cas')).toEqual({ class: 'variable', designation: 'RZ Cas' });
    expect(normaliseIv27aBayer('V380', 'Cyg')).toEqual({ class: 'variable', designation: 'V380 Cyg' });
  });
});

describe('name cells', () => {
  it('splits the three multi-name forms', () => {
    expect(splitNameCell('Nganurganity / Unurgunite'))
      .toEqual({ name: 'Nganurganity', aliases: ['Unurgunite'] });
    expect(splitNameCell('Yunü (Yunu)'))
      .toEqual({ name: 'Yunü', aliases: ['Yunu'] });
    expect(splitNameCell('Bake-eo (or Bake Eo)'))
      .toEqual({ name: 'Bake-eo', aliases: ['Bake Eo'] });
    expect(splitNameCell('Vega')).toEqual({ name: 'Vega', aliases: [] });
  });

  it('folds diacritics for matching without changing the stored name', () => {
    expect(foldNameKey('Yunü')).toBe('yunu');
    expect(foldNameKey('Bélénos')).toBe('belenos');
    expect(foldNameKey('Ain')).toBe('ain');
  });
});
