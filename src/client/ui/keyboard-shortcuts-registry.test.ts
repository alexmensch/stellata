import { describe, it, expect } from 'vitest';
import { helpModalShortcuts, SHORTCUTS } from './keyboard-shortcuts-registry';

const keysOf = (list: { keys: string[] }[]): string[] =>
  list.map((s) => s.keys.join(''));

// The help modal joins a chord with `+` and everything else with `/`, so an
// unmarked modifier entry renders as "⇧ / V" — two alternatives, which is the
// opposite of what it means.
describe('modifier chords', () => {
  it('marks every entry carrying a modifier glyph as a chord', () => {
    for (const s of SHORTCUTS) {
      if (s.keys.includes('⇧')) expect(s.chord).toBe(true);
    }
  });

  it('leaves every other entry unmarked, so `/` stays the default', () => {
    for (const s of SHORTCUTS) {
      if (!s.keys.includes('⇧')) expect(s.chord).toBeUndefined();
    }
  });
});

describe('helpModalShortcuts', () => {
  it('lists every non-debug shortcut in registry order', () => {
    expect(keysOf(helpModalShortcuts())).toEqual([
      'G', 'F', 'O', 'M', 'V', '⇧V', 'W', 'C', 'S', 'L', 'Z', '⇧Z', 'H', 'R', 'T', '←→', 'Space', 'Backspace', 'FF', 'U', 'K', '+−', '=', 'Esc', '?',
    ]);
  });

  it('excludes the hidden debug affordance', () => {
    expect(keysOf(helpModalShortcuts())).not.toContain('D');
  });
});
