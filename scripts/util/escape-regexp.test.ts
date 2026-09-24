import { describe, expect, it } from 'vitest';

import { escapeRegExp } from './escape-regexp';

describe('escapeRegExp', () => {
  it.each(['.', '*', '+', '?', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\'])(
    'matches %s literally',
    (char) => {
      const text = `a${char}b`;
      expect(new RegExp(`^${escapeRegExp(text)}$`).test(text)).toBe(true);
    },
  );

  it('escapes a backslash so it cannot swallow the character after it', () => {
    expect(new RegExp(escapeRegExp('a\\d')).test('a7')).toBe(false);
    expect(new RegExp(escapeRegExp('a\\d')).test('a\\d')).toBe(true);
  });

  it('matches a figure with grouping separators exactly', () => {
    expect(new RegExp(`^${escapeRegExp('983,068.5')}$`).test('983,068.5')).toBe(true);
    expect(new RegExp(`^${escapeRegExp('983,068.5')}$`).test('983,068x5')).toBe(false);
  });
});
