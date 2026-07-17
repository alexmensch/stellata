import { describe, expect, it, vi } from 'vitest';
import { escCascade } from './keyboard-shortcuts';
import type { Stellata } from '../stellata';
import type { Target } from '../camera/focus/focus-target';

function makeStub(opts: {
  mode?: 'navigate' | 'observe';
  vector?: Target | null;
  focused?: Target | null;
  hostOf?: (idx: number) => { hostStarIdx: number; planetIdx: number } | null;
} = {}) {
  const calls: string[] = [];
  const stub = {
    getCameraMode: () => opts.mode ?? 'navigate',
    setCameraMode: vi.fn(() => calls.push('setCameraMode')),
    getVectorTarget: () => opts.vector ?? null,
    setVector: vi.fn(() => calls.push('setVector')),
    getFocusedTarget: () => opts.focused ?? null,
    focusStar: vi.fn(() => calls.push('focusStar')),
    unfocus: vi.fn(() => calls.push('unfocus')),
    planetField: {
      hostPlanetOf: opts.hostOf ?? (() => null),
    },
  } as unknown as Stellata;
  return { stub, calls };
}

describe('escCascade', () => {
  it('observe exits to navigate before anything else', () => {
    const { stub } = makeStub({ mode: 'observe', focused: { kind: 'star', idx: 1 } });
    escCascade(stub);
    expect(stub.setCameraMode).toHaveBeenCalledWith('navigate');
    expect(stub.unfocus).not.toHaveBeenCalled();
  });

  it('clears a drawn vector before touching focus', () => {
    const { stub } = makeStub({
      vector: { kind: 'star', idx: 2 },
      focused: { kind: 'star', idx: 1 },
    });
    escCascade(stub);
    expect(stub.setVector).toHaveBeenCalledWith(null);
    expect(stub.unfocus).not.toHaveBeenCalled();
  });

  it('steps a focused planet back to its host star, not to unfocused', () => {
    const { stub } = makeStub({
      focused: { kind: 'planet', idx: 3 },
      hostOf: () => ({ hostStarIdx: 42, planetIdx: 3 }),
    });
    escCascade(stub);
    expect(stub.focusStar).toHaveBeenCalledWith(42);
    expect(stub.unfocus).not.toHaveBeenCalled();
  });

  it('a focused planet with no attach-table entry falls back to unfocus', () => {
    const { stub } = makeStub({ focused: { kind: 'planet', idx: 3 } });
    escCascade(stub);
    expect(stub.unfocus).toHaveBeenCalled();
    expect(stub.focusStar).not.toHaveBeenCalled();
  });

  it('a focused star unfocuses; nothing set is a no-op', () => {
    const focused = makeStub({ focused: { kind: 'star', idx: 1 } });
    escCascade(focused.stub);
    expect(focused.stub.unfocus).toHaveBeenCalled();

    const empty = makeStub();
    escCascade(empty.stub);
    expect(empty.calls).toEqual([]);
  });
});
