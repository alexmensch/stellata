import { describe, expect, it } from 'vitest';

import { wdsPair } from '../../wds/wds-fixture';
import type { DecomposedPair } from '../resolve/components-pure';
import { decomposed } from '../resolve/resolve-fixture';
import { UNRESOLVED_ASTROMETRY, type ComponentAstrometry, type PairAstrometry } from './routes-pure';
import { positiveParallaxMas, systemParallaxAnchors, systemParallaxes, systemPmAnchors } from './system-anchors-pure';

const measured = (over: Partial<Extract<ComponentAstrometry, { parallaxMas: unknown }>> = {}): ComponentAstrometry => ({
  astrometryVia: 'gaia_5p', raDeg: 100, decDeg: 0, parallaxMas: 10, parallaxErrorMas: 0.05, pmraMasyr: 1, pmdecMasyr: -1, refEpoch: 2016,
  ...over,
});

function system(rows: readonly (readonly [string, ComponentAstrometry, ComponentAstrometry])[]) {
  const pairs: DecomposedPair[] = rows.map(([components]) => decomposed(wdsPair({ wdsId: 'PX-1', components })));
  const astrometry = new Map<DecomposedPair, PairAstrometry>(pairs.map((p, i) => [p, { primary: rows[i][1], secondary: rows[i][2] }]));
  return { pairs, astrometry };
}

describe('positiveParallaxMas', () => {
  it('reads a measured side\'s parallax, and nothing from an unresolved side or a non-positive parallax', () => {
    expect(positiveParallaxMas(measured({ parallaxMas: 5 }))).toBe(5);
    expect(positiveParallaxMas(UNRESOLVED_ASTROMETRY)).toBeNull();
    expect(positiveParallaxMas(measured({ parallaxMas: -1 }))).toBeNull();
    expect(positiveParallaxMas(measured({ parallaxMas: null }))).toBeNull();
  });
});

describe('systemParallaxes', () => {
  it('takes the primary first, the secondary when the primary has none', () => {
    const both = system([['AB', measured({ parallaxMas: 10 }), measured({ parallaxMas: 20 })]]);
    expect(systemParallaxes(both.pairs, both.astrometry).get('PX-1')).toBe(10);
    const secondary = system([['AB', UNRESOLVED_ASTROMETRY, measured({ parallaxMas: 20 })]]);
    expect(systemParallaxes(secondary.pairs, secondary.astrometry).get('PX-1')).toBe(20);
  });

  it('lets the first pair row anchor a later all-unresolved row, and the first resolved row anchor an earlier one', () => {
    const s = system([
      ['AB', measured({ parallaxMas: 12.5 }), UNRESOLVED_ASTROMETRY],
      ['AC', UNRESOLVED_ASTROMETRY, measured({ parallaxMas: 30 })],
    ]);
    expect(systemParallaxes(s.pairs, s.astrometry).get('PX-1')).toBe(12.5);
    const late = system([['AB', UNRESOLVED_ASTROMETRY, UNRESOLVED_ASTROMETRY], ['AC', measured({ parallaxMas: 30 }), UNRESOLVED_ASTROMETRY]]);
    expect(systemParallaxes(late.pairs, late.astrometry).get('PX-1')).toBe(30);
  });

  it('has no entry for a system with no parallax', () => {
    const s = system([['AB', UNRESOLVED_ASTROMETRY, measured({ parallaxMas: null })]]);
    expect(systemParallaxes(s.pairs, s.astrometry).has('PX-1')).toBe(false);
  });
});

describe('systemParallaxAnchors', () => {
  it('carries the parallax with its error, a missing error as null', () => {
    const s = system([['AB', UNRESOLVED_ASTROMETRY, measured({ parallaxMas: 20, parallaxErrorMas: 0.4 })]]);
    expect(systemParallaxAnchors(s.pairs, s.astrometry).get('PX-1')).toEqual({ parallaxMas: 20, parallaxErrorMas: 0.4 });
    const hip2 = system([['AB', measured({ astrometryVia: 'hip2_long_baseline', parallaxMas: 12, parallaxErrorMas: null }), measured({ parallaxMas: 11 })]]);
    expect(systemParallaxAnchors(hip2.pairs, hip2.astrometry).get('PX-1')).toEqual({ parallaxMas: 12, parallaxErrorMas: null });
  });

  it('has no entry for a system with no parallax', () => {
    const s = system([['AB', UNRESOLVED_ASTROMETRY, UNRESOLVED_ASTROMETRY]]);
    expect(systemParallaxAnchors(s.pairs, s.astrometry).size).toBe(0);
  });
});

describe('systemPmAnchors', () => {
  it('takes the first side measuring both PM components, independently of the parallax anchor', () => {
    const s = system([['AB', measured({ pmdecMasyr: null }), measured({ parallaxMas: null, pmraMasyr: 3, pmdecMasyr: 4 })]]);
    expect(systemPmAnchors(s.pairs, s.astrometry).get('PX-1')).toEqual({ pmraMasyr: 3, pmdecMasyr: 4 });
    expect(systemParallaxes(s.pairs, s.astrometry).get('PX-1')).toBe(10);
  });
});
