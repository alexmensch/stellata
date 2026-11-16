import { describe, expect, it } from 'vitest';

import { closePairHdVerdict, type ClosePairWitnesses } from './close-pair-hd-pure';

const TYC = '1-1-1';
const OWN = 7;

function witnesses(iv25: number[] | null, simbad: number[] | null, objectOfSource: number | null): ClosePairWitnesses {
  return {
    iv25Hds: (tyc) => (tyc === TYC && iv25 !== null ? new Set(iv25) : undefined),
    simbadTycHd: new Map(simbad === null ? [] : [[TYC, { hdIdents: simbad.map(String), simbadOid: OWN, mainId: null }]]),
    simbadObjectOfSource: new Map(objectOfSource === null ? [] : [['S', objectOfSource]]),
  };
}

const record = (hd: number | null, tyc: string | null = TYC) => ({ tyc, gaiaSourceId: 'S', hd });

describe('closePairHdVerdict', () => {
  it('is unanswered without a Tycho entry or either TYC witness', () => {
    expect(closePairHdVerdict(record(1, null), witnesses([1], [1], OWN))).toEqual({ kind: 'unanswered' });
    expect(closePairHdVerdict(record(1), witnesses(null, [1], OWN))).toEqual({ kind: 'unanswered' });
    expect(closePairHdVerdict(record(1), witnesses([1], null, OWN))).toEqual({ kind: 'unanswered' });
  });

  it('splits where the TYC witnesses share no HD, whichever the record ships', () => {
    expect(closePairHdVerdict(record(1), witnesses([1], [2], OWN))).toEqual({ kind: 'split' });
  });

  it('leaves a row uncontested where either TYC witness names the shipped HD', () => {
    expect(closePairHdVerdict(record(1), witnesses([1], [1], 99))).toEqual({ kind: 'uncontested' });
    expect(closePairHdVerdict(record(2), witnesses([1, 2], [1], OWN))).toEqual({ kind: 'uncontested' });
  });

  it('moves a contested row only where the source is the TYC\'s own object', () => {
    expect(closePairHdVerdict(record(2), witnesses([1], [1], OWN))).toEqual({ kind: 'move', hds: [1] });
    expect(closePairHdVerdict(record(null), witnesses([1], [1], OWN))).toEqual({ kind: 'move', hds: [1] });
    expect(closePairHdVerdict(record(2), witnesses([1], [1], 99))).toEqual({ kind: 'refuse' });
    expect(closePairHdVerdict(record(2), witnesses([1], [1], null))).toEqual({ kind: 'source-silent' });
  });
});
