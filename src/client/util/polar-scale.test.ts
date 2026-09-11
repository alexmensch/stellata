import { describe, expect, it } from 'vitest';
import { scalePolarInto } from './polar-scale';

const POLE_Y: [number, number, number] = [0, 1, 0];
const out: [number, number, number] = [0, 0, 0];

describe('scalePolarInto', () => {
  it('leaves the equatorial component untouched', () => {
    scalePolarInto(3, 0, 4, ...POLE_Y, 0.5, out);
    expect(out).toEqual([3, 0, 4]);
  });

  it('scales only the component along the pole', () => {
    scalePolarInto(3, 8, 4, ...POLE_Y, 0.5, out);
    expect(out).toEqual([3, 4, 4]);
  });

  it('is the identity at s = 1', () => {
    scalePolarInto(1, 2, 3, ...POLE_Y, 1, out);
    expect(out).toEqual([1, 2, 3]);
  });

  it('works on an oblique pole', () => {
    const k = Math.SQRT1_2;
    // A vector along the pole scales wholesale; one across it does not.
    scalePolarInto(k, k, 0, k, k, 0, 2, out);
    expect(out[0]).toBeCloseTo(2 * k, 12);
    expect(out[1]).toBeCloseTo(2 * k, 12);
    scalePolarInto(k, -k, 0, k, k, 0, 2, out);
    expect(out[0]).toBeCloseTo(k, 12);
    expect(out[1]).toBeCloseTo(-k, 12);
  });

  it('carries a spheroid surface point onto the equatorial sphere', () => {
    // Polar radius 0.9 equatorial radii: the pole point sits at 0.9 and
    // must land on 1, the equator point already is 1 and must not move.
    const s = 1 / 0.9;
    scalePolarInto(0, 0.9, 0, ...POLE_Y, s, out);
    expect(Math.hypot(...out)).toBeCloseTo(1, 12);
    scalePolarInto(1, 0, 0, ...POLE_Y, s, out);
    expect(Math.hypot(...out)).toBeCloseTo(1, 12);
    // A 45° surface point of the same spheroid lands there too.
    const x = Math.SQRT1_2;
    scalePolarInto(x, 0.9 * x, 0, ...POLE_Y, s, out);
    expect(Math.hypot(...out)).toBeCloseTo(1, 12);
  });

  it('round-trips through its inverse', () => {
    scalePolarInto(1.5, -2.25, 0.75, ...POLE_Y, 1 / 0.9, out);
    scalePolarInto(...out, ...POLE_Y, 0.9, out);
    expect(out[0]).toBeCloseTo(1.5, 12);
    expect(out[1]).toBeCloseTo(-2.25, 12);
    expect(out[2]).toBeCloseTo(0.75, 12);
  });
});
