import { describe, expect, it } from 'vitest';
import type { FocusableProvider, FocusableProviders, TargetKind } from './focus-target';
import { KIND_TRAITS, isHardTarget, targetsEqual } from './focus-target';

const provider: FocusableProvider = {
  anchorInto: () => false,
  localPositionInto: () => false,
  focusParkDistance: () => 1,
  orbitFloor: () => 1,
  arrivalRadiusPc: () => null,
  renderedSizePx: () => 0,
  chartPlateauDistance: () => null,
  planetSystemHost: () => null,
};

describe('FocusableProviders contract', () => {
  it('is exhaustive over TargetKind — a partial registry fails tsc', () => {
    const complete: FocusableProviders = {
      star: provider,
      cloud: provider,
      lg: provider,
      planet: provider,
      shell: provider,
      probe: provider,
    };

    // @ts-expect-error — omitting a focusable kind must not compile.
    const partial: FocusableProviders = { star: provider };

    expect(complete.star).toBeDefined();
    expect(partial).toBeDefined();
  });
});

describe('KIND_TRAITS', () => {
  it('is exhaustive over TargetKind — a partial record fails tsc', () => {
    // @ts-expect-error — omitting a kind's traits must not compile.
    const partial: typeof KIND_TRAITS = { star: { hard: true, moving: false } };
    expect(partial).toBeDefined();
  });

  it('declares star/planet/probe hard and planet/probe moving', () => {
    const kinds = Object.keys(KIND_TRAITS) as TargetKind[];
    expect(kinds.sort()).toEqual(['cloud', 'lg', 'planet', 'probe', 'shell', 'star']);
    expect(kinds.filter((k) => KIND_TRAITS[k].hard).sort())
      .toEqual(['planet', 'probe', 'star']);
    expect(kinds.filter((k) => KIND_TRAITS[k].moving).sort())
      .toEqual(['planet', 'probe']);
  });

  it('isHardTarget reads the declared traits, null is soft', () => {
    expect(isHardTarget({ kind: 'star', idx: 0 })).toBe(true);
    expect(isHardTarget({ kind: 'cloud', idx: 0 })).toBe(false);
    expect(isHardTarget(null)).toBe(false);
  });
});

describe('targetsEqual', () => {
  it('compares kind + idx, with null only equal to null', () => {
    expect(targetsEqual({ kind: 'star', idx: 3 }, { kind: 'star', idx: 3 })).toBe(true);
    expect(targetsEqual({ kind: 'star', idx: 3 }, { kind: 'cloud', idx: 3 })).toBe(false);
    expect(targetsEqual({ kind: 'star', idx: 3 }, { kind: 'star', idx: 4 })).toBe(false);
    expect(targetsEqual(null, null)).toBe(true);
    expect(targetsEqual({ kind: 'star', idx: 3 }, null)).toBe(false);
    expect(targetsEqual(null, { kind: 'star', idx: 3 })).toBe(false);
  });
});
