import { describe, expect, it } from 'vitest';

import { fitsBytes } from './fits-fixture';
import { readFitsTable } from './fits-pure';

describe('readFitsTable', () => {
  it('reads every column type a pull asks for, each null as null', () => {
    const bytes = fitsBytes(
      [
        { name: 'Name', form: '8A' }, { name: 'HD', form: 'J', tnull: -2147483648 }, { name: 'Sn', form: 'I', tnull: -32768 },
        { name: 'flag', form: 'L' }, { name: 'source_id', form: 'K', tnull: -1 }, { name: 'B', form: 'B' },
        { name: 'Vmag', form: 'E' }, { name: 'RAJ2000', form: 'D' },
      ],
      [
        ['GJ 1001', 1326, 5, true, 5853498713190525696n, 7, 12.84, 50.41997493299496],
        ['', null, null, null, null, 0, null, null],
      ],
    );
    expect(readFitsTable(bytes)).toEqual({
      kind: 'table',
      columns: ['Name', 'HD', 'Sn', 'flag', 'source_id', 'B', 'Vmag', 'RAJ2000'],
      rows: [
        ['GJ 1001', '1326', '5', 'true', '5853498713190525696', '7', '12.84', '50.41997493299496'],
        [null, null, null, null, null, '0', null, null],
      ],
    });
  });

  it('writes a double as the shortest digits that read back to it, not a catalogue\'s printed precision', () => {
    const table = readFitsTable(fitsBytes([{ name: 'DEB1950', form: 'D' }], [[-40.963333333333324]]));
    expect(table.kind === 'table' && table.rows[0][0]).toBe('-40.963333333333324');
  });

  it('writes a float32 as the shortest digits that read back to that float32', () => {
    const table = readFitsTable(fitsBytes([{ name: 'plx', form: 'E' }], [[104.2]]));
    expect(table.kind === 'table' && table.rows[0][0]).toBe('104.2');
  });

  it('keeps a string\'s leading blanks and drops its padding', () => {
    const table = readFitsTable(fitsBytes([{ name: 'Name', form: '10A' }], [['  3Alp Lyr']]));
    expect(table.kind === 'table' && table.rows[0][0]).toBe('  3Alp Lyr');
  });

  it('reads a file with no table as no-table, which ASU answers a query that matched no row with', () => {
    expect(readFitsTable(fitsBytes(null))).toEqual({ kind: 'no-table' });
  });

  it('reads a reply cut inside a header or inside the rows as incomplete', () => {
    const whole = fitsBytes([{ name: 'HIP', form: 'J' }], Array.from({ length: 1000 }, (_, i) => [i]));
    expect(readFitsTable(whole.subarray(0, 1120)).kind).toBe('incomplete');
    expect(readFitsTable(whole.subarray(0, 2880 + 1200)).kind).toBe('incomplete');
    expect(readFitsTable(whole.subarray(0, whole.length - 2880)).kind).toBe('incomplete');
  });

  it('refuses a structure it does not read rather than guess at it', () => {
    const text = new TextDecoder('latin1').decode(fitsBytes([{ name: 'pos', form: '16A' }], [['']]));
    const array = Uint8Array.from(text.replace('\'16A     \'', '\'2D      \''), (c) => c.charCodeAt(0));
    expect(() => readFitsTable(array)).toThrow(/array/);
    expect(() => readFitsTable(Uint8Array.from('END'.padEnd(2880), (c) => c.charCodeAt(0)))).toThrow(/SIMPLE/);
  });
});
