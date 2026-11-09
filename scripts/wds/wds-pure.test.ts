import { describe, expect, it } from 'vitest';

import { wdsPair } from './wds-fixture';

const FIXTURE = { file: 'fixture/wds.txt', hint: 'h' } as const;
import { dedupWdsPairRows, measuredOffset, parseOrb6, parsePreciseCoord, parseWdsSumm, splitComponents } from './wds-pure';

describe('measuredOffset', () => {
  it('is the last ρ and θ when ρ is measured and positive', () => {
    expect(measuredOffset(wdsPair({ rhoLast: 5, thetaLast: 90 }))).toEqual({ rhoArcsec: 5, thetaDeg: 90 });
  });

  it('is null for a ρ = 0 row and for a missing ρ or θ', () => {
    expect(measuredOffset(wdsPair({ rhoLast: 0, thetaLast: 90 }))).toBeNull();
    expect(measuredOffset(wdsPair({ rhoLast: null, thetaLast: 90 }))).toBeNull();
    expect(measuredOffset(wdsPair({ rhoLast: 5, thetaLast: null }))).toBeNull();
  });
});

const WDS_BASE = '00000+7530A  1248      1904 1982    5 246 235   0.8   0.6 '
  + '10.27 11.5  A7IV      +034+005          +74 1056      ';
const WDS_LINE = (WDS_BASE + '000006.64+752859.8').padEnd(130);
const WDS_HEADER_BLOCK = '<some HTML\n'
  + 'Identifier             Frst Last      Fst Lst First  Last  Pri   Sec  Type      RA" DEC" RA" DEC"                 Coordinate      \n'
  + '\n';

function withCells(line: string, start: number, cells: string): string {
  return line.slice(0, start) + cells + line.slice(start + cells.length);
}

const ORB6_HDS = '000233.44+184100.1 00026+1841 HDS   2Aa,Ab   .     225000    201   8.49  10.62     22.68    y   0.34       0.1106 a  0.0028   59.8      1.3     17.4       2.3     2020.967       0.074    0.6313   0.0130   302.2      3.1    2000 2023 3 n Tok2024a wds00026+1841b.png';
const ORB6_STF1110 = '073435.86+315317.8 07346+3153 STF1110AB       6175  60178  36850   1.93   2.97    459.1     y   2.3        6.722  a  0.021   115.107    0.060   41.304     0.085   1959.59    y   0.021    0.3382   0.0023   251.84     0.38   2000 2021 3 n CIA2022d wds07346+3153r.png';

describe('parseWdsSumm', () => {
  it('skips the header block and reads ids, dates and the precise coordinate', () => {
    const [pr, ...rest] = parseWdsSumm(`${WDS_HEADER_BLOCK}${WDS_LINE}\n`, FIXTURE);
    expect(rest).toEqual([]);
    expect(pr.wdsId).toBe('00000+7530');
    expect(pr.discoverer).toBe('A  1248');
    expect(pr.dateLast).toBe(1982);
    expect(pr.precise?.decDeg).toBeCloseTo(75.4833, 2);
  });

  it('reads both ρ / θ sentinels as no measurement', () => {
    const noMeasurement = withCells(withCells(WDS_LINE, 42, '-1 '), 52, '-1.0 ');
    const overflow = withCells(WDS_LINE, 52, '999.9');
    const [a] = parseWdsSumm(`${WDS_HEADER_BLOCK}${noMeasurement}\n`, FIXTURE);
    const [b] = parseWdsSumm(`${WDS_HEADER_BLOCK}${overflow}\n`, FIXTURE);
    expect([a.rhoLast, a.thetaLast, b.rhoLast]).toEqual([null, null, null]);
    const [c] = parseWdsSumm(`${withCells(WDS_LINE, 52, '999.8')}\n`, FIXTURE);
    expect(c.rhoLast).toBe(999.8);
  });

  it('reads a lone `.` as no value and throws on any other non-number, naming the field', () => {
    expect(parseWdsSumm(`${withCells(WDS_LINE, 58, '    .')}\n`, FIXTURE)[0].magPri).toBeNull();
    expect(() => parseWdsSumm(`${withCells(WDS_LINE, 58, 'abcde')}\n`, FIXTURE))
      .toThrow(/fixture\/wds\.txt:1: mag_pri: "abcde" is not a decimal number/);
  });

  it('passes with precise coordinates present and throws past the coverage floor', () => {
    const present = Array.from({ length: 20 }, () => WDS_LINE).join('\n');
    expect(parseWdsSumm(`banner\n${present}\n`, FIXTURE)).toHaveLength(20);
    const drifted = [...Array.from({ length: 18 }, () => WDS_BASE.padEnd(130)), WDS_LINE, WDS_LINE].join('\n');
    expect(() => parseWdsSumm(`banner\n${drifted}\n`, FIXTURE)).toThrow(/'precise' non-null rate 10\.0% .*column-offset drift/);
  });
});

describe('parsePreciseCoord', () => {
  it('reads HHMMSS.SS±DDMMSS.S and refuses a short or malformed field', () => {
    const pos = parsePreciseCoord('073435.86+315317.8');
    expect(pos?.raDeg).toBeCloseTo(113.649417, 5);
    expect(pos?.decDeg).toBeCloseTo(31.888278, 5);
    expect(parsePreciseCoord('073435.86-315317.8')?.decDeg).toBeCloseTo(-31.888278, 5);
    expect(parsePreciseCoord('0734')).toBeNull();
    expect(parsePreciseCoord('0x3435.86+315317.8')).toBeNull();
  });
});

