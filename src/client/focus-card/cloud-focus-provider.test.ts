import { beforeEach, describe, expect, it } from 'vitest';
import { setUnit } from '../ui/distance-util';
import type { Cloud } from '../molecular-clouds/cloud-loader';
import { makeMockCloud } from '../molecular-clouds/cloud-mock';
import { createCloudFocusProvider } from './cloud-focus-provider';
import type { FocusCardRow } from './focus-card-types';

function cloud(
  name: string,
  axes: [number, number, number],
  source: Cloud['source'],
  massMsun: number | null,
): Cloud {
  return makeMockCloud({
    name,
    id: name.toLowerCase(),
    axes,
    source,
    distanceFromSol: 150,
    massMsun,
  });
}

function rowValue(rows: FocusCardRow[], label: string): string | undefined {
  const row = rows.find((r) => r.label === label);
  if (!row) return undefined;
  return typeof row.value === 'function' ? row.value() : row.value;
}

describe('createCloudFocusProvider', () => {
  beforeEach(() => setUnit('pc'));

  it('renders distance (live), size, mass, and source for a Z2021 cloud', () => {
    const provider = createCloudFocusProvider({
      clouds: [cloud('Taurus', [22.0, 19.0, 9.5], 'Z2021T1', 15610)],
      cameraDistancePc: () => 150.4,
      constellationName: () => 'Taurus',
    });
    const out = provider.format(0);
    expect(out.name).toBe('Taurus');
    expect(out.identityLines).toEqual(['Molecular cloud']);
    expect(rowValue(out.rows, 'Distance')).toBe('150 pc');
    expect(rowValue(out.rows, 'Size')).toBe('22.0 × 9.5 pc');
    expect(rowValue(out.rows, 'Mass')).toBe('15,610 M☉');
    expect(rowValue(out.rows, 'Known from')).toBe('Zucker 2021');
  });

  it('renders a dot-separated alias line below the type when aliases exist', () => {
    const provider = createCloudFocusProvider({
      clouds: [makeMockCloud({ name: 'Eagle Nebula', aliases: ['M16', 'NGC 6611'] })],
      cameraDistancePc: () => 42,
      constellationName: () => 'Taurus',
    });
    const out = provider.format(0);
    expect(out.name).toBe('Eagle Nebula');
    expect(out.identityLines).toEqual(['Molecular cloud', 'M16 · NGC 6611']);
  });

  it('omits the mass row for Z2020 clouds (no Table 3 estimate)', () => {
    const provider = createCloudFocusProvider({
      clouds: [cloud('Aquila Rift', [75.73, 75.73, 75.73], 'Z2020', null)],
      cameraDistancePc: () => 236.2,
      constellationName: () => 'Taurus',
    });
    const out = provider.format(0);
    expect(rowValue(out.rows, 'Mass')).toBeUndefined();
    expect(rowValue(out.rows, 'Known from')).toBe('Zucker 2020');
  });

  it('returns an empty card when the catalog is absent or idx out of range', () => {
    const provider = createCloudFocusProvider({
      clouds: null,
      cameraDistancePc: () => 1,
      constellationName: () => 'Taurus',
    });
    expect(provider.format(0)).toEqual({
      name: '',
      identityLines: [],
      rows: [],
      lines: [],
    });
  });
});
