import { describe, expect, it, beforeEach } from 'vitest';
import type { ShellInstance } from '../../fresnel-shell/shell-registry';
import { setUnit } from '../../ui/distance-util';
import { formatShellHover } from './shell-hover-format';

const SHELL: ShellInstance = {
  label: 'Local Bubble',
  sid: 1,
  card: {
    typeLine: 'Interstellar medium cavity',
    size: '~75–300 pc wall',
    knownFrom: 'Zucker et al. 2022',
  },
  centerAbsInto: () => true,
  extentPc: () => 150,
  pick: { labelElementId: 'x', visible: () => true, sampleCount: () => 0, sampleLocalInto: () => {} },
};

describe('formatShellHover', () => {
  beforeEach(() => setUnit('pc'));

  it('formats name, camera distance, type, and size', () => {
    const p = formatShellHover(SHELL, 1200);
    expect(p.name).toBe('Local Bubble');
    expect(p.lines[0]).toContain('pc');
    expect(p.lines[1]).toBe('Interstellar medium cavity');
    expect(p.lines[2]).toBe('Size ~75–300 pc wall');
  });

  it('renders labelled size measurements value-first, one line each (heliopause)', () => {
    const helio: ShellInstance = {
      ...SHELL,
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
    const p = formatShellHover(helio, 1200);
    expect(p.name).toBe('Heliopause');
    expect(p.lines[1]).toBe('Solar-wind boundary');
    expect(p.lines.slice(2)).toEqual(['122 AU upwind', '115 AU laterally', '200 AU downwind tail']);
  });
});
