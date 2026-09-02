import { describe, expect, it } from 'vitest';

import {
  bayerDesignation,
  designationAtTier,
  displayNamesFromSearchIndex,
  formatGcvsDesignation,
  gouldDesignation,
  isApprovedName,
  ownDesignation,
  resolveDisplayNames,
  superscript,
  type DesignationSet,
  type DisplayNameInput,
} from './star-naming-pure';

const label = (
  inputs: readonly DisplayNameInput<string>[],
  key: string,
): string | undefined => resolveDisplayNames(inputs).get(key)?.label;

describe('rendering', () => {
  it('renders a Bayer designation from the glyph and its index', () => {
    expect(bayerDesignation('α', undefined, 'Cen')).toBe('α Cen');
    expect(bayerDesignation('α', 1, 'Cen')).toBe('α¹ Cen');
    // NEC's deepest index; the gate's "1-9" understates it by one.
    expect(bayerDesignation('ψ', 10, 'Aur')).toBe('ψ¹⁰ Aur');
    expect(superscript(10)).toBe('¹⁰');
  });

  it('renders the Latin overflow series as the bare letter', () => {
    expect(bayerDesignation('p', undefined, 'Eri')).toBe('p Eri');
    expect(bayerDesignation('A', 2, 'Aqr')).toBe('A² Aqr');
  });

  it("carries Serpens' Gould half, which is part of the designation", () => {
    expect(gouldDesignation(4, 'Cau', 'Ser')).toBe('4 G. Ser Cau');
    expect(gouldDesignation(268, undefined, 'Cet')).toBe('268 G. Cet');
  });

  it('strips the GCVS V-number padding only at the start', () => {
    expect(formatGcvsDesignation('V0645 Cen')).toBe('V645 Cen');
    expect(formatGcvsDesignation('LMC V0471')).toBe('LMC V0471');
    expect(formatGcvsDesignation('R CrB')).toBe('R CrB');
  });
});

describe('ownDesignation', () => {
  it('walks the ladder in order, first hit winning', () => {
    const full: DesignationSet = {
      iauName: 'Sirius', bayer: 'α', flamsteed: 9, gould: 5, gcvs: 'R CrB',
      hip: 32349, hd: 48915, hr: 2491, gl: 'GJ 244', dc: 'CMa',
    };
    expect(ownDesignation(full)).toEqual({ base: 'Sirius', tier: 'iau' });
    const { iauName, ...noName } = full;
    expect(ownDesignation(noName)).toEqual({ base: 'α CMa', tier: 'bayer' });
    const { bayer, ...noBayer } = noName;
    expect(ownDesignation(noBayer)).toEqual({ base: '9 CMa', tier: 'flamsteed' });
    const { flamsteed, ...noFlam } = noBayer;
    expect(ownDesignation(noFlam)).toEqual({ base: '5 G. CMa', tier: 'gould' });
    const { gould, ...noGould } = noFlam;
    expect(ownDesignation(noGould)).toEqual({ base: 'R CrB', tier: 'gcvs' });
    const { gcvs, ...noGcvs } = noGould;
    expect(ownDesignation(noGcvs)).toEqual({ base: 'HIP 32349', tier: 'catalogue' });
  });

  it('falls past the constellation-relative tiers with no dc to render against', () => {
    // A designation the wire carries no constellation for cannot be
    // rendered, so the ladder keeps walking rather than emitting a
    // half-designation.
    expect(ownDesignation({ bayer: 'α', flamsteed: 9, hip: 1 }))
      .toEqual({ base: 'HIP 1', tier: 'catalogue' });
  });

  it('carries no Gaia or SID tier — the runtime owns that last resort', () => {
    expect(ownDesignation({})).toBeNull();
  });

  it('marks the tiers an authority approved as a name', () => {
    expect(isApprovedName('iau')).toBe(true);
    expect(isApprovedName('eponym')).toBe(true);
    expect(isApprovedName('bayer')).toBe(false);
  });
});

describe('designationAtTier', () => {
  it('answers for one tier alone, ignoring what outranks it', () => {
    const set: DesignationSet = { iauName: 'Alula Australis', flamsteed: 53, dc: 'UMa' };
    expect(designationAtTier(set, 'iau')).toBe('Alula Australis');
    expect(designationAtTier(set, 'flamsteed')).toBe('53 UMa');
    expect(designationAtTier(set, 'bayer')).toBeNull();
  });
});

