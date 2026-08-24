// The TSL half of the shader-constant drift guards: a pinned constant must
// be read from its `*-pure.ts` home, never restated as a literal.
// README.md § Constant drift runs in both directions.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ATMO_JITTER_COEFFS, ATMO_JITTER_SCALE, ATMO_N_LIGHT, ATMO_N_VIEW,
  LIGHT_JITTER_STRIDE, TWILIGHT_TAIL_AMP, TWILIGHT_TAIL_REACH,
} from '../../solar-system/atmosphere/atmosphere-scattering-pure';
import {
  RING_BACKLIT_TRANSMIT, RING_SHADOW_FLOOR,
} from '../../solar-system/planets/rings/ring-photometry-pure';
import { LUMA_WEIGHTS } from '../../hdr/tonemap-pure';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');

const SOURCES: Record<string, string> = {
  'atmosphere-scatter-tsl.ts': read('./atmosphere-scatter-tsl.ts'),
  'planet-mesh-tsl.ts': read('./planet-mesh-tsl.ts'),
  'planet-rings-tsl.ts': read('./planet-rings-tsl.ts'),
  'planet-atmosphere-tsl.ts': read('./planet-atmosphere-tsl.ts'),
  'planet-glare-tsl.ts': read('./planet-glare-tsl.ts'),
  'probe-tsl.ts': read('./probe-tsl.ts'),
};
const ALL = Object.values(SOURCES).join('\n');

/** Every constant whose value is authored once in a `*-pure.ts` module and
 *  read by both shader backends. `identifier` is what the TSL side must
 *  reference; `values` are the numbers that must NOT appear as literals. */
const PINNED: readonly { identifier: string; values: readonly number[] }[] = [
  { identifier: 'ATMO_N_VIEW', values: [ATMO_N_VIEW] },
  { identifier: 'ATMO_N_LIGHT', values: [ATMO_N_LIGHT] },
  { identifier: 'LIGHT_JITTER_STRIDE', values: [LIGHT_JITTER_STRIDE] },
  { identifier: 'ATMO_JITTER_COEFFS', values: ATMO_JITTER_COEFFS },
  { identifier: 'ATMO_JITTER_SCALE', values: [ATMO_JITTER_SCALE] },
  // Derived from 1/(4π) on both sides rather than rounded, so it has no
  // literal form to forbid — only the reference is pinned.
  { identifier: 'MS_STRENGTH', values: [] },
  { identifier: 'TWILIGHT_TAIL_AMP', values: [TWILIGHT_TAIL_AMP] },
  { identifier: 'TWILIGHT_TAIL_REACH', values: [TWILIGHT_TAIL_REACH] },
  { identifier: 'RING_SHADOW_FLOOR', values: [RING_SHADOW_FLOOR] },
  { identifier: 'RING_BACKLIT_TRANSMIT', values: [RING_BACKLIT_TRANSMIT] },
  { identifier: 'LUMA_WEIGHTS', values: LUMA_WEIGHTS },
];

describe('the TSL surfaces read their shared constants', () => {
  for (const { identifier } of PINNED) {
    it(`references ${identifier}`, () => {
      expect(ALL).toContain(identifier);
    });
  }
});

describe('the TSL surfaces restate no pinned constant as a literal', () => {
  for (const [file, src] of Object.entries(SOURCES)) {
    it(`${file} carries no drifting copy`, () => {
      const offenders: string[] = [];
      for (const { identifier, values } of PINNED) {
        for (const value of values) {
          // Word-bounded so 16 does not match 160, and 0.25 does not match
          // 0.256 — a literal that merely shares a prefix is a different
          // number, not a restatement.
          const literal = new RegExp(`(?<![\\w.])${
            String(value).replace('.', '\\.')}(?![\\w.])`);
          if (literal.test(src)) offenders.push(`${identifier} (${value})`);
        }
      }
      expect(offenders).toEqual([]);
    });
  }
});
