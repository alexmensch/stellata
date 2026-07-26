import { describe, it, expect } from 'vitest';

import { parseHorizonsElements } from './horizons-elements';

const HEADER = [
  'Target body name: Jupiter Barycenter (5)          {source: DE441}',
  'Center body name: Sun (10)                        {source: DE441}',
  'Output units    : AU-D, deg, Julian Day Number (Tp)',
  'Output type     : GEOMETRIC osculating elements',
  'Reference frame : Ecliptic of J2000.0',
].join('\n');

// JDTDB, calendar, EC, QR, IN, OM, W, Tp, N, MA, TA, A, AD, PR
const ROW_A =
  '2451544.500000000, A.D. 2000-Jan-01 00:00:00.0000,  4.892305962953223E-02,  4.950458747513403E+00,  1.304655711046047E+00,  1.004888615724618E+02,  2.751197059498091E+02,  2.451318996398118E+06,  8.303602896333602E-02,  1.872492361720237E+01,  2.063463654069944E+01,  5.205108585205607E+00,  5.459758422897811E+00,  4.335467440994264E+03,';
const ROW_B =
  '2451594.500000000, A.D. 2000-Feb-20 00:00:00.0000,  4.884870596211324E-02,  4.950703487691774E+00,  1.304437645548132E+00,  1.005069067712867E+02,  2.752360304983512E+02,  2.451320447046433E+06,  8.304091812756088E-02,  2.309679051720520E+01,  2.523207102007144E+01,  5.204904277249296E+00,  5.459105066806820E+00,  4.335212183552649E+03,';

function response(header: string, rows: string[]): string {
  return `${header}\n*****\n$$SOE\n${rows.join('\n')}\n$$EOE\n*****\n`;
}

function withHeaderLine(label: string, value: string): string {
  return HEADER.replace(new RegExp(`^${label}.*$`, 'm'), `${label}: ${value}`);
}

describe('parseHorizonsElements', () => {
  it('keeps the six Keplerian columns plus the mean motion, dropping the rest', () => {
    const { rows } = parseHorizonsElements(response(HEADER, [ROW_A, ROW_B]));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      jd: 2451544.5,
      aAu: 5.205108585205607,
      e: 0.04892305962953223,
      iDeg: 1.304655711046047,
      longnodeDeg: 100.4888615724618,
      argperiDeg: 275.1197059498091,
      mDeg: 18.72492361720237,
      nDegPerDay: 0.08303602896333602,
    });
    expect(rows[1].jd).toBe(2451594.5);
  });

  it('echoes the provenance header fields', () => {
    const { header } = parseHorizonsElements(response(HEADER, [ROW_A]));
    expect(header.frame).toBe('Ecliptic of J2000.0');
    expect(header.outputType).toBe('GEOMETRIC osculating elements');
    expect(header.centerBody.startsWith('Sun (10)')).toBe(true);
    expect(header.targetBody.startsWith('Jupiter Barycenter (5)')).toBe(true);
  });

  // Mean elements carry none of the short-period perturbation the table exists
  // to capture, and would otherwise parse and interpolate perfectly happily.
  it('rejects mean elements, a reframed response, a moved centre, and other units', () => {
    const cases: Array<[string, string, RegExp]> = [
      ['Output type     ', 'MEAN osculating elements', /output type/],
      ['Reference frame ', 'ICRF', /frame/],
      ['Center body name', 'Solar System Barycenter (0)', /centred on/],
      ['Output units    ', 'KM-S, deg', /units/],
    ];
    for (const [label, value, pattern] of cases) {
      expect(() => parseHorizonsElements(response(withHeaderLine(label, value), [ROW_A])))
        .toThrow(pattern);
    }
  });

  it('rejects a changed column count', () => {
    expect(() => parseHorizonsElements(response(HEADER, [`${ROW_A} 1.0,`])))
      .toThrow(/columns/);
  });

  it('rejects a hyperbolic or degenerate orbit rather than solving Kepler on it', () => {
    const hyperbolic = ROW_A.replace('4.892305962953223E-02', '1.204892305962953E+00');
    expect(() => parseHorizonsElements(response(HEADER, [hyperbolic])))
      .toThrow(/bound elliptical/);
  });

  it('rejects a non-ascending epoch column', () => {
    expect(() => parseHorizonsElements(response(HEADER, [ROW_B, ROW_A])))
      .toThrow(/not ascending/);
  });

  it('rejects a response with no data block and an empty one', () => {
    expect(() => parseHorizonsElements(`${HEADER}\nNo ephemeris for target`)).toThrow(/\$\$SOE/);
    expect(() => parseHorizonsElements(response(HEADER, []))).toThrow(/empty/);
  });
});