describe('dedupWdsPairRows', () => {
  const cd = (nObs: number, rhoLast: number) => wdsPair({ wdsId: '17247-3412', discoverer: 'WSI  62', components: 'CD', nObs, rhoLast });

  it('keeps the most-observed duplicate', () => {
    const low = cd(3, 1.5);
    const high = cd(7, 3.5);
    expect(dedupWdsPairRows([low, high])).toEqual({ pairs: [high], outcomes: ['dropped', 'kept'] });
  });

  it('keeps the first of a tie', () => {
    const first = cd(3, 3.5);
    expect(dedupWdsPairRows([first, cd(3, 1.5)])).toEqual({ pairs: [first], outcomes: ['kept', 'dropped'] });
  });

  it('passes distinct keys through in order', () => {
    const rows = [cd(3, 1.0), wdsPair({ wdsId: '17247-3412', discoverer: 'WSI  62', components: 'AB', nObs: 2 })];
    expect(dedupWdsPairRows(rows)).toEqual({ pairs: rows, outcomes: ['kept', 'kept'] });
  });
});

describe('parseOrb6', () => {
  it('reads a row with a component designator', () => {
    const { entries } = parseOrb6(`Sixth Catalog\n0000000000111\n0123456789012\n${ORB6_HDS}\n`, FIXTURE);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ wdsId: '00026+1841', components: 'Aa,Ab', grade: 3, hip: 201, pUnit: 'y' });
  });

  it('reads a row with no components as blank', () => {
    const line = '000019.10-441726.0 00003-4417 I  1477        .     224750     25   6.80   7.56    115.4     y   2.9        0.435  a  0.014    65.6      2.6    147.5       1.5     2011.58    y   0.86     0.717    0.020    297.3      2.2    2000 2022 3   Tok2023a wds00003-4417d.png';
    const { entries } = parseOrb6(`banner line\n${line}\n`, FIXTURE);
    expect(entries[0]).toMatchObject({ wdsId: '00003-4417', components: '', grade: 3, hip: 25 });
  });

  it('splits a discoverer packed against its component letters (Castor STF1110 AB)', () => {
    const { entries } = parseOrb6(`banner\n${ORB6_STF1110}\n`, FIXTURE);
    expect(entries[0]).toMatchObject({ wdsId: '07346+3153', discoverer: 'STF1110', components: 'AB', hip: 36850, hd: 60178, grade: 3 });
    expect(entries[0].precise?.raDeg).toBeCloseTo(113.649417, 5);
    expect(entries[0].precise?.decDeg).toBeCloseTo(31.888278, 5);
  });

  it('reads P and ω whole when they overflow one column left of the nominal edge', () => {
    const p = '005458.02+233742.4 00550+2338 STF  73AB        755   5286   4288   6.12   6.54  61183.      d  69.         0.9837 a  0.0011   44.57     0.11   173.66      0.13   35543.      m  21.       0.30603  0.00078  358.62     0.21   2000 2008 2 n Mut2010b wds00550+2338b.png';
    const w = '175619.04-154844.5 17563-1549 WAI   1Aa1,2   10891 163336  87813   6.45k  7.50k    13.4191  d   0.0003     2.0    m  0.1     151.      17.     306.3       5.8    57900.0     d   0.2      0.36     0.02    252.3       4.7              3 n WAI2023  wds17563-1549b.png';
    expect(parseOrb6(`banner\n${p}\n`, FIXTURE).entries[0]).toMatchObject({ pVal: 61183, pUnit: 'd' });
    expect(parseOrb6(`banner\n${w}\n`, FIXTURE).entries[0].periastronDeg).toBe(252.3);
  });

  it('passes with periods present and throws past the coverage floor', () => {
    const blanked = ORB6_HDS.slice(0, 81) + ' '.repeat(11) + ORB6_HDS.slice(92);
    expect(parseOrb6(`banner\n${Array(20).fill(ORB6_HDS).join('\n')}\n`, FIXTURE).entries).toHaveLength(20);
    const drifted = [...Array(19).fill(blanked), ORB6_HDS].join('\n');
    expect(() => parseOrb6(`banner\n${drifted}\n`, FIXTURE)).toThrow(/'P' non-null rate 5\.0% .*column-offset drift/);
  });

  it('reads a non-digit grade as 5 and counts it', () => {
    const ungraded = ORB6_HDS.slice(0, 233) + 'x' + ORB6_HDS.slice(234);
    const { entries, grades } = parseOrb6(`banner\n${ungraded}\n`, FIXTURE);
    expect(entries[0].grade).toBe(5);
    expect(grades).toEqual(['fallback']);
  });
});

describe('splitComponents', () => {
  it('splits a two-letter field and a comma-separated one', () => {
    expect(splitComponents('AB')).toEqual(['A', 'B']);
    expect(splitComponents('Aa,Ab')).toEqual(['Aa', 'Ab']);
    expect(splitComponents('BC,D')).toEqual(['BC', 'D']);
    expect(splitComponents(' Aa1, 2 ')).toEqual(['Aa1', '2']);
  });

  it('is null for a blank field and for a form with no confident split', () => {
    for (const field of ['', '   ', 'ABC', 'A', 'A,B,C']) expect(splitComponents(field)).toBeNull();
  });
});
