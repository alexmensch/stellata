import { describe, expect, it, beforeEach } from 'vitest';
import type { ShellInstance } from '../fresnel-shell/shell-registry';
import { setUnit } from '../ui/distance-util';
import { createShellFocusProvider } from './shell-focus-provider';

const LOCAL_BUBBLE: ShellInstance = {
  label: 'Local Bubble',
  sid: 42,
  card: {
    typeLine: 'Interstellar medium cavity',
    size: '~75–300 pc wall',
    knownFrom: 'Zucker et al. 2022',
  },
  centerAbsInto: (out) => {
    out.set(0, 0, 0);
    return true;
  },
  extentPc: () => 150,
  pick: { labelElementId: 'x', visible: () => true, sampleCount: () => 0, sampleLocalInto: () => {} },
};

describe('createShellFocusProvider', () => {
  beforeEach(() => setUnit('pc'));

  it('formats the identity + rows off the registered shell', () => {
    let camDist = 1200;
    const provider = createShellFocusProvider({
      shellAt: () => LOCAL_BUBBLE,
      cameraDistancePc: () => camDist,
    });
    const card = provider.format(0);
    expect(card.name).toBe('Local Bubble');
    expect(card.identityLines).toEqual(['Interstellar medium cavity']);
    const byLabel = new Map(card.rows.map((r) => [r.label, r.value]));
    expect(byLabel.get('Size')).toBe('~75–300 pc wall');
    expect(byLabel.get('Known from')).toBe('Zucker et al. 2022');
    expect(typeof byLabel.get('Distance')).toBe('function');
    const dist = byLabel.get('Distance') as () => string;
    const first = dist();
    camDist = 5000;
    expect(dist()).not.toBe(first);
  });

  it('renders labelled size measurements as their own right-justified rows (heliopause)', () => {
    const helio: ShellInstance = {
      ...LOCAL_BUBBLE,
      label: 'Heliopause',
      card: {
        typeLine: 'Solar-wind boundary',
        size: [
          { label: 'Upwind', value: '122 AU' },
          { label: 'Laterally', value: '115 AU' },
          { label: 'Downwind tail', value: '200 AU' },
        ],
        knownFrom: 'Voyager 1 & 2 crossings',
      },
    };
    const provider = createShellFocusProvider({ shellAt: () => helio, cameraDistancePc: () => 1200 });
    const byLabel = new Map(provider.format(0).rows.map((r) => [r.label, r.value]));
    expect(byLabel.has('Size')).toBe(false); // no single "Size" row — one row per axis
    expect(byLabel.get('Upwind')).toBe('122 AU');
    expect(byLabel.get('Laterally')).toBe('115 AU');
    expect(byLabel.get('Downwind tail')).toBe('200 AU');
  });

  it('returns an empty card when the shell is absent', () => {
    const provider = createShellFocusProvider({ shellAt: () => null, cameraDistancePc: () => 0 });
    expect(provider.format(0)).toEqual({ name: '', identityLines: [], rows: [], lines: [] });
  });
});
