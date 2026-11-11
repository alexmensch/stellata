import { describe, expect, it } from 'vitest';

import { DEG_TO_RAD } from '../../../src/astro-core/astronomy-constants';
import { wdsPair } from '../../wds/wds-fixture';
import { componentKey } from '../component-tokens-pure';
import { mscPairKey, type MscLookup, type MscPairMags } from '../load/msc-pure';
import type { OpticalVia } from '../optical/optical-tiers-pure';
import type { DecomposedPair } from '../resolve/components-pure';
import { decomposed } from '../resolve/resolve-fixture';
import { addSiblingEdge, computeAnchorOffsets, photocentreOffsets, type AnchorOffset, type SiblingAdj } from './anchor-offsets-pure';

const W = 'WDS-1';
type Spec = readonly [components: string, rho: number | null, theta: number | null, kept: boolean];
type Mags = readonly [number | null, number | null];

function msc(pairMags: Record<string, MscPairMags> = {}): MscLookup {
  return {
    orbitsByPair: new Map(), spectByComp: new Map(), nOrbitsUnmapped: 0,
    pairMags: new Map(Object.entries(pairMags).map(([k, v]) => [k as ReturnType<typeof mscPairKey>, v])),
  };
}

function system(specs: readonly Spec[], mags: Record<string, Mags> = {}, wdsId = W) {
  const pairs: DecomposedPair[] = [];
  const optical = new Map<DecomposedPair, OpticalVia>();
  for (const [components, rho, theta, kept] of specs) {
    const [magPri, magSec] = mags[components] ?? [4.0, 6.0];
    const p = decomposed(wdsPair({ wdsId, components, rhoLast: rho, thetaLast: theta, magPri, magSec }), {
      primary: { resolveVia: 'unresolved' }, secondary: { resolveVia: 'unresolved' },
    });
    pairs.push(p);
    optical.set(p, kept ? 'wds_notes_kept' : 'wds_notes_rejected');
  }
  return { pairs, optical };
}

function offsets(specs: readonly Spec[], mags: Record<string, Mags> = {}, lookup = msc()) {
  const { pairs, optical } = system(specs, mags);
  return computeAnchorOffsets(pairs, optical, lookup).offsets;
}

const at = (out: ReadonlyMap<string, AnchorOffset>, tok: string): AnchorOffset => out.get(componentKey(W, tok))!;

function expectOffsetEN(out: ReadonlyMap<string, AnchorOffset>, tok: string, east: number, north: number): void {
  const { sepArcsec, paDeg } = at(out, tok);
  expect(sepArcsec * Math.sin(paDeg * DEG_TO_RAD)).toBeCloseTo(east, 6);
  expect(sepArcsec * Math.cos(paDeg * DEG_TO_RAD)).toBeCloseTo(north, 6);
}

function expectSepPa(out: ReadonlyMap<string, AnchorOffset>, tok: string, sep: number, pa: number): void {
  expect(at(out, tok).sepArcsec).toBeCloseTo(sep, 7);
  expect(at(out, tok).paDeg).toBeCloseTo(pa, 7);
}

