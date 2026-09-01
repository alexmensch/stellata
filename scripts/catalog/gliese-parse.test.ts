import { describe, it, expect } from 'vitest';

import { emptyGlieseIndex, lookupGliese, parseGlieseTsv } from './gliese-parse';

const HEADER = ['name', 'comp', 'vmag', 'n_vmag', 'r_vmag', 'bv', 'n_bv',
  'r_bv', 'sp', 'r_sp', 'plx_mas', 'e_plx_mas', 'n_plx', 'trplx_mas',
  'rv', 'n_rv', 'hd'].join('\t');

const row = (name: string, comp: string, vmag: string, bv = '', sp = '') =>
  [name, comp, vmag, '', '', bv, '', '', sp, '', '', '', '', '', '', '', ''].join('\t');

const tsv = (...rows: string[]) => [HEADER, ...rows].join('\n');

describe('parseGlieseTsv', () => {
  it('keys on the bare number so every V/70A prefix meets the record cell', () => {
    // GJ 3xxx / 4xxx are printed `NN nnnn`, which is the whole reason the
    // prefix cannot be part of the key.
    const index = parseGlieseTsv(tsv(
      row('Gl 699', '', '9.55', '1.74', 'M5 V'),
      row('NN 3417', '', '13.65'),
      row('GJ 1001', '', '12.84'),
      row('Wo 9038', '', '11.2'),
    ));
    expect(index.rowCount).toBe(4);
    expect(lookupGliese(index, 'Gl 699')?.vMag).toBe(9.55);
    expect(lookupGliese(index, 'GJ 3417')?.vMag).toBe(13.65);
    expect(lookupGliese(index, 'Gl 3417')?.vMag).toBe(13.65);
    expect(lookupGliese(index, 'GJ 1001')?.vMag).toBe(12.84);
  });

  it('resolves a component against the row that covers it', () => {
    const index = parseGlieseTsv(tsv(
      row('Gl 559', 'A', '0.01'),
      row('Gl 559', 'B', '1.34'),
    ));
    expect(lookupGliese(index, 'Gl 559A')?.vMag).toBe(0.01);
    expect(lookupGliese(index, 'Gl 559B')?.vMag).toBe(1.34);
    // Bare number with two components resolves to the first row indexed.
    expect(lookupGliese(index, 'Gl 559')?.vMag).toBe(0.01);
  });

  // Gl 165 is the shape: the catalogue never split the pair, so the record's
  // `Gl 165A` has only the blend to read — which is why this tier is a
  // system blend.
  it('falls a component back to the blended system entry', () => {
    const index = parseGlieseTsv(tsv(row('Gl 165', 'AB', '13.67')));
    expect(lookupGliese(index, 'Gl 165A')?.vMag).toBe(13.67);
    expect(lookupGliese(index, 'Gl 165B')?.vMag).toBe(13.67);
    expect(lookupGliese(index, 'Gl 165')?.vMag).toBe(13.67);
  });

  // A per-letter alias must never displace a row that names that component
  // outright, or the blend would shadow the resolved component's own value.
  it('prefers an exact component row over a blend row aliasing onto it', () => {
    const index = parseGlieseTsv(tsv(
      row('Gl 800', 'AB', '11.0'),
      row('Gl 800', 'A', '11.5'),
    ));
    expect(lookupGliese(index, 'Gl 800A')?.vMag).toBe(11.5);
    expect(lookupGliese(index, 'Gl 800B')?.vMag).toBe(11.0);
  });

  it('throws on a repeated exact key rather than picking a winner', () => {
    expect(() => parseGlieseTsv(tsv(
      row('Gl 699', '', '9.55'),
      row('Gl 699', '', '9.60'),
    ))).toThrow(/two rows keyed 699/);
  });

  it('carries the decimal-numbered entries distinctly', () => {
    const index = parseGlieseTsv(tsv(
      row('Gl 165', '', '13.67'),
      row('Gl 165.1', '', '8.67'),
    ));
    expect(lookupGliese(index, 'Gl 165.1')?.vMag).toBe(8.67);
    expect(lookupGliese(index, 'Gl 165')?.vMag).toBe(13.67);
  });

  it('answers null for an absent or empty cell', () => {
    const index = parseGlieseTsv(tsv(row('Gl 699', '', '9.55')));
    expect(lookupGliese(index, 'Gl 9999')).toBeNull();
    expect(lookupGliese(index, null)).toBeNull();
    expect(lookupGliese(index, '  ')).toBeNull();
    expect(lookupGliese(emptyGlieseIndex(), 'Gl 699')).toBeNull();
  });

  it('reads B−V and the spectral string alongside V', () => {
    const index = parseGlieseTsv(tsv(row('Gl 699', '', '9.55', '1.74', 'M5 V')));
    const r = lookupGliese(index, 'Gl 699')!;
    expect(r.bMinusV).toBe(1.74);
    expect(r.spectral).toBe('M5 V');
    expect(r.name).toBe('Gl 699');
  });

  it('leaves an absent V null rather than zero', () => {
    const index = parseGlieseTsv(tsv(row('Gl 700', '', '')));
    expect(lookupGliese(index, 'Gl 700')?.vMag).toBeNull();
  });
});
