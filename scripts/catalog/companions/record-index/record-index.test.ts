import { describe, it, expect } from 'vitest';

import { FLAG_BINARY_PRIMARY } from '../../catalog-pure';
import { makeStar as makeStarWithDefaults } from '../../parse/star-fixture';
import type { Star } from '../../parse/stars-parse';
import type { MultiplesTsvRow } from '../companion-promotion';
import { multiplesRow } from '../multiples-fixture';
import {
  buildCatalogRowIndexMap,
  buildComponentDesignations,
  wingRenderablePrimaries,
} from './record-index';

function makeStar(overrides: Partial<Star> = {}): Star {
  return makeStarWithDefaults({
    absmag: 5.0, ci: 0.65, spectClass: 4, lumClass: 2, ...overrides,
  });
}

describe('buildCatalogRowIndexMap', () => {
  it('indexes by gaia and hip, first occurrence wins on collision', () => {
    const stars: Star[] = [
      makeStar({ gaiaSourceId: 'g1', hip: 100 }),
      makeStar({ gaiaSourceId: 'g2', hip: 100 }),  // hip collision
      makeStar({ gaiaSourceId: null, hip: 101 }),
    ];
    const map = buildCatalogRowIndexMap(stars);
    expect(map.byGaia.g1).toBe(0);
    expect(map.byGaia.g2).toBe(1);
    expect(map.byHip['100']).toBe(0);  // first occurrence
    expect(map.byHip['101']).toBe(2);
  });

  it('omits records with no gaia and no hip', () => {
    const stars: Star[] = [makeStar(), makeStar({ gaiaSourceId: 'g1' })];
    const map = buildCatalogRowIndexMap(stars);
    expect(Object.keys(map.byGaia)).toEqual(['g1']);
    expect(Object.keys(map.byHip)).toHaveLength(0);
    expect(Object.keys(map.bySynth)).toHaveLength(0);
  });

  it('indexes synthetic-ID records into bySynth', () => {
    const stars: Star[] = [
      makeStar({ gaiaSourceId: 'g1', hip: 100 }),
      makeStar({ syntheticId: 'synth-03082+4057-Ab' }),
      makeStar({ syntheticId: 'synth-03082+4057-Aa2' }),
    ];
    const map = buildCatalogRowIndexMap(stars);
    expect(map.bySynth['synth-03082+4057-Ab']).toBe(1);
    expect(map.bySynth['synth-03082+4057-Aa2']).toBe(2);
    // Synthetic-only records carry no gaia/hip key.
    expect(Object.keys(map.byGaia)).toEqual(['g1']);
    expect(Object.keys(map.byHip)).toEqual(['100']);
  });
});

