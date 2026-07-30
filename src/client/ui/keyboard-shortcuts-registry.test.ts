import { describe, it, expect } from 'vitest';
import { helpModalShortcuts } from './keyboard-shortcuts-registry';

const keysOf = (list: { keys: string[] }[]): string[] =>
  list.map((s) => s.keys.join(''));

describe('helpModalShortcuts', () => {
  it('lists every non-debug shortcut in registry order', () => {
    expect(keysOf(helpModalShortcuts())).toEqual([
      'G', 'F', 'O', 'M', 'V', 'W', 'C', 'S', 'H', 'R', 'T', '←→', 'Space', 'Backspace', 'FF', 'U', 'K', '+−', '=', 'Esc', '?',
    ]);
  });

  it('excludes the hidden debug affordance', () => {
    expect(keysOf(helpModalShortcuts())).not.toContain('D');
  });
});
