import { describe, expect, it, vi } from 'vitest';
import { escCascade } from './keyboard-shortcuts';
import type { Stellata } from '../stellata';
import type { Target } from '../camera/focus/focus-target';

function makeStub(opts: {
  mode?: 'navigate' | 'observe';
  vector?: Target | null;
  focused?: Target | null;
} = {}) {
  const calls: string[] = [];
  const setMode = vi.fn(() => calls.push('setMode'));
  const setVector = vi.fn(() => calls.push('setVector'));
  const unfocus = vi.fn(() => calls.push('unfocus'));
  const stub = {
    observe: { setMode },
    focus: {
      getCameraMode: () => opts.mode ?? 'navigate',
      getVectorTarget: () => opts.vector ?? null,
      getFocusedTarget: () => opts.focused ?? null,
      setVector,
      unfocus,
    },
  } as unknown as Stellata;
  return { stub, calls, setMode, setVector, unfocus };
}

describe('escCascade', () => {
  it('observe exits to navigate before anything else', () => {
    const s = makeStub({ mode: 'observe', focused: { kind: 'star', idx: 1 } });
    escCascade(s.stub);
    expect(s.setMode).toHaveBeenCalledWith('navigate');
    expect(s.unfocus).not.toHaveBeenCalled();
  });

  it('clears a drawn vector before touching focus', () => {
    const s = makeStub({
      vector: { kind: 'star', idx: 2 },
      focused: { kind: 'star', idx: 1 },
    });
    escCascade(s.stub);
    expect(s.setVector).toHaveBeenCalledWith(null);
    expect(s.unfocus).not.toHaveBeenCalled();
  });

  it('unfocuses whichever kind is focused — planets are not special-cased', () => {
    for (const focused of [
      { kind: 'star', idx: 1 },
      { kind: 'planet', idx: 3 },
      { kind: 'lg', idx: 0 },
    ] as const) {
      const s = makeStub({ focused });
      escCascade(s.stub);
      expect(s.unfocus).toHaveBeenCalled();
    }
  });

  it('nothing set is a no-op', () => {
    const empty = makeStub();
    escCascade(empty.stub);
    expect(empty.calls).toEqual([]);
  });
});