describe('wingRenderablePrimaries', () => {
  const wing = (rows: MultiplesTsvRow[], stars: Star[]) =>
    wingRenderablePrimaries(rows, stars, buildCatalogRowIndexMap(stars)).winged;
  const isWinged = (s: Star) => (s.flags & FLAG_BINARY_PRIMARY) !== 0;

  it('wings the brightest member of a physical pair with a distinct companion', () => {
    const a = makeStar({ hip: 100, absmag: 1.0 });
    const b = makeStar({ hip: 200, absmag: 4.0 });
    const rows = [
      multiplesRow({ systemId: 'W1-AB', comp: 'A', hip: 100, orbitRole: 'primary' }),
      multiplesRow({ systemId: 'W1-AB', comp: 'B', hip: 200, orbitRole: 'secondary' }),
    ];
    expect(wing(rows, [a, b])).toBe(1);
    expect(isWinged(a)).toBe(true);
    expect(isWinged(b)).toBe(false);
  });

  it('adds exactly one glyph per hierarchical system, on the system anchor', () => {
    const a = makeStar({ hip: 100, absmag: 1.0 });
    const b = makeStar({ hip: 200, absmag: 4.0 });
    const c = makeStar({ hip: 300, absmag: 3.0 });
    const rows = [
      multiplesRow({ systemId: 'W1-AB', comp: 'A', hip: 100, orbitRole: 'primary' }),
      multiplesRow({ systemId: 'W1-AB', comp: 'B', hip: 200, orbitRole: 'secondary' }),
      multiplesRow({ systemId: 'W1-AC', comp: 'A', hip: 100, orbitRole: 'primary' }),
      multiplesRow({ systemId: 'W1-AC', comp: 'C', hip: 300, orbitRole: 'secondary' }),
    ];
    expect(wing(rows, [a, b, c])).toBe(1);
    expect(isWinged(a)).toBe(true);
    expect(isWinged(b)).toBe(false);
    expect(isWinged(c)).toBe(false);
  });

  it('skips a system that a prior pass already flagged (no second glyph)', () => {
    const a = makeStar({ hip: 100, absmag: 1.0 });
    const b = makeStar({ hip: 200, absmag: 4.0, flags: FLAG_BINARY_PRIMARY });
    const rows = [
      multiplesRow({ systemId: 'W1-AB', comp: 'A', hip: 100, orbitRole: 'primary' }),
      multiplesRow({ systemId: 'W1-AB', comp: 'B', hip: 200, orbitRole: 'secondary' }),
    ];
    expect(wing(rows, [a, b])).toBe(0);
    expect(isWinged(a)).toBe(false);
  });

  it('resolves a blended secondary through its synth slot (id-first collides on the primary)', () => {
    // Aa and Ab share the primary's Gaia source; promotion minted a synth
    // record for Ab. id-first resolve lands on Aa, the synth retry recovers
    // the distinct companion.
    const aa = makeStar({ hip: 100, gaiaSourceId: 'g5', absmag: 1.0 });
    const ab = makeStar({ syntheticId: 'synth-W1-Ab', absmag: 12.0 });
    const rows = [
      multiplesRow({ systemId: 'W1-Aa,Ab', comp: 'Aa', hip: 100, gaiaSourceId: 'g5', orbitRole: 'primary' }),
      multiplesRow({ systemId: 'W1-Aa,Ab', comp: 'Ab', hip: 100, gaiaSourceId: 'g5', orbitRole: 'secondary' }),
    ];
    expect(wing(rows, [aa, ab])).toBe(1);
    expect(isWinged(aa)).toBe(true);
    expect(isWinged(ab)).toBe(false);
  });

  it('canonicalises a WDS-truncated digit secondary to its synth slot', () => {
    // Stage 6 emits comp="2" for the secondary side of an "Aa1,2" pair;
    // the synth key is minted from the canonical "Aa2".
    const aa1 = makeStar({ hip: 100, absmag: 1.0 });
    const aa2 = makeStar({ syntheticId: 'synth-W1-Aa2', absmag: 8.0 });
    const rows = [
      multiplesRow({ systemId: 'W1-Aa1,2', comp: 'Aa1', hip: 100, orbitRole: 'primary' }),
      multiplesRow({ systemId: 'W1-Aa1,2', comp: '2', hip: 100, orbitRole: 'secondary' }),
    ];
    expect(wing(rows, [aa1, aa2])).toBe(1);
    expect(isWinged(aa1)).toBe(true);
  });

  it('re-homes a blended non-anchor primary through its synth slot (secondary stays on the anchor)', () => {
    // Castor BC pattern: the pair's primary (Ca) carries the system anchor's
    // gaia, so its id-first resolve lands on the anchor; its own synth slot is
    // the true companion end. The secondary (Cb) blends onto the anchor too but
    // was never promoted (no synth). Without the primary synth retry the pair
    // reads pri == sec == anchor and the system is wrongly left unwinged.
    const anchor = makeStar({ hip: 100, gaiaSourceId: 'g5', absmag: 1.0 });
    const caSynth = makeStar({ syntheticId: 'synth-W1-Ca', absmag: 5.0 });
    const rows = [
      multiplesRow({ systemId: 'W1-Ca,Cb', comp: 'Ca', hip: 100, gaiaSourceId: 'g5', orbitRole: 'primary' }),
      multiplesRow({ systemId: 'W1-Ca,Cb', comp: 'Cb', hip: 100, gaiaSourceId: 'g5', orbitRole: 'secondary' }),
    ];
    expect(wing(rows, [anchor, caSynth])).toBe(1);
    expect(isWinged(anchor)).toBe(true);
    expect(isWinged(caSynth)).toBe(false);
  });

  it('leaves a degenerate pair (secondary collapses onto the primary, no synth slot) unwinged', () => {
    const aa = makeStar({ hip: 100, gaiaSourceId: 'g5', absmag: 1.0 });
    const rows = [
      multiplesRow({ systemId: 'W1-Aa,Ab', comp: 'Aa', hip: 100, gaiaSourceId: 'g5', orbitRole: 'primary' }),
      multiplesRow({ systemId: 'W1-Aa,Ab', comp: 'Ab', hip: 100, gaiaSourceId: 'g5', orbitRole: 'secondary' }),
    ];
    expect(wing(rows, [aa])).toBe(0);
    expect(isWinged(aa)).toBe(false);
  });

  it('ignores standalone rows (not a side of a rendered pair)', () => {
    const a = makeStar({ hip: 100, absmag: 1.0 });
    const rows = [
      multiplesRow({ systemId: 'W1-_A', comp: 'A', hip: 100, orbitRole: 'standalone' }),
    ];
    expect(wing(rows, [a])).toBe(0);
    expect(isWinged(a)).toBe(false);
  });
});

