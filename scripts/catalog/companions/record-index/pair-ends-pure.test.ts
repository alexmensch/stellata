import { describe, expect, it } from 'vitest';

import { parseCatalogPairEnds, serializeCatalogPairEnds } from './pair-ends-pure';

const SHA1 = 'da39a3ee5e6b4b0d3255bfef95601890afd80709';
const PAIRS = new Map([
  ['03082+4057-Aa,Ab', { primary: 300, secondary: 400 }],
  ['03082+4057-AB', { primary: 300, secondary: null }],
]);
const FILE = { multiplesSha1: SHA1, pairs: { '03082+4057-AB': [300, null] } };

describe('parseCatalogPairEnds', () => {
  it('reads back what the serializer writes', () => {
    expect(parseCatalogPairEnds(serializeCatalogPairEnds(SHA1, PAIRS))).toEqual({ multiplesSha1: SHA1, pairs: PAIRS });
  });

  it('throws on a missing section or a missing or malformed sha1', () => {
    expect(() => parseCatalogPairEnds(JSON.stringify({ multiplesSha1: SHA1 }))).toThrow(/pairs is missing/);
    expect(() => parseCatalogPairEnds(JSON.stringify({ ...FILE, multiplesSha1: undefined }))).toThrow(/multiplesSha1/);
    expect(() => parseCatalogPairEnds(JSON.stringify({ ...FILE, multiplesSha1: 'x' }))).toThrow(/multiplesSha1/);
  });

  it('throws on a cell that is not two record indices or nulls', () => {
    for (const cell of [[1], [1, 2, 3], [-1, 2], ['1', 2], 5]) {
      expect(() => parseCatalogPairEnds(JSON.stringify({ ...FILE, pairs: { 'X-AB': cell } })))
        .toThrow(/pairs\[X-AB\]/);
    }
  });
});
