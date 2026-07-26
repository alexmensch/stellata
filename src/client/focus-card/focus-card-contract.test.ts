import { describe, expect, it } from 'vitest';
import type {
  FocusCardContent,
  FocusCardProvider,
  FocusCardProviders,
} from './focus-card-types';

const content: FocusCardContent = { name: 'x', identityLines: [], rows: [], lines: [] };

const starProvider: FocusCardProvider<'star'> = {
  kind: 'star',
  format: () => content,
};
const cloudProvider: FocusCardProvider<'cloud'> = {
  kind: 'cloud',
  format: () => content,
};
const lgProvider: FocusCardProvider<'lg'> = {
  kind: 'lg',
  format: () => content,
};
const planetProvider: FocusCardProvider<'planet'> = {
  kind: 'planet',
  format: () => content,
};
const shellProvider: FocusCardProvider<'shell'> = {
  kind: 'shell',
  format: () => content,
};
const probeProvider: FocusCardProvider<'probe'> = {
  kind: 'probe',
  format: () => content,
};

describe('FocusCardProviders contract', () => {
  it('is exhaustive over FocusKind — a partial registry fails tsc', () => {
    const complete: FocusCardProviders = {
      star: starProvider,
      cloud: cloudProvider,
      lg: lgProvider,
      planet: planetProvider,
      shell: shellProvider,
      probe: probeProvider,
    };

    // @ts-expect-error — omitting a focusable kind must not compile.
    const partial: FocusCardProviders = { star: starProvider };

    const misKeyed: FocusCardProviders = {
      // @ts-expect-error — a provider can't register under the wrong kind.
      star: cloudProvider,
      cloud: cloudProvider,
      lg: lgProvider,
      planet: planetProvider,
      shell: shellProvider,
      probe: probeProvider,
    };

    expect(complete.star.kind).toBe('star');
    expect(partial).toBeDefined();
    expect(misKeyed).toBeDefined();
  });
});
