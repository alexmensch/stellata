import { describe, it, expect } from 'vitest';
import {
  SHORTCUTS,
  helpModalShortcuts,
  hintBarShortcuts,
  type ShortcutState,
} from './keyboard-shortcuts-registry';

const navigate: ShortcutState = {
  cameraMode: 'navigate',
  hasFocus: false,
  hasDestination: false,
  modalOpen: false,
};

const keysOf = (list: { keys: string[] }[]): string[] =>
  list.map((s) => s.keys.join(''));

describe('helpModalShortcuts', () => {
  it('lists every non-debug shortcut in registry order', () => {
    expect(keysOf(helpModalShortcuts())).toEqual([
      'G', 'F', 'O', 'M', 'W', 'C', 'S', 'H', 'R', 'T', 'FF', 'U', '+−', '=', 'Esc', '?',
    ]);
  });

  it('excludes the hidden debug affordance', () => {
    expect(keysOf(helpModalShortcuts())).not.toContain('D');
  });
});

describe('hintBarShortcuts', () => {
  it('bare navigate shows the core loop minus state-gated entries', () => {
    expect(keysOf(hintBarShortcuts(navigate))).toEqual(['G', '?']);
  });

  it('reveals O only when a star is focused, and never F in navigate', () => {
    expect(keysOf(hintBarShortcuts({ ...navigate, hasFocus: true })))
      .toEqual(['G', 'O', 'Esc', '?']);
  });

  it('reveals W only when a destination is set', () => {
    expect(keysOf(hintBarShortcuts({ ...navigate, hasDestination: true })))
      .toContain('W');
  });

  it('shows F, M and Esc in observe mode, never O or W', () => {
    const keys = keysOf(hintBarShortcuts({ ...navigate, cameraMode: 'observe' }));
    expect(keys).toContain('F');
    expect(keys).toContain('M');
    expect(keys).toContain('Esc');
    expect(keys).not.toContain('O');
    expect(keys).not.toContain('W');
  });

  it('collapses to Esc only while a modal is open', () => {
    expect(keysOf(hintBarShortcuts({
      cameraMode: 'navigate',
      hasFocus: true,
      hasDestination: true,
      modalOpen: true,
    }))).toEqual(['Esc']);
  });

  it('never surfaces non-hint or debug shortcuts', () => {
    const everyState: ShortcutState[] = [
      navigate,
      { ...navigate, hasFocus: true, hasDestination: true },
      { ...navigate, cameraMode: 'observe' },
    ];
    for (const s of everyState) {
      const keys = keysOf(hintBarShortcuts(s));
      for (const relegated of ['S', 'H', 'R', 'T', 'FF', 'U', '+−', '=', 'D']) {
        expect(keys).not.toContain(relegated);
      }
    }
  });

  it('? and Esc-applicability are consistent with the registry flags', () => {
    // Every hint-bar candidate must be flagged hint:true in the registry.
    const hintKeys = new Set(SHORTCUTS.filter((s) => s.hint).map((s) => s.keys.join('')));
    for (const s of hintBarShortcuts({ ...navigate, hasFocus: true, hasDestination: true })) {
      expect(hintKeys.has(s.keys.join(''))).toBe(true);
    }
  });
});
