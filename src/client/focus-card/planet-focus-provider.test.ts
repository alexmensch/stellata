import { describe, expect, it } from 'vitest';
import { createPlanetFocusProvider } from './planet-focus-provider';
import { SOL_MOONS, SOL_PLANETS } from '../solar-system/planet-system';
import type { OrbitDescriptor } from '../solar-system/ephemerides/orbit-descriptor';
import { AU_PC } from '../util/astronomy-constants';
import { setUnit } from '../ui/distance-util';
import type { FocusCardRow } from './focus-card-types';

const EARTH = SOL_PLANETS[2];
const JUPITER = SOL_PLANETS[4];
const EUROPA = SOL_MOONS.find((m) => m.name === 'Europa')!;

const EARTH_ORBIT: OrbitDescriptor = {
  parentName: 'Sol',
  semiMajorAxis: 1.0,
  axisUnit: 'AU',
  period: 1.0,
  periodUnit: 'yr',
};
const JUPITER_ORBIT: OrbitDescriptor = {
  parentName: 'Sol',
  semiMajorAxis: 5.203,
  axisUnit: 'AU',
  period: 11.868,
  periodUnit: 'yr',
};
const EUROPA_ORBIT: OrbitDescriptor = {
  parentName: 'Jupiter',
  semiMajorAxis: 671100,
  axisUnit: 'km',
  period: 3.55,
  periodUnit: 'd',
};

function makeProvider(overrides: Partial<Parameters<typeof createPlanetFocusProvider>[0]> = {}) {
  return createPlanetFocusProvider({
    planetAt: (idx) => (idx === 0 ? EARTH : idx === 1 ? JUPITER : idx === 2 ? EUROPA : null),
    orbitDescriptorOf: (idx) =>
      idx === 0 ? EARTH_ORBIT : idx === 1 ? JUPITER_ORBIT : idx === 2 ? EUROPA_ORBIT : null,
    cameraDistancePc: () => 0.5 * AU_PC,
    appMagFor: () => -3.86,
    moonNamesOf: (idx) =>
      idx === 1 ? ['Io', 'Europa', 'Ganymede', 'Callisto'] : [],
    constellationName: () => 'Taurus',
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
    // Breadcrumb: header names the body, this line its parent.
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

  it('a moon reads "Orbiting <parent>", a km orbit, a day period, and a moon type', () => {
    const content = makeProvider().format(2);
    expect(content.name).toBe('Europa');
    expect(content.identityLines[0]).toBe('Orbiting Jupiter');
    expect(content.identityLines[1]).toBe('Icy moon');
    expect(rowValue(content.rows, 'Orbit')).toBe('671,100 km');
    expect(rowValue(content.rows, 'Period')).toBe('3.55 d');
  });

  it('live rows degrade to em-dash on degenerate reads', () => {
    const p = makeProvider({ cameraDistancePc: () => null, appMagFor: () => null });
    const content = p.format(0);
    expect(rowValue(content.rows, 'Distance')).toBe('—');
    expect(rowValue(content.rows, 'App mag')).toBe('—');
  });

  it('omits the breadcrumb when the descriptor has no parent name', () => {
    const content = makeProvider({
      orbitDescriptorOf: () => ({ ...EARTH_ORBIT, parentName: null }),
    }).format(0);
    expect(content.identityLines).toEqual(['Rocky planet']);
  });

  it('omits the orbit rows when the descriptor is null', () => {
    const content = makeProvider({ orbitDescriptorOf: () => null }).format(0);
    expect(content.rows.find((r) => r.label === 'Period')).toBeUndefined();
    expect(content.rows.find((r) => r.label === 'Orbit')).toBeUndefined();
  });

  it('returns empty content for an unattached instance', () => {
    const content = makeProvider().format(9);
    expect(content).toEqual({ name: '', identityLines: [], rows: [], lines: [] });
  });

  it('a moon-parenting planet carries a standard Moons row, one name per line', () => {
    const content = makeProvider().format(1);
    expect(rowValue(content.rows, 'Moons')).toBe('Io\nEuropa\nGanymede\nCallisto');
    expect(content.lines).toEqual([]);
  });

  it('moonless bodies and moons carry no Moons row', () => {
    expect(makeProvider().format(0).rows.find((r) => r.label === 'Moons')).toBeUndefined();
    expect(makeProvider().format(2).rows.find((r) => r.label === 'Moons')).toBeUndefined();
  });
});
