import { describe, expect, it } from 'vitest';

import { pair } from '../../../binaries/pair-fixture';
import type { CatalogRowIndexMap } from './catalog-row-index-map-pure';
import { distinctEnds, resolvePairs } from './pair-resolution-pure';

const A = 98630;
const B = 179304;
const BB = 321187;
const BA1 = 400000;

/** Castor: Ba carries A's blended source, so its own resolve lands on A; AB
 *  resolves B onto its synth record. */
const castor: CatalogRowIndexMap = {
  byGaia: { 10: A, 11: BB, 12: BA1 },
  byHip: {},
  bySynth: { 'synth-07346+3153-B': B },
};
const ab = pair('07346+3153-AB', { primaryGaia: '10', secondaryGaia: null });
const baBb = pair('07346+3153-Ba,Bb', { primaryGaia: '10', secondaryGaia: '11' });

describe('resolvePairs', () => {
  it('re-homes an inner primary onto its parent component slot, and keeps its own resolve', () => {
    const [, inner] = resolvePairs([ab, baBb], castor);
    expect(inner.own).toEqual({ primary: A, secondary: BB });
    expect(inner.rendered).toEqual({ primary: B, secondary: BB });
  });

  it('leaves an inner primary already on its parent slot', () => {
    const aaAb = pair('07346+3153-Aa,Ab', { primaryGaia: '10', secondaryGaia: '11' });
    expect(resolvePairs([ab, aaAb], castor)[1].rendered.primary).toBe(A);
  });

  it('leaves top-level pairs alone', () => {
    expect(resolvePairs([ab], castor)[0].rendered).toEqual({ primary: A, secondary: B });
  });

  it('a deeper nest inherits its parent’s re-homed slot, whatever the input order', () => {
    const ba1Ba2 = pair('07346+3153-Ba1,Ba2', { primaryGaia: '10', secondaryGaia: '12' });
    const resolved = resolvePairs([ba1Ba2, baBb, ab], castor);
    expect(resolved.map((r) => r.rendered.primary)).toEqual([B, B, A]);
  });

  it('re-homes onto nothing when the parent slot does not resolve', () => {
    const unresolvedB = pair('07346+3153-AB', { primaryGaia: '10', secondaryGaia: null });
    const [, inner] = resolvePairs([unresolvedB, baBb], { ...castor, bySynth: {} });
    expect(inner.rendered.primary).toBe(A);
  });

  it('an unresolved end is null, not a record index', () => {
    const [r] = resolvePairs([pair(undefined, { primaryGaia: '999' })], castor);
    expect(r.own).toEqual({ primary: null, secondary: null });
  });
});

describe('distinctEnds', () => {
  it('holds only for two resolved, different records', () => {
    expect(distinctEnds({ primary: 1, secondary: 2 })).toBe(true);
    expect(distinctEnds({ primary: 1, secondary: 1 })).toBe(false);
    expect(distinctEnds({ primary: null, secondary: 2 })).toBe(false);
    expect(distinctEnds({ primary: 1, secondary: null })).toBe(false);
  });
});
