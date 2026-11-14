import { describe, expect, it } from 'vitest';

import {
  parseCatalogRowIndexMap, resolveMultiplesIdx, serializeCatalogRowIndexSidecar, synthSlotIdx,
  type CatalogRowIndexMap,
} from './catalog-row-index-map-pure';

const MAP: CatalogRowIndexMap = {
  byGaia: { 1: 100, 2: 200 },
  byHip: { 14576: 300 },
  bySynth: { 'synth-03082+4057-Ab': 400 },
};
const SYNTH = 'synth-03082+4057-Ab';
const SHA1 = 'da39a3ee5e6b4b0d3255bfef95601890afd80709';
const SIDECAR = { multiplesSha1: SHA1, ...MAP };

describe('parseCatalogRowIndexMap', () => {
  it('reads back what the serializer writes', () => {
    expect(parseCatalogRowIndexMap(serializeCatalogRowIndexSidecar(SHA1, MAP))).toEqual(SIDECAR);
  });

  it('throws on a missing section, never reading it as empty', () => {
    expect(() => parseCatalogRowIndexMap(JSON.stringify({ multiplesSha1: SHA1, byGaia: {}, byHip: {} })))
      .toThrow(/bySynth is missing/);
  });

  it('throws on a missing or malformed multiplesSha1', () => {
    expect(() => parseCatalogRowIndexMap(JSON.stringify(MAP))).toThrow(/multiplesSha1/);
    expect(() => parseCatalogRowIndexMap(JSON.stringify({ ...MAP, multiplesSha1: 'x' }))).toThrow(/multiplesSha1/);
  });

  it('throws on an entry that is not a record index', () => {
    expect(() => parseCatalogRowIndexMap(JSON.stringify({ ...SIDECAR, byHip: { 1: -1 } })))
      .toThrow(/byHip\[1\]/);
    expect(() => parseCatalogRowIndexMap(JSON.stringify({ ...SIDECAR, byGaia: { 1: '7' } })))
      .toThrow(/byGaia\[1\]/);
  });
});

describe('resolveMultiplesIdx', () => {
  it('walks gaia, then hip, then synth', () => {
    expect(resolveMultiplesIdx('1', 999, SYNTH, MAP)).toBe(100);
    expect(resolveMultiplesIdx(null, 14576, SYNTH, MAP)).toBe(300);
    expect(resolveMultiplesIdx('999', null, SYNTH, MAP)).toBe(400);
  });

  it('is null when no section holds a key', () => {
    expect(resolveMultiplesIdx(null, null, 'synth-99999+9999-Z', MAP)).toBeNull();
    expect(resolveMultiplesIdx(null, null, null, MAP)).toBeNull();
  });
});

describe('synthSlotIdx', () => {
  it('is the synth record unless it is the excluded one', () => {
    expect(synthSlotIdx(SYNTH, MAP)).toBe(400);
    expect(synthSlotIdx(SYNTH, MAP, 400)).toBeNull();
    expect(synthSlotIdx(null, MAP)).toBeNull();
  });
});
