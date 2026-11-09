import { describe, expect, it } from 'vitest';

import { rescueBlankComponents } from './blank-rescue-pure';
import { blankPair, orb6Entry, wdsPair } from './load-fixture';

describe('rescueBlankComponents', () => {
  const rescue = (pairs: ReturnType<typeof wdsPair>[], opts: { orb6?: ReturnType<typeof orb6Entry>[]; simbad?: string[]; donors?: ReturnType<typeof wdsPair>[] } = {}) =>
    rescueBlankComponents(pairs, opts.orb6 ?? [], new Set(opts.simbad ?? []), opts.donors ?? []);
  const orb6 = (wdsId: string, components: string) => orb6Entry({ wdsId, components, hip: 80763 });

  it('rescues on an ORB6 orbit and aligns a blank ORB6 row (Antares)', () => {
    const r = rescue([blankPair('16294-2626')], { orb6: [orb6('16294-2626', '')] });
    expect(r.outcomes).toEqual(['rescued']);
    expect(r.pairs[0].components).toBe('AB');
    expect(r.orb6[0].components).toBe('AB');
  });

  it('leaves a non-blank ORB6 row of the system as it is', () => {
    const r = rescue([blankPair('16294-2626')], { orb6: [orb6('16294-2626', 'Aa,Ab')] });
    expect(r.outcomes).toEqual(['rescued']);
    expect(r.orb6[0].components).toBe('Aa,Ab');
  });

  it('rescues on a SIMBAD cross-ID, and defers a row with neither', () => {
    expect(rescue([blankPair('20414+4517')], { simbad: ['20414+4517'] }).outcomes).toEqual(['rescued']);
    const deferred = rescue([blankPair('99999+9999')]);
    expect(deferred.outcomes).toEqual(['deferred']);
    expect(deferred.pairs[0].components).toBe('');
  });

  it('defers a row anchored only by position (Deneb)', () => {
    const positioned = { ...blankPair('20414+4517'), precise: { raDeg: 310.0, decDeg: 45.0 } };
    const r = rescue([positioned]);
    expect(r.outcomes).toEqual(['deferred']);
    expect(r.pairs[0].components).toBe('');
  });

  it('leaves a blank row alone when its own discoverer already enumerates AB', () => {
    const explicit = wdsPair({ wdsId: '16294-2626', components: 'AB' });
    const r = rescue([blankPair('16294-2626'), explicit], { orb6: [orb6('16294-2626', 'AB')] });
    expect(r.outcomes).toEqual(['enumerated']);
    expect(r.pairs[0].components).toBe('');
  });

  it('leaves an orphan donor row alone', () => {
    const donors = [wdsPair({ wdsId: '14296-6241', discoverer: 'RHD   1', components: 'Ca,Cb' })];
    const r = rescue([blankPair('14296-6241', 'RHD   1')], { orb6: [orb6('14296-6241', 'Ca,Cb')], donors });
    expect(r.outcomes).toEqual(['donor']);
    expect(r.pairs[0].components).toBe('');
  });

  it('promotes at most one AB row per system, whatever the discoverer', () => {
    const explicit = wdsPair({ wdsId: '16294-2626', components: 'AB' });
    expect(rescue([blankPair('16294-2626', 'BU    2'), explicit], { orb6: [orb6('16294-2626', 'AB')] }).outcomes)
      .toEqual(['enumerated']);
    const twice = rescue([blankPair('16294-2626', 'STF   1'), blankPair('16294-2626', 'BU    2')], { orb6: [orb6('16294-2626', '')] });
    expect(twice.outcomes).toEqual(['rescued', 'enumerated']);
    expect(twice.pairs.filter((p) => p.components === 'AB')).toHaveLength(1);
  });
});
