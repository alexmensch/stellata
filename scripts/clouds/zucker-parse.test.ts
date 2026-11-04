import { describe, expect, it } from 'vitest';

import { parseZ2020Sightlines, parseZ2021Extents, parseZ2021Masses, parseZ2021PlummerFits } from './zucker-parse';

const FROM = { file: 'fixture/table.dat', hint: 'fixture' };

describe('parseZ2020Sightlines', () => {
  const row = (recno: string, name: string, l: string, b: string, d: string): string =>
    [recno, name, l, b, ...Array(10).fill('0'), d, '0'].join('\t');

  it('groups sightlines by trimmed name in first-appearance order, skipping header and malformed rows', () => {
    const text = [
      '# comment',
      ['recno', 'Name', 'GLON', 'GLAT', ...Array(12).fill('x')].join('\t'),
      row('       1', 'Taurus     ', '021.8', '+09.2', ' 278'),
      row('2', 'Aquila', '30', '-1', '200'),
      row('3', 'Taurus', '22', '9', '280'),
      row('4', 'Taurus', '22', '', '280'),
      'short\trow',
      '',
    ].join('\n');
    const out = parseZ2020Sightlines(text);
    expect([...out.keys()]).toEqual(['Taurus', 'Aquila']);
    expect(out.get('Taurus')).toEqual([{ lDeg: 21.8, bDeg: 9.2, dPc: 278 }, { lDeg: 22, bDeg: 9, dPc: 280 }]);
  });
});

describe('the Zucker 2021 tables', () => {
  it('read their columns by header name, whatever the spacing', () => {
    const t1 = 'cloud lmed xmin xmax ymin ymax zmin zmax\nMusca 300 1 2 3 4 5 6\n\n';
    expect(parseZ2021Extents(t1, FROM)).toEqual([{ cloud: 'Musca', xmin: 1, xmax: 2, ymin: 3, ymax: 4, zmin: 5, zmax: 6 }]);
    const t2 = 'cloud \t n0 \t rflat \t p\nPipe \t 47.8 \t 3.1 \t 1.8\n';
    expect(parseZ2021PlummerFits(t2, FROM).get('Pipe')).toEqual({ n0: 47.8, rflat: 3.1, p: 1.8 });
    const t3 = 'cloud mass_nicest mass_leike max_ak_leike\nLupus 1 2 0.28\n';
    expect(parseZ2021Masses(t3, FROM).get('Lupus')).toEqual({ massNicest: 1, massLeike: 2, maxAkLeike: 0.28 });
  });

  it('refuses a missing column and a non-numeric cell', () => {
    expect(() => parseZ2021PlummerFits('cloud n0 rflat\nPipe 1 2\n', FROM)).toThrow(/no "p" column/);
    expect(() => parseZ2021PlummerFits('cloud n0 rflat p\nPipe 1 x 2\n', FROM)).toThrow(/row 2 has no number in "rflat"/);
  });
});
