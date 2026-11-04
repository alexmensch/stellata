import { describe, expect, it } from 'vitest';

import { DUST_GRID_HALF_EXTENT_PC } from '../../src/astro-core/baker-constants';
import {
  CLOUD_ALT_NAMES,
  DEFAULT_SPHERE_RADIUS_PC,
  applyAltNames,
  buildClouds,
  displayName,
  inGrid,
} from './build-clouds-pure';
import type { CloudRow } from '../../src/catalog-format/clouds/clouds-schema';

describe('names', () => {
  it('cleans raw table names', () => {
    expect(displayName('Orionlam')).toBe('Orion λ');
    expect(displayName('Ophiuchus_Arc')).toBe('Ophiuchus Arc');
  });

  it('fails on an alias entry no cloud matches', () => {
    const clouds = Object.keys(CLOUD_ALT_NAMES).filter((id) => id !== 'm20').map((id) => ({ name: id, id }));
    expect(() => applyAltNames(clouds)).toThrow(/no cloud matches m20/);
  });
});

describe('inGrid', () => {
  it('is true only when the whole extent fits the dust cube', () => {
    const edge = DUST_GRID_HALF_EXTENT_PC;
    expect(inGrid([edge - 10, 0, 0], [10, 10, 10])).toBe(true);
    expect(inGrid([0, 0, -(edge - 9)], [10, 10, 10])).toBe(false);
  });
});

describe('buildClouds', () => {
  const sightline = (l: number): { lDeg: number; bDeg: number; dPc: number } => ({ lDeg: l, bDeg: 0, dPc: 100 });
  const sightlines = new Map(Object.keys(CLOUD_ALT_NAMES).map((id) => [id, [sightline(10)]]));
  sightlines.set('Orion', [sightline(200), sightline(201)]);
  sightlines.set('Aquila_S', [sightline(30)]);
  const extents = [{ cloud: 'Oriona', xmin: -10, xmax: 10, ymin: -10, ymax: 10, zmin: -5, zmax: 5 }];

  const built = buildClouds({ sightlines, extents, masses: new Map([['Oriona', { massNicest: 5, massLeike: 1, maxAkLeike: 1 }]]), profiled: [] });
  const byId = new Map(built.clouds.map((c): [string, CloudRow] => [c.id, c]));

  it('suppresses the Zucker 2020 cloud a Zucker 2021 ellipsoid replaces', () => {
    expect(byId.has('orion')).toBe(false);
    expect(byId.get('orion-a')!.source).toBe('Z2021T1');
    expect(byId.get('orion-a')!.mass).toBe(5);
    expect(built.spheres).toBe(sightlines.size - 1);
  });

  it('gives a singleton sightline the default radius and sorts by display name', () => {
    expect(byId.get('aquila-south')!.axes).toEqual(Array(3).fill(DEFAULT_SPHERE_RADIUS_PC));
    const names = built.clouds.map((c) => c.name.toLowerCase());
    expect(names).toEqual([...names].sort());
  });

  it('promotes the curated canonical name and keeps the slug', () => {
    expect(byId.get('m16')!.name).toBe('Eagle Nebula');
    expect(byId.get('m16')!.aliases).toEqual(['M16', 'NGC 6611', 'IC 4703']);
  });
});
