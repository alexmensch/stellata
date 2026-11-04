import { describe, expect, it } from 'vitest';

import { cloudEnvelope, plummerProfile } from './cloud-density-pure';

describe('cloudEnvelope', () => {
  it('is 1 up to the fade start, 0 from uEnv, and smooth between', () => {
    expect(cloudEnvelope(0, 1, 0.85)).toBe(1);
    expect(cloudEnvelope(0.85, 1, 0.85)).toBe(1);
    expect(cloudEnvelope(1, 1, 0.85)).toBe(0);
    expect(cloudEnvelope(1.2, 1, 0.85)).toBe(0);
    expect(cloudEnvelope(0.925, 1, 0.85)).toBeCloseTo(0.5, 12);
  });

  it('scales the fade with a tightened envelope', () => {
    expect(cloudEnvelope(0.425, 0.5, 0.85)).toBe(1);
    expect(cloudEnvelope(0.5, 0.5, 0.85)).toBe(0);
  });
});

describe('plummerProfile', () => {
  it('is 1 at the centre and 2^(-p/2) at the flat radius', () => {
    expect(plummerProfile(0, 3, 2)).toBe(1);
    expect(plummerProfile(3, 3, 2)).toBe(0.5);
    expect(plummerProfile(3, 3, 4)).toBe(0.25);
  });
});
