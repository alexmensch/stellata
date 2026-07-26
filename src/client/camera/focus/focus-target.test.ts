import { describe, expect, it } from 'vitest';
import type { FocusableProvider, FocusableProviders } from './focus-target';
import { targetsEqual } from './focus-target';

const provider: FocusableProvider = {
  localPositionInto: () => false,
  focusParkDistance: () => 1,
  arrivalRadiusPc: () => null,
  renderedSizePx: () => 0,
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
