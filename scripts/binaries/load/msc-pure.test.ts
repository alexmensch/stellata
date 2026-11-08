import { describe, expect, it } from 'vitest';

import { J2000_JD } from '../../../src/astro-core/astronomy-constants';
import { componentKey } from '../component-tokens-pure';
import { mscOrbit, mscSystem } from './load-fixture';
import {
  TRUNCATED_JD_TO_JD_OFFSET, buildMscLookup, mapMscLabels, mscPairKey, mscPeriodDays, mscRenderable, mscT0Jd,
} from './msc-pure';

describe('mapMscLabels', () => {
  it('maps root ties, compound constituents and WDS-convention sub-pairs to themselves (AR Cas)', () => {
    const mapping = mapMscLabels([
      mscSystem({ prim: 'AB', sec: 'FG', parent: 't' }),
      mscSystem({ prim: 'F', sec: 'G', parent: 'FG' }),
      mscSystem({ prim: 'A', sec: 'B', parent: 'AB' }),
      mscSystem({ prim: 'Aa', sec: 'Ab', parent: 'A' }),
    ]);
    expect(Object.fromEntries(mapping)).toEqual({ AB: 'AB', FG: 'FG', F: 'F', G: 'G', A: 'A', B: 'B', Aa: 'Aa', Ab: 'Ab' });
  });

  it('re-labels a union label one level down (ν Sco)', () => {
    const mapping = mapMscLabels([
      mscSystem({ prim: 'AB', sec: 'CD', parent: '*' }),
      mscSystem({ prim: 'A', sec: 'B', parent: 'AB' }),
      mscSystem({ prim: 'Aab', sec: 'Ac', parent: 'A' }),
      mscSystem({ prim: 'Aa', sec: 'Ab', parent: 'Aab' }),
    ]);
    expect([mapping.get('Aab'), mapping.get('Ac'), mapping.get('Aa'), mapping.get('Ab')]).toEqual(['Aa', 'Ab', 'Aa1', 'Aa2']);
  });

  it('drops an unmappable root union and its subtree', () => {
    const mapping = mapMscLabels([
      mscSystem({ prim: 'Aab', sec: 'C', parent: 'X' }),
      mscSystem({ prim: 'Aa', sec: 'Ab', parent: 'Aab' }),
    ]);
    expect(mapping.has('Aab')).toBe(false);
    expect(mapping.has('Aa')).toBe(false);
    expect(mapping.get('C')).toBe('C');
  });
});

describe('buildMscLookup', () => {
  it('keys orbits, pair magnitudes and types on the mapped tokens', () => {
    const lk = buildMscLookup([
      mscSystem({ prim: 'A', sec: 'B', parent: '*' }),
      mscSystem({ prim: 'Aab', sec: 'Ac', parent: 'A' }),
      mscSystem({ prim: 'Aa', sec: 'Ab', parent: 'Aab', vmag1: 4.37, spt1: 'B3V', vmag2: 6.9 }),
    ], [mscOrbit({ syst: 'Aa,Ab' }), mscOrbit({ syst: 'A' })], []);
    expect(lk.orbitsByPair.has(mscPairKey('10000+0000', 'Aa1', 'Aa2'))).toBe(true);
    expect(lk.nOrbitsUnmapped).toBe(1);
    expect(lk.pairMags.get(mscPairKey('10000+0000', 'Aa1', 'Aa2'))).toEqual({ vmagPri: 4.37, vmagSec: 6.9 });
    expect(lk.spectByComp.get(componentKey('10000+0000', 'Aa1'))).toBe('B3V');
    expect(lk.spectByComp.has(componentKey('10000+0000', 'Aa2'))).toBe(false);
  });

  it('lets the components table beat a pair-side type', () => {
    const lk = buildMscLookup([mscSystem({ spt1: 'B3IV' })], [], [{ wdsId: '10000+0000', comp: 'A', spt: 'B3V', vmag: null }]);
    expect(lk.spectByComp.get(componentKey('10000+0000', 'A'))).toBe('B3V');
  });

  it('never types a compound side', () => {
    const lk = buildMscLookup([mscSystem({ prim: 'AB', sec: 'C', spt1: 'F7IV', spt2: 'A1V' })], [], []);
    expect(lk.spectByComp.has(componentKey('10000+0000', 'AB'))).toBe(false);
    expect(lk.spectByComp.get(componentKey('10000+0000', 'C'))).toBe('A1V');
  });
});

describe('MSC element checks', () => {
  it('reads a period in days or years and refuses the rest', () => {
    expect(mscPeriodDays(mscOrbit({ per: 2, perUnit: 'y' }))).toBe(730.5);
    expect(mscPeriodDays(mscOrbit({ per: 2, perUnit: 'd' }))).toBe(2);
    expect(mscPeriodDays(mscOrbit({ per: 2, perUnit: '' }))).toBeNull();
    expect(mscPeriodDays(mscOrbit({ per: 0, perUnit: 'd' }))).toBeNull();
  });

  it('reads t0 as a plausible year first, else a truncated JD, else nothing', () => {
    expect(mscT0Jd(2000)).toBe(J2000_JD);
    expect(mscT0Jd(40087.19)).toBe(40087.19 + TRUNCATED_JD_TO_JD_OFFSET);
    expect(mscT0Jd(9_000_000)).toBeNull();
    expect(mscT0Jd(null)).toBeNull();
  });

  it('is renderable with P, T, e and ω, or a circular fit without ω', () => {
    expect(mscRenderable(mscOrbit())).toBe(true);
    expect(mscRenderable(mscOrbit({ t0: null }))).toBe(false);
    expect(mscRenderable(mscOrbit({ longpDeg: null }))).toBe(false);
    expect(mscRenderable(mscOrbit({ longpDeg: null, e: 0 }))).toBe(true);
  });
});
