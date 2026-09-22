// The dust sprite's constant-drift guards. See
// ../solar-system/README.md § Constant drift.

import { readTslSource } from '../tsl/tsl-source-fixture';
import { describe, expect, it } from 'vitest';
import {
  DUST_TINT, PARTICLE_DIM_FLOOR, PARTICLE_MAX_PX, PARTICLE_MIN_PX,
} from '../../dust/dust-particle-pure';
import { literalDriftOffenders, type PinnedConstant } from '../tsl/literal-drift-pure';

const src = readTslSource(new URL('./dust-particle-tsl.ts', import.meta.url));

const PINNED: readonly PinnedConstant[] = [
  { identifier: 'PARTICLE_MIN_PX', values: [PARTICLE_MIN_PX] },
  { identifier: 'PARTICLE_MAX_PX', values: [PARTICLE_MAX_PX] },
  { identifier: 'PARTICLE_DIM_FLOOR', values: [PARTICLE_DIM_FLOOR] },
  { identifier: 'DUST_TINT', values: DUST_TINT },
];

describe('the TSL sprite reads its shared constants', () => {
  for (const { identifier } of PINNED) {
    it(`references ${identifier}`, () => {
      expect(src).toContain(identifier);
    });
  }
});

describe('the TSL sprite restates no pinned constant as a literal', () => {
  it('carries no drifting copy', () => {
    expect(literalDriftOffenders(src, PINNED)).toEqual([]);
  });
});

// README.md § Two quantities that divide out.
describe('the TSL sprite re-derives no log base', () => {
  it('carries no local LOG10', () => {
    expect(src).not.toMatch(/Math\.log\(\s*10\s*\)/);
    expect(src).not.toMatch(/2\.30258/);
  });
});
