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

// The three rows whose layer carries a contribution gate. Each stub supplies
// the draw query alone, so a present() that reached for the user toggle
// instead would not even resolve.
const GATED_ROWS = ['mwBand', 'lgEmission', 'cloudAbsorption'] as const;

function gatedLayers(drawn: boolean): Stellata {
  return {
    milkyway: { isDrawn: () => drawn },
    kinds: {
      lg: { emission: { isDrawn: () => drawn } },
      cloud: { layer: { isAbsorptionDrawn: () => drawn } },
    },
  } as unknown as Stellata;
}

function presentOf(stellata: Stellata, key: string): boolean {
  const toggle = buildPassToggles(stellata).find((t) => t.key === key);
  if (toggle === undefined) throw new Error(`no ${key} row in the roster`);
  return toggle.present();
}

describe('a contribution-gated row asks whether its layer draws', () => {
  it('is present while the layer draws', () => {
    for (const key of GATED_ROWS) {
      expect(presentOf(gatedLayers(true), key), key).toBe(true);
    }
  });

  // The skip already removed the pass, so disabling it saves nothing and the
  // row would read a meaningless zero — which is the one thing present() is
  // there to prevent (README.md § The roster).
  it('is absent while the layer is skipped', () => {
    for (const key of GATED_ROWS) {
      expect(presentOf(gatedLayers(false), key), key).toBe(false);
    }
  });

  it('is absent where the kind module attached no layer at all', () => {
    const unattached = {
      kinds: { lg: { emission: null }, cloud: { layer: null } },
    } as unknown as Stellata;
    expect(presentOf(unattached, 'lgEmission')).toBe(false);
    expect(presentOf(unattached, 'cloudAbsorption')).toBe(false);
  });
});

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
