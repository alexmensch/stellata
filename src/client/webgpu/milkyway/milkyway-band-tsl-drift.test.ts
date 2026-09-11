// The TSL band's constant-drift guard against the CPU mirror the brightness
// bound is taken from — README.md § The bound is taken off the mirror, and
// ../solar-system/README.md § Constant drift runs in both directions.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  FOREGROUND_DUST_STEPS, MAG_PER_TAU, S_MIN_PC, STEPS, UNIT_BALL_SLACK,
} from '../../milkyway/milkyway-column-pure';
import { literalDriftOffenders, type PinnedConstant } from '../tsl/literal-drift-pure';

const src = readFileSync(
  fileURLToPath(new URL('./milkyway-band-tsl.ts', import.meta.url)), 'utf8');

// The march's own shape — what decides whether the TSL integrates the column
// the mirror computes. The density and dust parameters are deliberately NOT
// here: they cross as uniform nodes whose single writer is
// `seedBandSharedSlots` (README.md § Seeding, because a node starts on its
// declared default), and band-materials.test.ts fails until a new slot joins
// it. Pinning them here would duplicate that guard, not extend it.
const PINNED: readonly PinnedConstant[] = [
  { identifier: 'STEPS', values: [STEPS] },
  { identifier: 'FOREGROUND_DUST_STEPS', values: [FOREGROUND_DUST_STEPS] },
  { identifier: 'S_MIN_PC', values: [S_MIN_PC] },
  { identifier: 'UNIT_BALL_SLACK', values: [UNIT_BALL_SLACK] },
  { identifier: 'MAG_PER_TAU', values: [MAG_PER_TAU] },
];

describe('the TSL band reads the mirror its bound is taken from', () => {
  for (const { identifier } of PINNED) {
    it(`references ${identifier}`, () => {
      expect(src).toContain(identifier);
    });
  }

  it('takes them from milkyway-column-pure rather than restating them', () => {
    expect(src).toMatch(/from '\.\.\/\.\.\/milkyway\/milkyway-column-pure'/);
  });
});

describe('the TSL band restates no pinned constant as a literal', () => {
  it('carries no drifting copy', () => {
    expect(
      literalDriftOffenders(src, PINNED, [
        // 1 and 1.001 as bare numbers carry no signal in a node graph —
        // float(1), vec3(1) and exponents spell them constantly — so for
        // these two only the named import above can be checked.
        { value: S_MIN_PC, reason: 'float(1) / vec3(1) are ubiquitous in a node graph' },
        { value: UNIT_BALL_SLACK, reason: 'indistinguishable from an ordinary 1.001 slack' },
      ]),
    ).toEqual([]);
  });
});
