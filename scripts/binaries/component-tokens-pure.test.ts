import { describe, expect, it } from 'vitest';

import {
  canonicalCompLetter,
  composeSyntheticId,
  parentComponentToken,
} from './component-tokens-pure';

describe('composeSyntheticId', () => {
  it('builds "synth-<wds_id>-<comp>" from a Stage 6 system_id', () => {
    expect(composeSyntheticId('03082+4057-Aa,Ab', 'Ab')).toBe('synth-03082+4057-Ab');
  });

  it('preserves negative-Dec wds_id intact', () => {
    expect(composeSyntheticId('16120-1928-Aa,Ab', 'Ab')).toBe('synth-16120-1928-Ab');
  });

  it('returns null for empty comp letter', () => {
    expect(composeSyntheticId('03082+4057-Aa,Ab', '')).toBeNull();
    expect(composeSyntheticId('03082+4057-Aa,Ab', '   ')).toBeNull();
  });

  it('returns null when system_id has no dash (malformed)', () => {
    expect(composeSyntheticId('NODASH', 'Ab')).toBeNull();
  });
});

describe('canonicalCompLetter', () => {
  it('re-anchors WDS prefix-truncated bare-digit secondary onto primary stem', () => {
    // Algol Aa1,2 — secondary cell carries "2" not "Aa2".
    expect(canonicalCompLetter('Aa1', '2')).toBe('Aa2');
  });

  it('passes through non-digit secondary unchanged', () => {
    expect(canonicalCompLetter('A', 'B')).toBe('B');
    expect(canonicalCompLetter('Aa', 'Ab')).toBe('Ab');
  });

  it('passes through when primary has no trailing digit', () => {
    expect(canonicalCompLetter('AB', '2')).toBe('2');
  });

  it('passes through for single-character primary (no stem to extract)', () => {
    expect(canonicalCompLetter('A', '2')).toBe('2');
  });
});

describe('parentComponentToken', () => {
  // Fixtures mirror component_tokens.py:test_parent_component_token so
  // the Python↔TS mirror can't silently drift.
  it('drops the rightmost designator', () => {
    expect(parentComponentToken('Aa1')).toBe('Aa');
    expect(parentComponentToken('Ba')).toBe('B');
    expect(parentComponentToken('Aa')).toBe('A');
  });

  it('returns null for a single-character (top-level) token', () => {
    expect(parentComponentToken('A')).toBeNull();
  });
});