describe('buildComponentDesignations', () => {
  const designate = (rows: MultiplesTsvRow[], stars: Star[]) =>
    buildComponentDesignations(rows, buildCatalogRowIndexMap(stars));

  it('maps every component (including the primary) to the primary as base', () => {
    // α Cen shape: A (the Bayer-bearing primary) + B resolve by HIP, C by
    // Gaia; A recurs across the AB and AC rows and dedups to one designation.
    const a = makeStar({ hip: 71683 });
    const b = makeStar({ hip: 71681 });
    const c = makeStar({ hip: 70890, gaiaSourceId: '5853498713190525696' });
    const rows = [
      multiplesRow({ systemId: 'W-AB', comp: 'A', hip: 71683, orbitRole: 'primary' }),
      multiplesRow({ systemId: 'W-AB', comp: 'B', hip: 71681, orbitRole: 'secondary' }),
      multiplesRow({ systemId: 'W-AC', comp: 'A', hip: 71683, orbitRole: 'primary' }),
      multiplesRow({
        systemId: 'W-AC', comp: 'C', hip: 70890,
        gaiaSourceId: '5853498713190525696', orbitRole: 'secondary',
      }),
    ];
    const m = designate(rows, [a, b, c]);
    expect(m.get(0)).toEqual({ comp: 'A', primaryIdx: 0 });
    expect(m.get(1)).toEqual({ comp: 'B', primaryIdx: 0 });
    expect(m.get(2)).toEqual({ comp: 'C', primaryIdx: 0 });
  });

  it('resolves a blended secondary through its synth slot', () => {
    const aa = makeStar({ hip: 100, gaiaSourceId: 'g5' });
    const ab = makeStar({ syntheticId: 'synth-W1-Ab' });
    const rows = [
      multiplesRow({ systemId: 'W1-Aa,Ab', comp: 'Aa', hip: 100, gaiaSourceId: 'g5', orbitRole: 'primary' }),
      multiplesRow({ systemId: 'W1-Aa,Ab', comp: 'Ab', hip: 100, gaiaSourceId: 'g5', orbitRole: 'secondary' }),
    ];
    const m = designate(rows, [aa, ab]);
    expect(m.get(1)).toEqual({ comp: 'Ab', primaryIdx: 0 });
  });

  it('omits a secondary that collapses onto the primary (no distinct record)', () => {
    const aa = makeStar({ hip: 100, gaiaSourceId: 'g5' });
    const rows = [
      multiplesRow({ systemId: 'W1-Aa,Ab', comp: 'Aa', hip: 100, gaiaSourceId: 'g5', orbitRole: 'primary' }),
      multiplesRow({ systemId: 'W1-Aa,Ab', comp: 'Ab', hip: 100, gaiaSourceId: 'g5', orbitRole: 'secondary' }),
    ];
    const m = designate(rows, [aa]);
    expect(m.get(0)).toEqual({ comp: 'Aa', primaryIdx: 0 });
    expect(m.size).toBe(1);
  });

  it('skips a system whose primary does not resolve', () => {
    const b = makeStar({ hip: 200 });
    const rows = [
      multiplesRow({ systemId: 'W1-AB', comp: 'A', hip: 100, orbitRole: 'primary' }),
      multiplesRow({ systemId: 'W1-AB', comp: 'B', hip: 200, orbitRole: 'secondary' }),
    ];
    expect(designate(rows, [b]).size).toBe(0);
  });
});
