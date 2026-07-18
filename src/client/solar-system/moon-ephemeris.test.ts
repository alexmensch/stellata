import { describe, expect, it } from 'vitest';

import { AU_KM } from '../util/astronomy-constants';
import { MOON_ELEMENTS } from './moon-ephemeris';
import { SOL_MOONS } from './planet-system';

const EXPECTED_MOONS: Record<string, string> = {
  Moon: 'Earth',
  Io: 'Jupiter', Europa: 'Jupiter', Ganymede: 'Jupiter', Callisto: 'Jupiter',
  Mimas: 'Saturn', Enceladus: 'Saturn', Tethys: 'Saturn', Dione: 'Saturn',
  Rhea: 'Saturn', Titan: 'Saturn', Iapetus: 'Saturn',
  Miranda: 'Uranus', Ariel: 'Uranus', Umbriel: 'Uranus', Titania: 'Uranus', Oberon: 'Uranus',
  Triton: 'Neptune',
};

describe('MOON_ELEMENTS', () => {
  it('covers exactly the 18 in-scope major moons', () => {
    expect(MOON_ELEMENTS.length).toBe(18);
    const byName = new Map(MOON_ELEMENTS.map((m) => [m.name, m.parent]));
    expect(Object.fromEntries(byName)).toEqual(EXPECTED_MOONS);
  });

  it('has physically sane elements for every moon', () => {
    for (const m of MOON_ELEMENTS) {
      expect(m.aKm, m.name).toBeGreaterThan(0);
      expect(m.e, m.name).toBeGreaterThanOrEqual(0);
      expect(m.e, m.name).toBeLessThan(1);
      expect(m.incDeg, m.name).toBeGreaterThanOrEqual(0);
      expect(m.incDeg, m.name).toBeLessThanOrEqual(180);
      expect(m.periodDays, m.name).toBeGreaterThan(0);
      for (const ang of [m.nodeDeg, m.periDeg, m.m0Deg]) {
        expect(ang, m.name).toBeGreaterThanOrEqual(0);
        expect(ang, m.name).toBeLessThan(360);
      }
    }
  });

  it('matches published semi-major axes', () => {
    const a = (name: string) => MOON_ELEMENTS.find((m) => m.name === name)!.aKm;
    expect(a('Moon')).toBe(384400);
    expect(a('Io')).toBe(421800);
  });

  it('places Triton on a retrograde orbit', () => {
    const triton = MOON_ELEMENTS.find((m) => m.name === 'Triton')!;
    expect(triton.incDeg).toBeGreaterThan(90);
  });

  it('references every moon but the Moon to a Laplace/equatorial pole', () => {
    for (const m of MOON_ELEMENTS) {
      if (m.name === 'Moon') {
        expect(m.refPoleRaDeg).toBeUndefined();
        expect(m.refPoleDecDeg).toBeUndefined();
      } else {
        expect(m.refPoleRaDeg, m.name).toBeTypeOf('number');
        expect(m.refPoleDecDeg, m.name).toBeTypeOf('number');
      }
    }
  });
});

describe('SOL_MOONS', () => {
  it('mirrors MOON_ELEMENTS one-to-one', () => {
    expect(SOL_MOONS.map((m) => m.name).sort()).toEqual(
      MOON_ELEMENTS.map((m) => m.name).sort(),
    );
  });

  it('derives semi-major axis (parent-relative AU) and eccentricity from the elements', () => {
    const elemByName = new Map(MOON_ELEMENTS.map((m) => [m.name, m]));
    for (const moon of SOL_MOONS) {
      const el = elemByName.get(moon.name)!;
      expect(moon.semiMajorAxisAu, moon.name).toBeCloseTo(el.aKm / AU_KM, 12);
      expect(moon.eccentricity, moon.name).toBe(el.e);
      expect(moon.parentName, moon.name).toBe(el.parent);
    }
  });

  it('types only the Moon and Io as rocky, the rest icy', () => {
    const rocky = SOL_MOONS.filter((m) => m.type === 'rocky').map((m) => m.name).sort();
    expect(rocky).toEqual(['Io', 'Moon']);
    expect(SOL_MOONS.every((m) => m.type === 'rocky' || m.type === 'icy')).toBe(true);
  });
});
