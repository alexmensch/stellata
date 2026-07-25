import { describe, it, expect } from 'vitest';

import { parseHorizonsVectors } from './horizons-vectors';

const HEADER = [
  'Target body name: Voyager 1 (spacecraft) (-31)    {source: Voyager_1_ST+refit2022_m}',
  'Center body name: Sun (10)                        {source: Voyager_1_ST+refit2022_m}',
  'Output units    : AU-D',
  'Reference frame : ICRF',
].join('\n');

const ROW_A =
  '2443392.500000000, A.D. 1977-Sep-06 00:00:00.0000,  9.679318511236246E-01, -2.588893475204245E-01, -1.120557638477288E-01,  6.683337106329786E-03,  2.004085450608791E-02,  9.148628786247110E-03,';
const ROW_B =
  '2443422.500000000, A.D. 1977-Oct-06 00:00:00.0000,  1.043353361495126E+00,  3.489688185695525E-01,  1.645207669946834E-01, -1.340008780424247E-03,  1.975718090700285E-02,  8.967447853409274E-03,';

function response(header: string, rows: string[]): string {
  return `${header}\n*****\n$$SOE\n${rows.join('\n')}\n$$EOE\n*****\n`;
}

describe('parseHorizonsVectors', () => {
  it('drops the redundant calendar column and keeps jd + state', () => {
    const { samples } = parseHorizonsVectors(response(HEADER, [ROW_A, ROW_B]));
    expect(samples).toHaveLength(2);
    expect(samples[0]).toEqual([
      2443392.5, 0.9679318511236246, -0.2588893475204245, -0.1120557638477288,
      0.006683337106329786, 0.02004085450608791, 0.00914862878624711,
    ]);
    expect(samples[1][0]).toBe(2443422.5);
  });

  it('echoes the provenance header fields', () => {
    const { header } = parseHorizonsVectors(response(HEADER, [ROW_A]));
    expect(header.frame).toBe('ICRF');
    expect(header.units).toBe('AU-D');
    expect(header.centerBody.startsWith('Sun (10)')).toBe(true);
    expect(header.targetBody.startsWith('Voyager 1 (spacecraft) (-31)')).toBe(true);
  });

  it('rejects a response with no data block', () => {
    expect(() => parseHorizonsVectors(`${HEADER}\nNo ephemeris for target`)).toThrow(/\$\$SOE/);
  });

  it('rejects an empty data block', () => {
    expect(() => parseHorizonsVectors(response(HEADER, []))).toThrow(/empty/);
  });

  it('rejects a reframed response', () => {
    const ecliptic = HEADER.replace('Reference frame : ICRF', 'Reference frame : Ecliptic');
    expect(() => parseHorizonsVectors(response(ecliptic, [ROW_A]))).toThrow(/frame "Ecliptic"/);
  });

  it('rejects km-s units', () => {
    const km = HEADER.replace('Output units    : AU-D', 'Output units    : KM-S');
    expect(() => parseHorizonsVectors(response(km, [ROW_A]))).toThrow(/units "KM-S"/);
  });

  it('rejects a non-heliocentric centre', () => {
    const geo = HEADER.replace('Center body name: Sun (10)', 'Center body name: Earth (399)');
    expect(() => parseHorizonsVectors(response(geo, [ROW_A]))).toThrow(/centred on "Earth/);
  });

  it('rejects a missing header field', () => {
    const stripped = HEADER.replace(/^Output units.*$/m, '');
    expect(() => parseHorizonsVectors(response(stripped, [ROW_A]))).toThrow(/Output units/);
  });

  it('rejects a row whose column count changed', () => {
    const short = ROW_A.split(',').slice(0, 5).join(',');
    expect(() => parseHorizonsVectors(response(HEADER, [short]))).toThrow(/columns, expected 8/);
  });

  it('rejects a non-finite cell', () => {
    const nan = ROW_A.replace('9.679318511236246E-01', 'n.a.');
    expect(() => parseHorizonsVectors(response(HEADER, [nan]))).toThrow(/non-finite/);
  });

  it('rejects a non-ascending jd column', () => {
    expect(() => parseHorizonsVectors(response(HEADER, [ROW_B, ROW_A]))).toThrow(/not ascending/);
  });
});