describe('computeAnchorOffsets', () => {
  it('gives a kept pair\'s secondary its direct offset, and the anchor none', () => {
    const out = offsets([['AB', 5.0, 90.0, true]]);
    expectSepPa(out, 'B', 5.0, 90.0);
    expect(out.has(componentKey(W, 'A'))).toBe(false);
  });

  it('composes a chain through an intermediate letter', () => {
    expectSepPa(offsets([['AB', 5.0, 90.0, true], ['BC', 5.0, 90.0, true]]), 'C', 10.0, 90.0);
  });

  it('reaches through a rejected row what the kept graph misses (Acrux)', () => {
    expectSepPa(offsets([['AC', 90.0, 202.0, true], ['AB', 3.5, 114.0, false]]), 'B', 3.5, 114.0);
  });

  it('prefers a direct rejected edge over a kept chain that cancels to zero (Acrux)', () => {
    const out = offsets([['AC', 89.0, 203.0, true], ['BC', 89.0, 203.0, true], ['AB', 3.5, 111.0, false]]);
    expectSepPa(out, 'B', 3.5, 111.0);
  });

  it('prefers kept geometry over rejected for one component', () => {
    expectSepPa(offsets([['AB', 5.0, 90.0, true], ['AB', 8.0, 45.0, false]]), 'B', 5.0, 90.0);
  });

  it('lends a compound row\'s vector to its letters (ο And)', () => {
    const out = offsets([['A,BC', 0.5, 299.0, true]]);
    for (const tok of ['B', 'C']) expectSepPa(out, tok, 0.5, 299.0);
  });

  it('prefers a measured edge over the compound proxy', () => {
    const out = offsets([['A,BC', 80.0, 100.0, true], ['AB', 5.0, 90.0, true]]);
    expectSepPa(out, 'B', 5.0, 90.0);
    expectSepPa(out, 'C', 80.0, 100.0);
  });

  it('leaves a disconnected component out', () => {
    const out = offsets([['AB', 5.0, 90.0, true], ['CD', 3.0, 10.0, true]]);
    expect([out.has(componentKey(W, 'B')), out.has(componentKey(W, 'C')), out.has(componentKey(W, 'D'))]).toEqual([true, false, false]);
  });

  it('anchors on the most canonical kept primary', () => {
    const out = offsets([['BC', 5.0, 90.0, true], ['CD', 5.0, 90.0, true]]);
    expect(out.has(componentKey(W, 'B'))).toBe(false);
    expect(at(out, 'C').sepArcsec).toBeCloseTo(5.0, 7);
    expect(at(out, 'D').sepArcsec).toBeCloseTo(10.0, 7);
  });

  it('anchors on Aa over B, as promotion does', () => {
    const out = offsets([['Aa,Ab', 1.0, 0.0, true], ['BC', 5.0, 90.0, true], ['Aa,B', 20.0, 90.0, true]]);
    expect(out.has(componentKey(W, 'Aa'))).toBe(false);
    expect(at(out, 'B').sepArcsec).toBeCloseTo(20.0, 7);
    expect(at(out, 'C').sepArcsec).toBeCloseTo(25.0, 7);
  });

  it('adds no edge for a sub-resolution row', () => {
    const out = offsets([['AB', 5.0, 90.0, true], ['Ba,Bb', 0.0, null, true]]);
    expect([out.has(componentKey(W, 'Ba')), out.has(componentKey(W, 'Bb'))]).toEqual([false, false]);
  });

  it('writes a component reached only at zero as zero', () => {
    const out = offsets([['Aa,Ab', 0.0, null, true], ['AE', 100.0, 90.0, false]], { 'Aa,Ab': [4.0, 6.0] });
    expect(at(out, 'A')).toEqual({ sepArcsec: 0, paDeg: 0 });
    expectOffsetEN(out, 'E', 100.0, 0.0);
  });

  it('reaches an outer star from a sub-letter anchor through the parent\'s photocentre (15 Mon)', () => {
    const beta = 1.0 / (1.0 + 10.0 ** (0.4 * 2.0));
    expectOffsetEN(offsets([['Aa,Ab', 1.0, 0.0, true], ['AE', 100.0, 90.0, false]]), 'E', 100.0, beta);
  });

  it('puts the parent on the anchor when a sibling\'s light is unmeasured', () => {
    const out = offsets([['Aa,Ab', 1.0, 0.0, true], ['AE', 100.0, 90.0, false]], { 'Aa,Ab': [4.0, null] });
    expectOffsetEN(out, 'E', 100.0, 0.0);
  });

  it('leaves sub-letters below a parent anchor unreached', () => {
    const out = offsets([['AB', 10.0, 90.0, true], ['Aa,Ab', 1.0, 0.0, true], ['Ba,Bb', 1.0, 0.0, true]]);
    for (const tok of ['Aa', 'Ab', 'Ba', 'Bb']) expect(out.has(componentKey(W, tok))).toBe(false);
  });

  it('links an anchor with no sibling row at zero length', () => {
    expectOffsetEN(offsets([['Aa,B', 20.0, 90.0, true], ['AE', 100.0, 0.0, false]]), 'E', 0.0, 100.0);
  });

  it('chains the link through every ancestor', () => {
    const out = offsets(
      [['Aa1,Aa2', 0.5, 0.0, true], ['Aa,Ab', 2.0, 0.0, false], ['AE', 100.0, 90.0, false]],
      { 'Aa1,Aa2': [4.0, 4.0], 'Aa,Ab': [4.0, 4.0] },
    );
    expectOffsetEN(out, 'E', 100.0, 0.25 + 1.0);
  });

  it('places nothing from a sibling row with ρ but no θ', () => {
    const out = offsets([['Aa,Ab', 1.0, null, true], ['AE', 100.0, 90.0, false]]);
    expectOffsetEN(out, 'E', 100.0, 0.0);
    expect(out.has(componentKey(W, 'Ab'))).toBe(false);
  });

  it('places nothing from a sibling row wider than the WDS field', () => {
    const out = offsets(
      [['Aa,Ab', null, 0.0, true], ['Aa,Ac', 1.0, 0.0, false], ['AE', 100.0, 90.0, false]],
      { 'Aa,Ab': [4.0, 4.0], 'Aa,Ac': [4.0, 4.0] },
    );
    expectOffsetEN(out, 'E', 100.0, 0.5);
  });

  it('weights the photocentre by the MSC\'s magnitudes when WDS prints none', () => {
    const out = offsets(
      [['Aa,Ab', 1.0, 0.0, true], ['AE', 100.0, 90.0, false]],
      { 'Aa,Ab': [null, null] },
      msc({ [mscPairKey(W, 'Aa', 'Ab')]: { vmagPri: 4.0, vmagSec: 4.0 } }),
    );
    expectOffsetEN(out, 'E', 100.0, 0.5);
  });

  it('emits nothing for a system with no kept pair', () => {
    expect(offsets([['AB', 5.0, 90.0, false]]).size).toBe(0);
  });

  it('records the letter each system chains from', () => {
    const one = system([['Aa,Ab', 1.0, 0.0, true], ['BC', 1.0, 0.0, true]]);
    const two = system([['AB', 1.0, 0.0, false]], {}, 'WDS-2');
    const result = computeAnchorOffsets([...one.pairs, ...two.pairs], new Map([...one.optical, ...two.optical]), msc());
    expect(result.anchorBySystem).toEqual(new Map([[W, 'Aa']]));
  });
});

