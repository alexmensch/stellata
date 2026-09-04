// The build's half of the composer: which tier reaches `proper`, what
// FLAG_HAS_NAME means, and the curated override's join.

import { describe, expect, it } from 'vitest';

import { FLAG_HAS_NAME, NO_CONSTELLATION_INDEX } from '../catalog-pure';
import type { ComponentDesignation } from '../companions/record-index/record-index';
import { assignDisplayNames, type DisplayNameSource } from './display-names';

const CONSTELLATIONS = [{ code: 'Ori' }, { code: 'Cep' }, { code: 'CMa' }];
const ORI = 0;
const CMA = 2;

function star(over: Partial<DisplayNameSource> = {}): DisplayNameSource {
  return {
    proper: null,
    iauName: null,
    eponym: null,
    bayer: null,
    bayerSup: null,
    bayerComponent: null,
    flam: null,
    gould: null,
    gouldHalf: null,
    gcvsName: null,
    hip: null,
    hd: null,
    hr: null,
    gl: null,
    conIndex: NO_CONSTELLATION_INDEX,
    desigConIndex: NO_CONSTELLATION_INDEX,
    flags: 0,
    ...over,
  };
}

const noComponents = new Map<number, ComponentDesignation>();

describe('assignDisplayNames', () => {
  it('writes only the NAME tiers into proper, and FLAG_HAS_NAME with them', () => {
    // catalog.bin's name table carries the authority tiers alone so first
    // paint has names; a record displaying a DESIGNATION carries none and
    // the runtime composes it off the search index.
    const stars = [
      star({ iauName: 'Sirius', hip: 32349 }),
      star({ bayer: 'θ', bayerSup: 1, desigConIndex: ORI, flags: FLAG_HAS_NAME }),
      star({ hip: 11767 }),
    ];
    const out = assignDisplayNames(stars, noComponents, CONSTELLATIONS, new Map(), [1, 2, 3]);

    expect(stars.map((s) => s.proper)).toEqual(['Sirius', null, null]);
    expect(stars.map((s) => (s.flags & FLAG_HAS_NAME) !== 0)).toEqual([true, false, false]);
    expect(out.counts.namingNameTable).toBe(1);
    expect(out.counts.namingTier).toMatchObject({ iau: 1, bayer: 1, catalogue: 1 });
    expect(out.labels.get(1)?.label).toBe('θ¹ Ori');
  });

  it('renders a designation against dc, never the positional constellation', () => {
    // ρ Aql sits in Delphinus and is ρ Aquilae permanently; the positional
    // index would rename it (docs/star-naming.md § 6).
    const stars = [star({ bayer: 'δ', conIndex: CMA, desigConIndex: 1 })];
    assignDisplayNames(stars, noComponents, CONSTELLATIONS, new Map(), [1]);
    expect(
      assignDisplayNames(stars, noComponents, CONSTELLATIONS, new Map(), [1])
        .labels.get(0)?.label,
    ).toBe('δ Cep');
  });

  it('falls back to the positional constellation where no dc is stated', () => {
    const stars = [star({ bayer: 'δ', conIndex: CMA })];
    const out = assignDisplayNames(stars, noComponents, CONSTELLATIONS, new Map(), [1]);
    expect(out.labels.get(0)?.label).toBe('δ CMa');
  });

  it('counts a record with nothing to display as unlabelled', () => {
    const stars = [star({ flags: FLAG_HAS_NAME })];
    const out = assignDisplayNames(stars, noComponents, CONSTELLATIONS, new Map(), [1]);
    expect(out.counts.namingUnlabelled).toBe(1);
    expect(stars[0].proper).toBeNull();
    expect(stars[0].flags & FLAG_HAS_NAME).toBe(0);
    expect(out.labels.has(0)).toBe(false);
  });

  it('applies a curated override above the authority name, keyed on SID', () => {
    const stars = [star({ iauName: 'Sirius', hip: 32349 })];
    const out = assignDisplayNames(
      stars, noComponents, CONSTELLATIONS, new Map([[77, 'Overridden']]), [77],
    );
    expect(stars[0].proper).toBe('Overridden');
    expect(out.counts.namingTier.override).toBe(1);
    expect(out.counts.namingOverrides).toBe(1);
  });

  it('fails the build on an override SID no record carries', () => {
    // The one tier no published source can be re-read to check, so an
    // unmatched row must not count as applied and display nothing.
    const stars = [star({ hip: 32349 })];
    expect(() => assignDisplayNames(
      stars, noComponents, CONSTELLATIONS, new Map([[404, 'Ghost']]), [77],
    )).toThrow(/SID\(s\) no record carries: 404/);
  });

  it('reports every label two records both compose', () => {
    // Injective given (naming anchor, component letter), so a survivor is
    // two catalogue entries claiming one designation — a data finding.
    const stars = [
      star({ gcvsName: 'NSV 01117' }),
      star({ gcvsName: 'NSV 01117' }),
      star({ hip: 1 }),
    ];
    const out = assignDisplayNames(stars, noComponents, CONSTELLATIONS, new Map(), [1, 2, 3]);
    expect([...out.duplicates]).toEqual([['NSV 01117', [0, 1]]]);
    expect(out.counts.namingDuplicateLabels).toBe(1);
    expect(out.counts.namingDuplicateRecords).toBe(2);
  });

  it('borrows the anchor base for a component with nothing of its own', () => {
    const stars = [star({ iauName: 'Sirius', hip: 32349 }), star()];
    const components = new Map<number, ComponentDesignation>([
      [0, { comp: 'A', primaryIdx: 0 }],
      [1, { comp: 'B', primaryIdx: 0 }],
    ]);
    const out = assignDisplayNames(stars, components, CONSTELLATIONS, new Map(), [1, 2]);
    expect(stars[0].proper).toBe('Sirius');
    expect(out.labels.get(1)?.label).toBe('Sirius B');
    expect(out.counts.namingBorrowed).toBe(1);
    // A borrowed label carries the ANCHOR's tier, so a component borrowing
    // an approved name reaches the name table too — which is why the table
    // holds more records than the authority names outright.
    expect(stars[1].proper).toBe('Sirius B');
    expect(stars.map((s) => (s.flags & FLAG_HAS_NAME) !== 0)).toEqual([true, true]);
    expect(out.counts.namingNameTable).toBe(2);
  });

  it('keeps a borrowed DESIGNATION base out of the name table', () => {
    // The same borrow off a Bayer anchor composes at runtime instead: only
    // the NAME tiers reach catalog.bin.
    const stars = [star({ bayer: 'θ', bayerSup: 1, desigConIndex: ORI }), star()];
    const components = new Map<number, ComponentDesignation>([
      [1, { comp: 'C', primaryIdx: 0 }],
    ]);
    const out = assignDisplayNames(stars, components, CONSTELLATIONS, new Map(), [1, 2]);
    expect(out.labels.get(1)?.label).toBe('θ¹ Ori C');
    expect(stars.map((s) => s.proper)).toEqual([null, null]);
    expect(out.counts.namingNameTable).toBe(0);
  });
});
