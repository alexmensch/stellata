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
  const stub = {
    getCameraMode: () => opts.mode ?? 'navigate',
    setCameraMode: vi.fn(() => calls.push('setCameraMode')),
    getVectorTarget: () => opts.vector ?? null,
    setVector: vi.fn(() => calls.push('setVector')),
    getFocusedTarget: () => opts.focused ?? null,
    unfocus: vi.fn(() => calls.push('unfocus')),
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

  it('unfocuses whichever kind is focused — planets are not special-cased', () => {
    for (const focused of [
      { kind: 'star', idx: 1 },
      { kind: 'planet', idx: 3 },
      { kind: 'lg', idx: 0 },
    ] as const) {
      const { stub } = makeStub({ focused });
      escCascade(stub);
      expect(stub.unfocus).toHaveBeenCalled();
    }
  });

  it('nothing set is a no-op', () => {
    const empty = makeStub();
    escCascade(empty.stub);
    expect(empty.calls).toEqual([]);
  });
});
