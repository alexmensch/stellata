import { describe, it, expect } from 'vitest';
import {
  readSourceIdRequest,
  serialiseSourceIdRequest,
  sortSourceIdsNumeric,
  unrequestedBindings,
} from './export-astrometry-request-pure';

describe('export-astrometry-request-pure / sortSourceIdsNumeric', () => {
  it('orders numerically, not lexicographically, across the 2^53 boundary', () => {
    const ids = ['4472832130942575872', '594595272471808', '999', '1000'];
    expect(sortSourceIdsNumeric(ids)).toEqual([
      '999',
      '1000',
      '594595272471808',
      '4472832130942575872',
    ]);
  });

  it('accepts any iterable (Set) and preserves every element', () => {
    const set = new Set(['30', '2', '100']);
    expect(sortSourceIdsNumeric(set)).toEqual(['2', '30', '100']);
  });

  it('does not collide ids that a Number sort would round together', () => {
    const a = '9223372036854775801';
    const b = '9223372036854775807';
    expect(BigInt(a)).not.toBe(BigInt(b));
    expect(sortSourceIdsNumeric([b, a])).toEqual([a, b]);
  });

  it('returns [] for empty input', () => {
    expect(sortSourceIdsNumeric([])).toEqual([]);
  });
});

const R = { file: 'r.tsv', hint: 'h' };

describe('the source_id request file', () => {
  it('round-trips, numerically ordered under its header', () => {
    const text = serialiseSourceIdRequest(new Set(['30', '2', '4472832130942575872']));
    expect(text).toBe('gaia_source_id\n2\n30\n4472832130942575872\n');
    expect(readSourceIdRequest(text, R)).toEqual([2n, 30n, 4472832130942575872n]);
  });

  it('writes a header-only file for no ids, and reads it back empty', () => {
    expect(serialiseSourceIdRequest([])).toBe('gaia_source_id\n');
    expect(readSourceIdRequest('gaia_source_id\n', R)).toEqual([]);
  });

  it('refuses a file without the header, and a bad id by file and line, ending with the hint', () => {
    expect(() => readSourceIdRequest('2\n30\n', R)).toThrow(/r\.tsv is missing required columns: gaia_source_id/);
    expect(() => readSourceIdRequest('gaia_source_id\n12\n\t\n-3\n', R)).toThrow(/^r\.tsv:4: gaia_source_id: "-3" is not a source_id/);
    expect(() => readSourceIdRequest('source_id\n12\n', { file: 'r.tsv', hint: 'Restore it from git.' })).toThrow(/\. Restore it from git\.$/);
  });
});

describe('unrequestedBindings', () => {
  it('names a primaries row whose source is unrequested, and nothing else', () => {
    const rows = [
      { key: 'requested', term: 'primaries', gaiaSourceId: '1' },
      { key: 'unrequested', term: 'primaries', gaiaSourceId: '2' },
      { key: 'magnitude', term: 'magnitude', gaiaSourceId: '3' },
      { key: 'no-gaia', term: 'primaries', gaiaSourceId: null },
    ];
    expect(unrequestedBindings(rows, new Set(['1'])).map((r) => r.key)).toEqual(['unrequested']);
  });
});
