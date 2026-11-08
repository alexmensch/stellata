import { describe, expect, it } from 'vitest';

import { discovererKey } from '../component-tokens-pure';
import { mscOrbit, orb6Entry, wdsPair } from './load-fixture';
import { mscPairKey, type MscLookup, type MscOrbitRow } from './msc-pure';
import {
  SYNTH_MSC_DISCOVERER, applyOrb6ComponentOverrides, synthesizeMscInnerPairs, synthesizeOrb6OrphanPairs,
} from './subdivide-pure';

const orphan = (over: Parameters<typeof orb6Entry>[0] = {}) => orb6Entry({
  wdsId: '00490+1656', discoverer: '64 Psc', components: 'Aa,Ab', grade: 8, precise: { raDeg: 12.25, decDeg: 16.94 }, ...over,
});

describe('applyOrb6ComponentOverrides', () => {
  it('stamps curated letters on the keyed row only', () => {
    const target = orb6Entry({ wdsId: '07346+3153', discoverer: 'YY Gem', components: '', grade: 7 });
    const untouched = orb6Entry({ grade: 3 });
    const { entries, outcomes } = applyOrb6ComponentOverrides(
      [target, untouched], new Map([[discovererKey('07346+3153', 'YY Gem'), 'Ca,Cb']]),
    );
    expect(outcomes).toEqual(['applied', 'unchanged']);
    expect(entries.map((e) => e.components)).toEqual(['Ca,Cb', 'AB']);
    expect(target.components).toBe('');
  });
});

describe('synthesizeOrb6OrphanPairs', () => {
  it('synthesizes a sub-resolution pair for an orbit WDS has no row for', () => {
    const [p, ...rest] = synthesizeOrb6OrphanPairs([wdsPair({ wdsId: '00490+1656', components: 'AB' })], [orphan()]);
    expect(rest).toEqual([]);
    expect(p).toMatchObject({ wdsId: '00490+1656', components: 'Aa,Ab', rhoLast: 0, magPri: null, precise: { raDeg: 12.25 } });
  });

  it('skips a pair WDS has and ORB6 misalignment garbage', () => {
    const entries = ['Aa,Ab', '95', 'a,Ab', 'A,BC', ''].map((components) => orphan({ wdsId: 'W1', components }));
    expect(synthesizeOrb6OrphanPairs([wdsPair({ wdsId: 'W1', components: 'Aa,Ab' })], entries)).toEqual([]);
  });

  it('synthesizes once for several fits, and accepts the truncated secondary form', () => {
    expect(synthesizeOrb6OrphanPairs([], [orphan({ grade: 9 }), orphan({ grade: 8 })])).toHaveLength(1);
    expect(synthesizeOrb6OrphanPairs([], [orphan({ components: 'Aa1,2' })])[0].components).toBe('Aa1,2');
  });

  it('takes geometry from a blank-components row under the same discoverer', () => {
    const donor = wdsPair({
      wdsId: '00335+4006', discoverer: 'HO    3', components: '', rhoLast: 0.3, thetaLast: 120, magPri: 4.4, magSec: 7.2,
      dateLast: 2019, precise: { raDeg: 8.4, decDeg: 40.1 },
    });
    const [p] = synthesizeOrb6OrphanPairs([donor], [orphan({ wdsId: '00335+4006', discoverer: 'HO    3', precise: null })]);
    expect(p).toMatchObject({ rhoLast: 0.3, magPri: 4.4, dateLast: 2019, precise: { raDeg: 8.4 } });
  });
});

describe('synthesizeMscInnerPairs', () => {
  const lookup = (wdsId = '10000+0000', tokens: [string, string] = ['Aa', 'Ab'], rows: MscOrbitRow[] = [mscOrbit()]): MscLookup => ({
    orbitsByPair: new Map([[mscPairKey(wdsId, ...tokens), { wdsId, primary: tokens[0], secondary: tokens[1], rows }]]),
    pairMags: new Map(), spectByComp: new Map(), nOrbitsUnmapped: 0,
  });
  const system = [wdsPair({ wdsId: '10000+0000', components: 'AB' })];

  it('synthesizes an anchored sub-pair the system lacks', () => {
    const { pairs, outcomes } = synthesizeMscInnerPairs(system, lookup());
    expect(outcomes).toEqual(['synthesized']);
    expect(pairs[0]).toMatchObject({
      wdsId: '10000+0000', components: 'Aa,Ab', discoverer: SYNTH_MSC_DISCOVERER, rhoLast: 0, precise: { raDeg: 100 },
    });
  });

  it.each([
    [lookup('99999+9999'), 'skipped_unknown_system'],
    [lookup(undefined, ['A', 'BC']), 'skipped_token_shape'],
    [lookup(undefined, undefined, [mscOrbit({ t0: null })]), 'skipped_incomplete_elements'],
    [lookup(undefined, ['A', 'B']), 'skipped_pair_exists'],
    [lookup(undefined, ['Ca', 'Cb']), 'skipped_unanchored'],
  ] as const)('skips with %#: %s', (lk, outcome) => {
    expect(synthesizeMscInnerPairs(system, lk)).toEqual({ pairs: [], outcomes: [outcome] });
  });

  it('skips when a child token already exists', () => {
    const withChild = [...system, wdsPair({ wdsId: '10000+0000', components: 'Aa,B' })];
    expect(synthesizeMscInnerPairs(withChild, lookup()).outcomes).toEqual(['skipped_children_exist']);
  });
});