function siblings(edges: readonly (readonly [string, string, number, number, number | null])[]): SiblingAdj {
  const adj: SiblingAdj = new Map();
  for (const [a, b, eastArcsec, northArcsec, dmag] of edges) addSiblingEdge(adj, a, b, { eastArcsec, northArcsec, dmag, epoch: 2020 });
  return adj;
}

describe('photocentreOffsets', () => {
  it('weights two siblings by their magnitude difference', () => {
    const out = photocentreOffsets(siblings([['Aa', 'Ab', 0.0, 1.0, 2.5]]));
    const beta = 1.0 / (1.0 + 10.0);
    expect(out.get('Aa')!.northArcsec).toBeCloseTo(beta, 7);
    expect(out.get('Ab')!.northArcsec).toBeCloseTo(beta - 1.0, 7);
    expect(out.get('Aa')!.eastArcsec).toBeCloseTo(0.0, 7);
  });

  it('gives three siblings one photocentre', () => {
    const out = photocentreOffsets(siblings([['Aa', 'Ab', 1.0, 0.0, 0.0], ['Aa', 'Ac', 0.0, 1.0, 0.0]]));
    const third = 1.0 / 3.0;
    const expected = { Aa: [third, third], Ab: [third - 1, third], Ac: [third, third - 1] };
    for (const [t, [e, n]] of Object.entries(expected)) {
      expect(out.get(t)!.eastArcsec).toBeCloseTo(e, 9);
      expect(out.get(t)!.northArcsec).toBeCloseTo(n, 9);
    }
  });

  it('gives unmeasured light no weight', () => {
    const out = photocentreOffsets(siblings([['Aa', 'Ab', 1.0, 0.0, null], ['Aa', 'Ac', 0.0, 1.0, 0.0]]));
    expect(out.get('Aa')!.eastArcsec).toBeCloseTo(0.0, 7);
    expect(out.get('Aa')!.northArcsec).toBeCloseTo(0.5, 7);
    expect(out.get('Ab')!.eastArcsec).toBeCloseTo(-1.0, 7);
  });

  it('sets weights from measured ratios whatever the walk order', () => {
    const out = photocentreOffsets(siblings([
      ['Aa', 'Ab', 1.0, 0.0, null], ['Aa', 'Ac', 0.0, 1.0, 0.0], ['Ab', 'Ac', -1.0, 1.0, 0.0],
    ]));
    expect(out.get('Aa')!.eastArcsec).toBeCloseTo(1 / 3, 7);
    expect(out.get('Aa')!.northArcsec).toBeCloseTo(1 / 3, 7);
  });

  it('composes a flux ratio along a chain', () => {
    const out = photocentreOffsets(siblings([['Ba', 'Bb', 1.0, 0.0, 0.0], ['Bb', 'Bc', 1.0, 0.0, 0.0]]));
    expect(out.get('Ba')!.eastArcsec).toBeCloseTo(1.0, 7);
    expect(out.get('Bc')!.eastArcsec).toBeCloseTo(-1.0, 7);
  });
});
