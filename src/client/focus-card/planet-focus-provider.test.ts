import { describe, expect, it } from 'vitest';
import { createPlanetFocusProvider } from './planet-focus-provider';
import { SOL_PLANETS } from '../solar-system/planet-system';
import { AU_PC } from '../util/astronomy-constants';
import { setUnit } from '../ui/distance-util';
import type { FocusCardRow } from './focus-card-types';

const EARTH = SOL_PLANETS[2];
const JUPITER = SOL_PLANETS[4];

function makeProvider(overrides: Partial<Parameters<typeof createPlanetFocusProvider>[0]> = {}) {
  return createPlanetFocusProvider({
    planetAt: (idx) => (idx === 0 ? EARTH : idx === 1 ? JUPITER : null),
    hostNameOf: () => 'Sol',
    cameraDistancePc: () => 0.5 * AU_PC,
    appMagFor: () => -3.86,
    ...overrides,
  });
}

function rowValue(rows: FocusCardRow[], label: string): string {
  const row = rows.find((r) => r.label === label);
  expect(row, label).toBeDefined();
  const v = row!.value;
  return typeof v === 'function' ? v() : v;
}

describe('planet focus-card provider', () => {
  it('formats Earth: breadcrumb identity + camera-frame and intrinsic rows', () => {
    setUnit('pc'); // stable golden strings
    const content = makeProvider().format(0);
    expect(content.name).toBe('Earth');
    // Breadcrumb: header names the body, this line its system.
    expect(content.identityLines[0]).toBe('Orbiting Sol');
    expect(content.identityLines[1]).toBe('Rocky planet');
    expect(rowValue(content.rows, 'Radius')).toBe('1.00 R⊕ (6,371 km)');
    expect(rowValue(content.rows, 'Distance')).toBe('0.500 AU');
    expect(rowValue(content.rows, 'App mag')).toBe('-3.9');
    expect(rowValue(content.rows, 'Period')).toBe('1.00 yr');
    expect(rowValue(content.rows, 'Orbit')).toBe('1.000 AU');
    expect(content.lines).toEqual([]);
  });

  it('gas giant type + wide-orbit precision (Jupiter)', () => {
    const content = makeProvider().format(1);
    expect(content.identityLines[1]).toBe('Gas giant');
    expect(rowValue(content.rows, 'Period')).toBe('12 yr');
    expect(rowValue(content.rows, 'Orbit')).toBe('5.203 AU');
  });

  it('live rows degrade to em-dash on degenerate reads', () => {
    const p = makeProvider({ cameraDistancePc: () => null, appMagFor: () => null });
    const content = p.format(0);
    expect(rowValue(content.rows, 'Distance')).toBe('—');
    expect(rowValue(content.rows, 'App mag')).toBe('—');
  });

  it('omits the breadcrumb when the host has no display name', () => {
    const content = makeProvider({ hostNameOf: () => null }).format(0);
    expect(content.identityLines).toEqual(['Rocky planet']);
  });

  it('returns empty content for an unattached instance', () => {
    const content = makeProvider().format(9);
    expect(content).toEqual({ name: '', identityLines: [], rows: [], lines: [] });
  });
});
