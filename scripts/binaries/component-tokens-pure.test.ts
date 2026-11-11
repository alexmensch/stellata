import { describe, expect, it } from 'vitest';

import {
  canonicalCompLetter,
  childComponentTokens,
  composeSyntheticId,
  compoundContains,
  isComponentToken,
  pairComponentTokens,
  parentComponentToken,
  relatedHier,
  subcomponentTopLetter,
  tokenLetters,
  wdsRootOf,
} from './component-tokens-pure';

describe('isComponentToken', () => {
  it('admits one component and refuses compounds and fixed-width garbage', () => {
    for (const tok of ['A', 'Aa', 'Aa1', 'B', 'Cb']) expect(isComponentToken(tok)).toBe(true);
    for (const tok of ['', 'AB', 'Aab', 'a', '95', 'Aa12', 'r']) expect(isComponentToken(tok)).toBe(false);
  });
});

describe('pairComponentTokens', () => {
  it('re-anchors a truncated secondary', () => {
    expect(pairComponentTokens('Aa1,2')).toEqual(['Aa1', 'Aa2']);
    expect(pairComponentTokens('AB')).toEqual(['A', 'B']);
    expect(pairComponentTokens('')).toBeNull();
  });
});

describe('childComponentTokens', () => {
  it('names the sub-pair one level down, and nothing below Aa1 or under a compound', () => {
    expect(childComponentTokens('A')).toEqual(['Aa', 'Ab']);
    expect(childComponentTokens('Ca')).toEqual(['Ca1', 'Ca2']);
    expect(childComponentTokens('Aa1')).toBeNull();
    expect(childComponentTokens('AB')).toBeNull();
  });
});

describe('subcomponentTopLetter', () => {
  it('is the root letter of a lowercase sub-component only', () => {
    expect(subcomponentTopLetter('Aa')).toBe('A');
    expect(subcomponentTopLetter('Bbc')).toBe('B');
    expect(subcomponentTopLetter('A')).toBeNull();
    expect(subcomponentTopLetter('Aa1')).toBeNull();
  });
});

describe('tokenLetters', () => {
  it('collects the capitals', () => {
    expect([...tokenLetters('AB')]).toEqual(['A', 'B']);
    expect([...tokenLetters('Aa1')]).toEqual(['A']);
  });
});

describe('wdsRootOf', () => {
  it('is everything before the last dash, a negative-Dec id intact', () => {
    expect(wdsRootOf('04153-0739-BC')).toBe('04153-0739');
    expect(wdsRootOf('03082+4057-Aa1,2')).toBe('03082+4057');
  });

  it('is null with no dash or nothing before it', () => {
    expect(wdsRootOf('NODASH')).toBeNull();
    expect(wdsRootOf('-AB')).toBeNull();
  });
});

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
    expect(parentComponentToken('')).toBeNull();
  });
});

describe('relatedHier', () => {
  it('equal tokens and ancestors relate; siblings and compounds do not', () => {
    expect(relatedHier('A', 'A')).toBe(true);
    expect(relatedHier('A', 'Aa1')).toBe(true);
    expect(relatedHier('Aa1', 'Aa')).toBe(true);
    expect(relatedHier('Aa', 'Ab')).toBe(false);
    expect(relatedHier('AB', 'A')).toBe(false);
  });
});

describe('compoundContains', () => {
  it('a compound contains every token whose capitals it holds', () => {
    expect(compoundContains('AB', 'A')).toBe(true);
    expect(compoundContains('Aa', 'AB')).toBe(true);
    expect(compoundContains('AB', 'CD')).toBe(false);
    expect(compoundContains('A', 'A')).toBe(false);
  });
});
