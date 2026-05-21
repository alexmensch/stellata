import { describe, it, expect } from 'vitest';

import { parseGaiaHipXmatchTsv } from './gaia-xmatch';

describe('gaia-xmatch / parseGaiaHipXmatchTsv', () => {
  it('parses a minimal TSV with header + one row', () => {
    const text = [
      'hip\tgaia_source_id\tangular_distance\tnumber_of_neighbours\txm_flag',
      '2\t2341871673090078592\t0.043826\t1\t8',
    ].join('\n');
    const m = parseGaiaHipXmatchTsv(text);
    expect(m.size).toBe(1);
    expect(m.get(2)).toBe('2341871673090078592');
  });

  it('keeps gaia_source_id as a decimal string (preserves bits beyond 2^53)', () => {
    // Gaia DR3 source_ids exceed Number.MAX_SAFE_INTEGER (2^53-1).
    const text = [
      'hip\tgaia_source_id\tangular_distance',
      '12345\t9876543210123456789\t0.001',
    ].join('\n');
    const m = parseGaiaHipXmatchTsv(text);
    expect(m.get(12345)).toBe('9876543210123456789');
  });

  it('keeps the nearest match per HIP on duplicate rows', () => {
    const text = [
      'hip\tgaia_source_id\tangular_distance',
      '5\t111\t0.500',
      '5\t222\t0.050',
      '5\t333\t0.200',
    ].join('\n');
    const m = parseGaiaHipXmatchTsv(text);
    expect(m.get(5)).toBe('222');
  });

  it('treats missing angular_distance as +inf so it cannot win the tie-break', () => {
    const text = [
      'hip\tgaia_source_id\tangular_distance',
      '7\t111\t',
      '7\t222\t0.100',
    ].join('\n');
    const m = parseGaiaHipXmatchTsv(text);
    expect(m.get(7)).toBe('222');
  });

  it('skips rows with non-numeric or empty hip / gaia_source_id', () => {
    const text = [
      'hip\tgaia_source_id\tangular_distance',
      '\t111\t0.1',
      '8\t\t0.1',
      '9\tnot-a-number\t0.1',
      '0\t555\t0.1',
      '10\t777\t0.1',
    ].join('\n');
    const m = parseGaiaHipXmatchTsv(text);
    expect(m.size).toBe(1);
    expect(m.get(10)).toBe('777');
  });

  it('returns an empty map for a header-only file', () => {
    const text = 'hip\tgaia_source_id\tangular_distance';
    expect(parseGaiaHipXmatchTsv(text).size).toBe(0);
  });

  it('throws if a required column is missing from the header', () => {
    const text = ['hip\tangular_distance', '2\t0.04'].join('\n');
    expect(() => parseGaiaHipXmatchTsv(text)).toThrow(/gaia_source_id/);
  });
});
