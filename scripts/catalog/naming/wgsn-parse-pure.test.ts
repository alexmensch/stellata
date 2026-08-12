import { describe, it, expect } from 'vitest';

import {
  parseNecCsv,
  parseWgsnFaintsCsv,
  splitCsvLine,
} from './wgsn-parse-pure';

const NEC_HEADER = 'NEC,Name,HIP,RA2000,DE2000,Vmag,Gmag,type,HR,HD,Bayer/other,constellation,distance from Sun/ ly,B-V color,VmagMax,VmagMin';
const FAINTS_HEADER = 'WGSN-ID,Name,HIP,RA2000,DE2000,Vmag,type,HR,HD,Bayer/other,constellation,distance from Sun/ ly,B-V color,VmagMax,VmagMin,WDS';

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

  it('rejects a drifted header', () => {
    expect(() => parseNecCsv('NEC,Name,HIP\n1,,')).toThrow(/header drifted/);
  });
});

describe('parseWgsnFaintsCsv', () => {
  it('decodes the WDS column and names', () => {
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
});
