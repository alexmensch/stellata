import { describe, expect, it } from 'vitest';
import type { Stellata } from '../../../stellata';
import { buildPassToggles } from './passes';
import { EMPTY_PASSES_DEFAULT, PRICED_PASS_KEYS } from './passes-pure';

// Building the roster reads nothing off stellata — every access sits inside
// a present() or disable() closure — so the key order is assertable without
// a renderer.
const keysOf = (): string[] =>
  buildPassToggles({} as unknown as Stellata).map((t) => t.key);

interface EmptyPassStub {
  localDepthPass: { extraEmptyPasses: number };
}

function emptyPassToggle(options?: { emptyPasses?: number }): {
  stub: EmptyPassStub;
  disable: () => () => void;
} {
  const stub: EmptyPassStub = { localDepthPass: { extraEmptyPasses: 0 } };
  const toggle = buildPassToggles(stub as unknown as Stellata, options)
    .find((t) => t.key === 'emptyPass');
  if (toggle === undefined) throw new Error('no emptyPass row in the roster');
  return { stub, disable: toggle.disable };
}

describe('buildPassToggles', () => {
  it('produces exactly the keys the roster declares, in table order', () => {
    expect(keysOf()).toEqual([...PRICED_PASS_KEYS]);
  });

  it('names each row once', () => {
    const keys = keysOf();
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('adds the default count of empty passes and clears them on restore', () => {
    const { stub, disable } = emptyPassToggle();
    const restore = disable();
    expect(stub.localDepthPass.extraEmptyPasses).toBe(EMPTY_PASSES_DEFAULT);
    restore();
    expect(stub.localDepthPass.extraEmptyPasses).toBe(0);
  });

  it('honours a requested count', () => {
    const { stub, disable } = emptyPassToggle({ emptyPasses: 4 });
    disable();
    expect(stub.localDepthPass.extraEmptyPasses).toBe(4);
  });

  it('adds at least one pass, whole, however the count is spelled', () => {
    for (const [asked, applied] of [[0, 1], [-3, 1], [2.4, 2], [2.6, 3]]) {
      const { stub, disable } = emptyPassToggle({ emptyPasses: asked });
      disable();
      expect(stub.localDepthPass.extraEmptyPasses, `asked ${asked}`).toBe(applied);
    }
  });
});