describe('component letters', () => {
  it('appends none to a name — the authority already said which star', () => {
    // Sirius B borrows; Sirius A wears the approved name bare.
    const inputs: DisplayNameInput<string>[] = [
      { key: 'a', set: { iauName: 'Sirius', hip: 32349 }, component: 'A', anchorKey: 'a' },
      { key: 'b', set: {}, component: 'B', anchorKey: 'a' },
    ];
    expect(label(inputs, 'a')).toBe('Sirius');
    expect(label(inputs, 'b')).toBe('Sirius B');
  });

  it('appends one where siblings own the same designation (θ¹ Ori)', () => {
    const inputs: DisplayNameInput<string>[] = ['Aa', 'B', 'C', 'D'].map((comp) => ({
      key: comp,
      set: { bayer: 'θ', bayerSup: 1, dc: 'Ori' },
      component: comp,
      anchorKey: 'Aa',
    }));
    expect(inputs.map((i) => label(inputs, i.key)))
      .toEqual(['θ¹ Ori Aa', 'θ¹ Ori B', 'θ¹ Ori C', 'θ¹ Ori D']);
  });

  it('appends none where the designation singles the star out (β² Sco)', () => {
    // β² Sco is WDS component C of the Acrab system, and its own Bayer
    // designation already names it alone — the letter would say nothing.
    const inputs: DisplayNameInput<string>[] = [
      {
        key: 'aa', set: { iauName: 'Acrab', bayer: 'β', bayerSup: 1, dc: 'Sco' },
        component: 'Aa', anchorKey: 'aa',
      },
      {
        key: 'c', set: { bayer: 'β', bayerSup: 2, dc: 'Sco' },
        component: 'C', anchorKey: 'aa',
      },
      { key: 'b', set: {}, component: 'B', anchorKey: 'aa' },
    ];
    expect(label(inputs, 'aa')).toBe('Acrab');
    expect(label(inputs, 'c')).toBe('β² Sco');
    expect(label(inputs, 'b')).toBe('Acrab B');
  });

  it('appends the one the AUTHORITY attributes, with no WDS letter to go on', () => {
    // NEC lists p Eri A and B against ONE Hipparcos number and separates
    // them only by HR and HD, so WDS's own lettering reaches just one of
    // the two records. The authority's attribution carries the other.
    const inputs: DisplayNameInput<string>[] = [
      {
        key: 'a', set: { bayer: 'p', dc: 'Eri', hd: 10360 },
        statedComponent: 'A', anchorKey: 'a',
      },
      {
        key: 'b', set: { bayer: 'p', dc: 'Eri', hd: 10361 },
        component: 'A', statedComponent: 'B', anchorKey: 'b',
      },
    ];
    expect(label(inputs, 'a')).toBe('p Eri A');
    expect(label(inputs, 'b')).toBe('p Eri B');
  });
});

