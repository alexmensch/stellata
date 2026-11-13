import { describe, expect, it } from 'vitest';

import { formatExponent, formatFixed, formatRepr, roundEach, roundHalfEven } from './round-pure';

describe('roundHalfEven', () => {
  it('rounds an exact binary tie to even, as Python round() does', () => {
    expect(roundHalfEven(0.125, 2)).toBe(0.12);
    expect(roundHalfEven(0.375, 2)).toBe(0.38);
    expect(roundHalfEven(-0.125, 2)).toBe(-0.12);
    expect(roundHalfEven(2.5, 0)).toBe(2);
  });

  it('rounds a near-tie by the exact value of the double', () => {
    expect(roundHalfEven(2.675, 2)).toBe(2.67);
    expect(roundHalfEven(1.005, 2)).toBe(1);
    expect(roundHalfEven(240.9626700838767, 2)).toBe(240.96);
  });
});

describe('formatFixed', () => {
  it('writes what Python f"{x:.Nf}" writes', () => {
    const python3 = ['0.062', '0.125', '2.675', '-0.000', '-0.000', '0.000', '-1.000', '123456.000'];
    expect([0.0625, 0.125, 2.675, -0.0001, -0, 1e-7, -1.0005, 123456.0005].map((x) => formatFixed(x, 3))).toEqual(python3);
    expect([0.125, 0.375, -0.125].map((x) => formatFixed(x, 2))).toEqual(['0.12', '0.38', '-0.12']);
  });
});

describe('formatExponent', () => {
  it('writes what Python f"{x:.Ne}" writes', () => {
    const xs = [1.275713e-14, 0, -0, 1.5, -2.5, 1e-5, 123456789, 9.9999995e-3, 1e100, 5e-324];
    expect(xs.map((x) => formatExponent(x, 6))).toEqual([
      '1.275713e-14', '0.000000e+00', '-0.000000e+00', '1.500000e+00', '-2.500000e+00', '1.000000e-05',
      '1.234568e+08', '1.000000e-02', '1.000000e+100', '4.940656e-324',
    ]);
  });

  it('rounds an exact tie to even and a near-tie by the exact value', () => {
    expect([1.5, 2.5, 3.5, -0.5].map((x) => formatExponent(x, 0))).toEqual(['2e+00', '2e+00', '4e+00', '-5e-01']);
    expect([1.125, 1.135, 9.995, 0.0001125].map((x) => formatExponent(x, 2))).toEqual(['1.12e+00', '1.14e+00', '9.99e+00', '1.12e-04']);
  });
});

describe('formatRepr', () => {
  it('writes what Python repr(float) writes', () => {
    const values = [
      0, -0, 1, -2.5, 0.0001, 0.00012345, 1e-5, 9.045827e-5, -1.5e-7, 123456789, 1e15, 1e16, 1.2345e16, 1e22,
      773.0921101652751, 27.351328, 0.385854572057724, 5e-324,
    ];
    const python3 = [
      '0.0', '-0.0', '1.0', '-2.5', '0.0001', '0.00012345', '1e-05', '9.045827e-05', '-1.5e-07', '123456789.0',
      '1000000000000000.0', '1e+16', '1.2345e+16', '1e+22', '773.0921101652751', '27.351328', '0.385854572057724', '5e-324',
    ];
    expect(values.map((v) => formatRepr(v))).toEqual(python3);
  });

  it('writes what numpy str(np.float32(x)) writes for a float32', () => {
    const values = [1e-4, 0.000100001, 9.999e-5, 9999999, 1e7, 1234567, 999999, 999999.94, 123456.7, 27.351328, 9.045827e-5, 0.1248893];
    const numpy = [
      '1e-04', '0.000100001', '9.999e-05', '9.999999e+06', '1e+07', '1.234567e+06', '999999.0', '999999.94', '123456.7',
      '27.351328', '9.045827e-05', '0.1248893',
    ];
    expect(values.map((v) => formatRepr(Math.fround(v), 'float32'))).toEqual(numpy);
  });

  it('breaks a float32 halfway between two shortest spellings to the even digit, as numpy does', () => {
    expect([50.6328125, 16.2578125, 6.92578125].map((v) => formatRepr(v, 'float32'))).toEqual(['50.632812', '16.257812', '6.9257812']);
  });

  it('takes the neighbour above at a power of two when the nearest spelling falls short below, as numpy does', () => {
    expect([2 ** 87, 2 ** 90, 2 ** -96].map((v) => formatRepr(v, 'float32'))).toEqual(['1.5474251e+26', '1.2379401e+27', '1.2621775e-29']);
  });

  it('rounds a double to float32 itself before spelling it', () => {
    expect([0.1, 1 / 3].map((v) => formatRepr(v, 'float32'))).toEqual(['0.1', '0.33333334']);
  });

  it('reads the archives\' Java-style text back to the same repr', () => {
    expect(['9.045827E-5', '1.0E7', '0.0', '-4.6393E-4'].map((t) => formatRepr(Number(t))))
      .toEqual(['9.045827e-05', '10000000.0', '0.0', '-0.00046393']);
  });
});

describe('roundEach', () => {
  it('rounds every element half to even and keeps the tuple', () => {
    const rounded: [number, number, number] = roundEach([0.125, 2.675, -0.125] as const, 2);
    expect(rounded).toEqual([0.12, 2.67, -0.12]);
  });
});
