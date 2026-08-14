import { describe, it, expect } from 'vitest';

import {
  FAINTS_HEADER,
  NEC_HEADER,
  parseNecCsv,
  parseWgsnFaintsCsv,
  splitCsvLine,
} from './wgsn-parse-pure';

describe('splitCsvLine', () => {
  it('splits plain cells and preserves empties', () => {
    expect(splitCsvLine('a,,c')).toEqual(['a', '', 'c']);
  });

  it('keeps commas inside quoted cells and unescapes doubled quotes', () => {
    expect(splitCsvLine('1,"C5,5",x')).toEqual(['1', 'C5,5', 'x']);
    expect(splitCsvLine('1,"say ""hi""",x')).toEqual(['1', 'say "hi"', 'x']);
  });
});

describe('parseNecCsv', () => {
  it('decodes keys, null spellings, and HD component letters', () => {
    const rows = parseNecCsv([
      NEC_HEADER,
      '5,,HIP 88,0.269,-48.8,5.698,5.489,G6/8III,9081,224834,τ Phoenicis,Phoenix,546.06,0.911,,',
      '3,,,0.143,-53.09,6.48,6.415,~,_,224782A,null,Phoenix,193.01,0.616,,',
    ].join('\n'));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      hip: 88, hr: 9081, hd: 224834, hdComponent: null,
      bayerOther: 'τ Phoenicis', vmag: 5.698, source: 'nec', name: null,
    });
    expect(rows[1]).toMatchObject({
      hip: null, hr: null, hd: 224782, hdComponent: 'A', bayerOther: null,
    });
  });

  it('splits component letters off both key columns, and reads - as null', () => {
    const rows = parseNecCsv([
      NEC_HEADER,
      '1,,HIP 518A,0.1,1.0,5.0,4.9,G0,-,62264AB,κ Ceti,Cetus,10,0.6,,',
      '2,,-,0.2,2.0,6.0,5.9,B9,-,-,* bet Cen B,Centaurus,20,0.1,,',
    ].join('\n'));
    expect(rows[0]).toMatchObject({
      hip: 518, hipComponent: 'A', hr: null, hd: 62264, hdComponent: 'AB',
    });
    expect(rows[1]).toMatchObject({
      hip: null, hipComponent: null, hr: null, hd: null, hdComponent: null,
    });
  });

  it('fails loudly on a key shape neither parsed nor a null spelling', () => {
    const line = '1,,HIP 518 A,0.1,1.0,5.0,4.9,G0,,1,,Cetus,10,0.6,,';
    expect(() => parseNecCsv([NEC_HEADER, line].join('\n')))
      .toThrow(/unparsed HIP cell "HIP 518 A"/);
  });

  it('rejects a drifted header', () => {
    expect(() => parseNecCsv('NEC,Name,HIP\n1,,')).toThrow(/header drifted/);
  });
});

describe('parseWgsnFaintsCsv', () => {
  it('decodes names, keys and the null spellings', () => {
    const rows = parseWgsnFaintsCsv([
      FAINTS_HEADER,
      '10001,Citadelle,HIP 1547,4.82,14.05,8.52,K0,,1502,,Pisces,546.31,0.92,,,',
      '10007,Mpingo,,29.26,0.75,10.56,G2,,_,WASP-71,Cetus,,0.79,,,_',
    ].join('\n'));
    expect(rows[0]).toMatchObject({
      name: 'Citadelle', hip: 1547, hd: 1502, wds: null, source: 'faints',
    });
    expect(rows[1]).toMatchObject({
      name: 'Mpingo', hip: null, hd: null, bayerOther: 'WASP-71', wds: null,
    });
  });

  // The 2025-05 release leaves WDS empty in all 132 rows, so the build pins
  // the cell count at zero — this covers the column the pin protects.
  it('reads a populated WDS cell when upstream supplies one', () => {
    const rows = parseWgsnFaintsCsv([
      FAINTS_HEADER,
      '10002,Toliman,HIP 71683,219.9,-60.83,-0.01,G2,,128620,,Centaurus,4.4,0.71,,,14396-6050B',
    ].join('\n'));
    expect(rows[0].wds).toBe('14396-6050B');
  });
});