describe('borrowing the system base', () => {
  it('takes the anchor designation over a bare catalogue number (σ² UMa C)', () => {
    const inputs: DisplayNameInput<string>[] = [
      { key: 'a', set: { bayer: 'σ', bayerSup: 2, dc: 'UMa', hip: 45038 }, component: 'A', anchorKey: 'a' },
      { key: 'c', set: { hip: 45064 }, component: 'C', anchorKey: 'a' },
    ];
    expect(label(inputs, 'a')).toBe('σ² UMa');
    expect(label(inputs, 'c')).toBe('σ² UMa C');
  });

  it('takes it over an identifier-shaped GCVS serial too (λ Oph B)', () => {
    const inputs: DisplayNameInput<string>[] = [
      { key: 'a', set: { iauName: 'Marfik', hip: 84012 }, component: 'A', anchorKey: 'a' },
      { key: 'b', set: { gcvs: 'NSV 07784' }, component: 'B', anchorKey: 'a' },
    ];
    expect(label(inputs, 'b')).toBe('Marfik B');
  });

  it('leaves a sky designation of its own alone, however high the anchor (θ¹ Tau)', () => {
    // θ¹ and θ² Tau are one WDS root whose anchor carries an approved name.
    // Borrowing would rename θ¹ Tau to "Chamukuy B".
    const inputs: DisplayNameInput<string>[] = [
      {
        key: 'a', set: { iauName: 'Chamukuy', bayer: 'θ', bayerSup: 2, dc: 'Tau' },
        component: 'A', anchorKey: 'a',
      },
      {
        key: 'b', set: { bayer: 'θ', bayerSup: 1, dc: 'Tau' },
        component: 'B', anchorKey: 'a',
      },
    ];
    expect(label(inputs, 'b')).toBe('θ¹ Tau');
  });

  it('borrows where the sky designation is the SYSTEM\'s (ξ UMa B)', () => {
    // Flamsteed 53 names ξ UMa, not its B component, so B reads as the
    // system's name plus its letter rather than claiming "53 UMa".
    const inputs: DisplayNameInput<string>[] = [
      {
        key: 'a', set: { iauName: 'Alula Australis', bayer: 'ξ', flamsteed: 53, dc: 'UMa' },
        component: 'A', anchorKey: 'a',
      },
      { key: 'b', set: { flamsteed: 53, dc: 'UMa', hd: 98230 }, component: 'B', anchorKey: 'a' },
    ];
    expect(label(inputs, 'b')).toBe('Alula Australis B');
  });

  it('trades nothing between two identifiers of one tier', () => {
    const inputs: DisplayNameInput<string>[] = [
      { key: 'a', set: { hip: 31720 }, component: 'A', anchorKey: 'a' },
      { key: 'b', set: { hip: 31722 }, component: 'B', anchorKey: 'a' },
    ];
    expect(label(inputs, 'b')).toBe('HIP 31722');
  });

  it('drops the anchor\'s own letter out of a borrowed base (Struve 2398 D)', () => {
    // AT-HYG prints "Struve 2398 A" for the A component, and appending D
    // to that reads "Struve 2398 A D".
    const inputs: DisplayNameInput<string>[] = [
      { key: 'a', set: { eponym: 'Struve 2398 A' }, component: 'A', anchorKey: 'a' },
      { key: 'd', set: {}, component: 'D', anchorKey: 'a' },
    ];
    expect(label(inputs, 'a')).toBe('Struve 2398 A');
    expect(label(inputs, 'd')).toBe('Struve 2398 D');
  });

  it('climbs no further than the anchor: a base-less anchor lends nothing', () => {
    const inputs: DisplayNameInput<string>[] = [
      { key: 'a', set: {}, component: 'A', anchorKey: 'a' },
      { key: 'b', set: {}, component: 'B', anchorKey: 'a' },
    ];
    expect(label(inputs, 'b')).toBeUndefined();
  });

  it('needs a letter to borrow with', () => {
    const inputs: DisplayNameInput<string>[] = [
      { key: 'a', set: { iauName: 'Sirius' } },
      { key: 'b', set: {}, anchorKey: 'a' },
    ];
    expect(label(inputs, 'b')).toBeUndefined();
  });
});

describe('displayNamesFromSearchIndex', () => {
  const CONS = [{ code: 'CMa' }, { code: 'Ori' }];

  it('reads the wire the build wrote, name tier included', () => {
    const composed = displayNamesFromSearchIndex([
      { i: 0, p: 'Sirius', b: 'α', c: 0, cl: 'A', cp: 0 },
      { i: 1, c: 0, cl: 'B', cp: 0 },
      { i: 2, b: 'θ', bx: 1, bc: 'C', c: 1, cl: 'C', cp: 2 },
    ], CONS);
    expect(composed.get(0)?.label).toBe('Sirius');
    expect(composed.get(1)).toMatchObject({ label: 'Sirius B', borrowed: true });
    expect(composed.get(2)).toMatchObject({ label: 'θ¹ Ori C', lettered: true });
  });

  it('renders against dc, never the positional constellation', () => {
    // ρ Aql sits in Delphinus and is ρ Aquilae permanently; reading the
    // positional index renames it ρ Del.
    const composed = displayNamesFromSearchIndex(
      [{ i: 0, b: 'ρ', c: 1, dc: 0 }], [{ code: 'Aql' }, { code: 'Del' }],
    );
    expect(composed.get(0)?.label).toBe('ρ Aql');
  });
});
