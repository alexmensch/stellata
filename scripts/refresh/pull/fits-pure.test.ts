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
      floats: [false, false, false, false, false, false, true, true],
      rows: [
        ['GJ 1001', '1326', '5', 'true', '5853498713190525696', '7', '12.84', '50.41997493299496'],
        [null, null, null, null, null, '0', null, null],
      ],
    });
  });

  it('writes a float at its declared TDISP Fw.d, dropping the stored value\'s conversion noise', () => {
    const table = readFitsTable(fitsBytes(
      [{ name: 'e_pmRA', form: 'D', tdisp: 'F8.3' }, { name: 'RArad', form: 'D', tdisp: 'F12.8' }, { name: 'Vmag', form: 'E', tdisp: 'F6.2' }],
      [[0.015000000000000001, 104.550895415, 14.9]],
    ));
    expect(table.kind === 'table' && table.rows[0]).toEqual(['0.015', '104.55089542', '14.90']);
  });

  it('reads a signed integer at its type\'s minimum as null where no TNULL is declared, as VizieR writes one', () => {
    const table = readFitsTable(fitsBytes(
      [{ name: 'HD', form: 'J' }, { name: 'GaiaDR3', form: 'K' }, { name: 'n', form: 'B' }],
      [[-2147483648, -9223372036854775808n, 0], [1, 2n, 3]],
    ));
    expect(table.kind === 'table' && table.rows).toEqual([[null, null, '0'], ['1', '2', '3']]);
  });

  it('refuses a display format it does not read', () => {
    expect(() => readFitsTable(fitsBytes([{ name: 'x', form: 'D', tdisp: 'E12.5' }], [[1]]))).toThrow(/TDISP "E12.5"/);
  });

  it('writes a float32 as the shortest digits that read back to that float32', () => {
    const table = readFitsTable(fitsBytes([{ name: 'plx', form: 'E' }], [[104.2]]));
    expect(table.kind === 'table' && table.rows[0][0]).toBe('104.2');
  });

  it('drops a string\'s blanks at both ends, as CDS\'s text replies do, and keeps those inside', () => {
    const table = readFitsTable(fitsBytes([{ name: 'DM', form: '16A' }], [['  BD+04  3561a']]));
    expect(table.kind === 'table' && table.rows[0][0]).toBe('BD+04  3561a');
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
