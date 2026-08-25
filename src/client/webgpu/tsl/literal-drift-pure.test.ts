import { describe, expect, it } from 'vitest';
import { literalDriftOffenders } from './literal-drift-pure';

const PINNED = [
  { identifier: 'STEPS', values: [30] },
  { identifier: 'FLOOR', values: [0.15] },
  { identifier: 'TINT', values: [0.7, 0.55] },
];

describe('literalDriftOffenders', () => {
  it('passes a source that only names its constants', () => {
    expect(literalDriftOffenders('mix(float(FLOOR), 1.0, t).mul(STEPS)', PINNED))
      .toEqual([]);
  });

  // The whole reason the scan compares values rather than text: shader
  // code spells an integral constant `30.0`, and a text pattern for `30`
  // rejects it on the trailing dot.
  it('catches an integral constant written in decimal form', () => {
    expect(literalDriftOffenders('float(30.0)', PINNED)).toEqual(['STEPS (30)']);
    expect(literalDriftOffenders('float(30)', PINNED)).toEqual(['STEPS (30)']);
    expect(literalDriftOffenders('float(3e1)', PINNED)).toEqual(['STEPS (30)']);
  });

  it('catches a trailing-zero copy of a fractional constant', () => {
    expect(literalDriftOffenders('vec3(0.70, 0.55, x)', PINNED))
      .toEqual(['TINT (0.7)', 'TINT (0.55)']);
  });

  it('does not match a number that merely shares a prefix', () => {
    expect(literalDriftOffenders('float(300.0), float(0.155)', PINNED)).toEqual([]);
  });

  it('reads identifiers as identifiers, not as the digits inside them', () => {
    expect(literalDriftOffenders('LOG30 + vec30 + a30', PINNED)).toEqual([]);
  });
});
